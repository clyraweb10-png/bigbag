import fs from "fs";
import path from "path";
import net from "net";
import http from "http";
import { spawn, ChildProcess } from "child_process";
import { setTimeout as delay } from "node:timers/promises";
import { localProjectStore } from "./project-store";
import { purgeInvalidStaticHtml, writeStarterTemplate } from "./starter-template";
import { validateGeneratedRuntime } from "./runtime-validator";

const activeProcesses = new Map<string, ChildProcess>();
const activeBuildProcesses = new Map<string, ChildProcess>();
const serverReadyPromises = new Map<string, Promise<void>>();
const startLocks = new Map<string, Promise<string>>();
const LOCAL_BUILD_TIMEOUT_MS = 120_000;

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    proc.kill("SIGTERM");
  }
}

/**
 * Wait until the workspace runtime actually serves HTTP.
 */
async function waitForServerReady(port: number, timeoutMs = 45000, signal?: AbortSignal): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    signal?.throwIfAborted();
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/", timeout: 2000, signal },
        (res) => {
          const healthy = (res.statusCode ?? 500) < 500;
          res.resume();
          resolve(healthy);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    signal?.throwIfAborted();
    if (ok) {
      console.log(`[local-sandbox] Server on port ${port} is ready`);
      return;
    }
    await delay(250, undefined, { signal });
  }

  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}

function linkSharedNodeModules(dir: string, projectId: string): void {
  const targetNodeModules = path.join(dir, "node_modules");
  const rootNodeModules = path.join(process.cwd(), "node_modules");
  if (!fs.existsSync(rootNodeModules)) return;

  let needsSymlink = false;
  if (!fs.existsSync(targetNodeModules)) {
    needsSymlink = true;
  } else {
    try {
      const stat = fs.lstatSync(targetNodeModules);
      if (!stat.isSymbolicLink()) {
        console.warn(`[local-sandbox] node_modules for ${projectId} is a real directory — removing and re-symlinking to shared root`);
        fs.rmSync(targetNodeModules, { recursive: true, force: true });
        needsSymlink = true;
      } else {
        const linkTarget = fs.readlinkSync(targetNodeModules);
        if (linkTarget !== rootNodeModules) {
          fs.unlinkSync(targetNodeModules);
          needsSymlink = true;
        }
      }
    } catch {
      needsSymlink = true;
    }
  }

  if (needsSymlink) {
    try {
      const linkType = process.platform === "win32" ? "junction" : "dir";
      fs.symlinkSync(rootNodeModules, targetNodeModules, linkType);
      console.log(`[local-sandbox] Linked node_modules for ${projectId} → ${rootNodeModules}`);
    } catch (linkErr) {
      console.warn("[local-sandbox] Symlink failed:", linkErr);
    }
  }
}

/** Returns true when nothing is listening on `port` on localhost. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/** Find the next free port starting from `preferred`. */
async function findFreePort(preferred: number): Promise<number> {
  let port = preferred;
  while (!(await isPortFree(port))) {
    port++;
  }
  return port;
}

async function buildWorkspace(dir: string, viteBin: string, projectId: string, signal?: AbortSignal): Promise<void> {
  const tscSegments = ["node_modules", "typescript", "bin", "tsc"];
  const workspaceTsc = path.join(dir, ...tscSegments);
  const rootTsc = path.join(/* turbopackIgnore: true */ process.cwd(), ...tscSegments);
  const tscBin = fs.existsSync(workspaceTsc) ? workspaceTsc : rootTsc;
  if (tscBin && fs.existsSync(tscBin)) {
    try {
      await runBuildCommand(dir, [tscBin, "--noEmit"], projectId, "type validation", signal);
    } catch (tscErr) {
      console.warn(`[local-sandbox] Type validation warning for ${projectId} (proceeding with production build):`, tscErr instanceof Error ? tscErr.message : tscErr);
    }
  }
  await runBuildCommand(dir, [viteBin, "build"], projectId, "production build", signal);
  signal?.throwIfAborted();
  await validateGeneratedRuntime(dir);
}

async function runBuildCommand(
  dir: string,
  args: string[],
  projectId: string,
  label: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const build = spawn(process.execPath, args, {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, NODE_ENV: "production" },
    });
    activeBuildProcesses.set(projectId, build);
    const onAbort = () => {
      killProcessTree(build);
      reject(new Error(`Generated app ${label} stopped`));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    let output = "";
    const collect = (data: Buffer) => {
      output = (output + data.toString()).slice(-8_000);
    };
    build.stdout?.on("data", collect);
    build.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      killProcessTree(build);
      reject(new Error(`Generated app ${label} timed out after ${LOCAL_BUILD_TIMEOUT_MS / 1000}s`));
    }, LOCAL_BUILD_TIMEOUT_MS);
    build.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (activeBuildProcesses.get(projectId) === build) activeBuildProcesses.delete(projectId);
      reject(error);
    });
    build.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (activeBuildProcesses.get(projectId) === build) activeBuildProcesses.delete(projectId);
      if (signal?.aborted) { reject(new Error(`Generated app ${label} stopped`)); return; }
      if (code === 0) {
        console.log(`[local-sandbox] ${label} completed for ${projectId}`);
        resolve();
      } else {
        reject(new Error(`Generated app failed to compile${output.trim() ? `:\n${output.trim()}` : ""}`));
      }
    });
  });
}

