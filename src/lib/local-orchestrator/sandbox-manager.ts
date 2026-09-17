import fs from "fs";
import path from "path";
import net from "net";
import http from "http";
import { spawn, ChildProcess } from "child_process";
import { localProjectStore } from "./project-store";
import { purgeInvalidStaticHtml, writeStarterTemplate } from "./starter-template";

const activeProcesses = new Map<string, ChildProcess>();
const serverReadyPromises = new Map<string, Promise<void>>();
const startLocks = new Map<string, Promise<string>>();

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

  async startDevServer(projectId: string): Promise<string> {
    const inflight = startLocks.get(projectId);
    if (inflight) return inflight;

    const run = this.startDevServerUnlocked(projectId).finally(() => {
      startLocks.delete(projectId);
    });
    startLocks.set(projectId, run);
    return run;
  },

  async startDevServerUnlocked(projectId: string): Promise<string> {
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
      await waitForServerReady(record.port);
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
    console.log(`[local-sandbox] Starting Vite dev server for ${projectId} on port ${record.port}...`);

    try {
      const devProc = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(record.port)], {
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
