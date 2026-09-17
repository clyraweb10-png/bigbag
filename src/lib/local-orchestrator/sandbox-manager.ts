import fs from "fs";
import path from "path";
import net from "net";
import http from "http";
import { spawn, spawnSync, ChildProcess } from "child_process";
import { localProjectStore } from "./project-store";
import { purgeInvalidStaticHtml, writeStarterTemplate } from "./starter-template";
import { GeneratedAppBuildError } from "./sandbox-errors";

const activeProcesses = new Map<string, ChildProcess>();
const serverReadyPromises = new Map<string, Promise<void>>();

type StartOptions = {
  rebuild?: boolean;
};

type StartLock = {
  promise: Promise<string>;
  rebuild: boolean;
};

const startLocks = new Map<string, StartLock>();

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    proc.kill("SIGTERM");
  }
}

async function waitForProcessExit(proc: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (proc.exitCode != null) return;
  await Promise.race([
    new Promise<void>((resolve) => proc.once("close", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Wait until the workspace runtime actually serves HTTP.
 */
async function waitForServerReady(port: number, timeoutMs = 45000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/", timeout: 2000 },
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
    if (ok) {
      console.log(`[local-sandbox] Server on port ${port} is ready`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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

  async startDevServer(projectId: string, options: StartOptions = {}): Promise<string> {
    const ongoing = startLocks.get(projectId);
    if (ongoing) {
      if (!options.rebuild || ongoing.rebuild) return ongoing.promise;

      // A preview health-check may already be starting the old source while a
      // generation finishes. Queue one real rebuild after it; all later callers
      // converge on this stronger lock instead of accepting the stale start.
      const queued = ongoing.promise
        .catch(() => undefined)
        .then(() => this.startDevServerUnlocked(projectId, { rebuild: true }));
      const replacement: StartLock = { promise: queued, rebuild: true };
      startLocks.set(projectId, replacement);
      const clearReplacement = () => {
        if (startLocks.get(projectId) === replacement) startLocks.delete(projectId);
      };
      void queued.then(clearReplacement, clearReplacement);
      return queued;
    }

    const run = this.startDevServerUnlocked(projectId, options);
    const lock: StartLock = { promise: run, rebuild: Boolean(options.rebuild) };
    startLocks.set(projectId, lock);
    const clearLock = () => {
      if (startLocks.get(projectId) === lock) startLocks.delete(projectId);
    };
    void run.then(clearLock, clearLock);
    return run;
  },

  async startDevServerUnlocked(projectId: string, options: StartOptions = {}): Promise<string> {
    const record = localProjectStore.getRecord(projectId);
    if (!record) throw new Error(`Project ${projectId} not found`);

    purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
    this.ensureProjectTemplate(projectId);
    const dir = localProjectStore.getWorkspaceDir(projectId);

    const existing = activeProcesses.get(projectId);
    if (existing && existing.exitCode == null && !existing.killed && !options.rebuild) {
      console.log(`[local-sandbox] Dev server already running for ${projectId}`);
      const pending = serverReadyPromises.get(projectId);
      if (pending) {
        await pending;
      }
      await waitForServerReady(record.port);
      return `/api/preview/${projectId}`;
    }
    if (existing) {
      killProcessTree(existing);
      // Wait before probing the stored port. Otherwise the old listener can
      // still own the port—and can fire after the replacement starts.
      await waitForProcessExit(existing);
      if (activeProcesses.get(projectId) === existing) {
        activeProcesses.delete(projectId);
        serverReadyPromises.delete(projectId);
      }
    }

    linkSharedNodeModules(dir, projectId);

    // Probe for a free port — the stored port may be occupied from a previous run
    const freePort = await findFreePort(record.port);
    if (freePort !== record.port) {
      console.warn(`[local-sandbox] Port ${record.port} for ${projectId} is in use, using ${freePort} instead`);
      localProjectStore.update(projectId, { port: freePort });
      record.port = freePort;
    }

    const nextBinSegments = ["node_modules", "next", "dist", "bin", "next"];
    const workspaceNext = path.join(dir, ...nextBinSegments);
    const rootNext = path.join(/* turbopackIgnore: true */ process.cwd(), ...nextBinSegments);
    const nextBin = fs.existsSync(workspaceNext) ? workspaceNext : rootNext;
    if (!fs.existsSync(nextBin)) {
      throw new Error(`Next.js CLI not found at ${workspaceNext} or ${rootNext}`);
    }

    const build = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
      cwd: dir,
      timeout: 120_000,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });
    if (build.error || build.status !== 0) {
      const details = `${build.stdout || ""}\n${build.stderr || ""}`.trim().slice(-12_000);
      throw new GeneratedAppBuildError(
        `Generated app failed to compile${build.error ? `: ${build.error.message}` : ""}${details ? `\n${details}` : ""}`
      );
    }
    console.log(`[local-sandbox] Starting Next.js dev server for ${projectId} on port ${record.port}...`);

    try {
      const devProc = spawn(process.execPath, [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(record.port)], {
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
        if (activeProcesses.get(projectId) !== devProc) return;
        activeProcesses.delete(projectId);
        serverReadyPromises.delete(projectId);
        localProjectStore.update(projectId, { serverStatus: "Stopped" });
      });

      devProc.on("error", (err) => {
        console.error(`[local-sandbox] Dev server error for ${projectId}:`, err);
        if (activeProcesses.get(projectId) !== devProc) return;
        activeProcesses.delete(projectId);
        serverReadyPromises.delete(projectId);
        localProjectStore.update(projectId, { serverStatus: "Error" });
      });

      activeProcesses.set(projectId, devProc);
      localProjectStore.update(projectId, { 
        serverStatus: "Starting",
        previewUrl: `/api/preview/${projectId}`
      });

      console.log(`[local-sandbox] Dev server process started for ${projectId} on port ${record.port}, waiting for ready...`);
      
      // Wait for server to be ready before returning
      const readyPromise = waitForServerReady(record.port)
        .then(() => {
          console.log(`[local-sandbox] Dev server ready for ${projectId}`);
          localProjectStore.update(projectId, { serverStatus: "Active" });
        })
        .catch((err) => {
          console.error(`[local-sandbox] Dev server failed to become ready for ${projectId}:`, err);
          localProjectStore.update(projectId, { serverStatus: "Error" });
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
      localProjectStore.update(projectId, { serverStatus: "Error" });
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
};