export const localSandboxManager = {
  ensureProjectTemplate(projectId: string): void {
    const dir = localProjectStore.getWorkspaceDir(projectId);
    writeStarterTemplate(dir, projectId);
    linkSharedNodeModules(dir, projectId);
  },

  /** Live origin if a workspace process is already bound — does not wait or start. */
  getRunningOrigin(projectId: string): string | null {
    const proc = activeProcesses.get(projectId);
    const rec = localProjectStore.getRecord(projectId);
    if (!proc || !rec || proc.exitCode != null || proc.killed) return null;
    return `http://127.0.0.1:${rec.port}`;
  },

  async startDevServer(projectId: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const inflight = startLocks.get(projectId);
    if (inflight) return inflight;

    const run = this.startDevServerUnlocked(projectId, signal).finally(() => {
      startLocks.delete(projectId);
    });
    startLocks.set(projectId, run);
    return run;
  },

  async startDevServerUnlocked(projectId: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const record = localProjectStore.getRecord(projectId);
    if (!record) throw new Error(`Project ${projectId} not found`);

    purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
    this.ensureProjectTemplate(projectId);
    const dir = localProjectStore.getWorkspaceDir(projectId);

    const existing = activeProcesses.get(projectId);
    if (existing && existing.exitCode == null && !existing.killed) {
      console.log(`[local-sandbox] Dev server already running for ${projectId}`);
      const pending = serverReadyPromises.get(projectId);
      if (pending) {
        await pending;
      }
      await waitForServerReady(record.port, 45_000, signal);
      return `/api/preview/${projectId}`;
    }
    if (existing) {
      killProcessTree(existing);
      activeProcesses.delete(projectId);
      serverReadyPromises.delete(projectId);
    }

    linkSharedNodeModules(dir, projectId);

    // Probe for a free port — the stored port may be occupied from a previous run
    const freePort = await findFreePort(record.port);
    if (freePort !== record.port) {
      console.warn(`[local-sandbox] Port ${record.port} for ${projectId} is in use, using ${freePort} instead`);
      localProjectStore.update(projectId, { port: freePort });
      record.port = freePort;
    }

    // Use the same lightweight Vite runtime as E2B. Workspaces normally share
    // the platform's node_modules, but a standalone workspace install also works.
    const viteBinSegments = ["node_modules", "vite", "bin", "vite.js"];
    const workspaceVite = path.join(dir, ...viteBinSegments);
    const rootVite = path.join(/* turbopackIgnore: true */ process.cwd(), ...viteBinSegments);
    const viteBin = fs.existsSync(workspaceVite) ? workspaceVite : rootVite;
    if (!fs.existsSync(viteBin)) {
      throw new Error(`Vite CLI not found at ${workspaceVite} or ${rootVite}`);
    }
    console.log(`[local-sandbox] Building ${projectId} before starting its preview on port ${record.port}...`);

    try {
      await buildWorkspace(dir, viteBin, projectId, signal);
      signal?.throwIfAborted();
      const devProc = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(record.port)], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(record.port),
          HOSTNAME: "127.0.0.1",
        },
      });

      devProc.stdout?.on("data", (data) => {
        console.log(`[${projectId}:${record.port}]`, data.toString().trim());
      });

      devProc.stderr?.on("data", (data) => {
        console.error(`[${projectId}:${record.port} err]`, data.toString().trim());
      });

      devProc.on("close", (code) => {
        console.log(`[local-sandbox] Dev server for ${projectId} closed with code ${code}`);
        activeProcesses.delete(projectId);
        serverReadyPromises.delete(projectId);
        localProjectStore.update(projectId, { serverStatus: "Stopped" });
      });

      devProc.on("error", (err) => {
        console.error(`[local-sandbox] Dev server error for ${projectId}:`, err);
        activeProcesses.delete(projectId);
        localProjectStore.update(projectId, { serverStatus: "Error" });
      });

      activeProcesses.set(projectId, devProc);
      localProjectStore.update(projectId, { 
        serverStatus: "Starting",
        previewUrl: `/api/preview/${projectId}`
      });

      console.log(`[local-sandbox] Production preview started for ${projectId} on port ${record.port}, waiting for ready...`);
      
      // Wait for server to be ready before returning
      const readyPromise = waitForServerReady(record.port, 45_000, signal)
        .then(() => {
          signal?.throwIfAborted();
          console.log(`[local-sandbox] Dev server ready for ${projectId}`);
          localProjectStore.update(projectId, { serverStatus: "Active" });
        })
        .catch((err) => {
          console.error(`[local-sandbox] Dev server failed to become ready for ${projectId}:`, err);
          localProjectStore.update(projectId, { serverStatus: signal?.aborted ? "Stopped" : "Error" });
          throw err;
        });
      
      serverReadyPromises.set(projectId, readyPromise);
      await readyPromise;

      console.log(`[local-sandbox] Dev server startup finished for ${projectId} on port ${record.port}`);
      return `/api/preview/${projectId}`;
    } catch (err) {
      console.error(`[local-sandbox] Failed to start dev server for ${projectId}:`, err);
      const failedProcess = activeProcesses.get(projectId);
      if (failedProcess) {
        killProcessTree(failedProcess);
        activeProcesses.delete(projectId);
      }
      serverReadyPromises.delete(projectId);
      localProjectStore.update(projectId, { serverStatus: signal?.aborted ? "Stopped" : "Error" });
      throw err;
    }
  },

  stopDevServer(projectId: string): void {
    const proc = activeProcesses.get(projectId);
    if (proc) {
      killProcessTree(proc);
      activeProcesses.delete(projectId);
    }
    serverReadyPromises.delete(projectId);
    startLocks.delete(projectId);
    localProjectStore.update(projectId, { serverStatus: "Stopped" });
  },

  cancelBuild(projectId: string): void {
    const build = activeBuildProcesses.get(projectId);
    if (build) killProcessTree(build);
  },
};
