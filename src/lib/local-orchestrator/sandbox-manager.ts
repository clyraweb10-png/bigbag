import fs from "fs";
import path from "path";
import net from "net";
import http from "http";
import { spawn, ChildProcess } from "child_process";
import { localProjectStore } from "./project-store";
import { extractMissingModuleFromError, installPackages } from "./dependency-scanner";
import { writeStarterTemplate } from "./starter-template";

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
 * Wait until Next actually serves HTTP — a TCP accept is not enough (compile still in flight).
 */
async function waitForServerReady(port: number, timeoutMs = 45000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.resume();
          resolve(true);
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

  /** Live origin if a Next process is already bound — does not wait or start. */
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

    this.ensureProjectTemplate(projectId);
    const dir = localProjectStore.getWorkspaceDir(projectId);

    const existing = activeProcesses.get(projectId);
    if (existing && existing.exitCode == null && !existing.killed) {
      console.log(`[local-sandbox] Dev server already running for ${projectId}`);
      const pending = serverReadyPromises.get(projectId);
      if (pending) {
        await pending.catch(() => {});
      }
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

    // Build path to Next.js CLI binary — array join defeats Turbopack static analysis
    // so it won't try to bundle the entire Next.js CLI chain into our server routes.
    const nextBinSegments = ["node_modules", "next", "dist", "bin", "next"];
    const workspaceNext = path.join(dir, ...nextBinSegments);
    const rootNext = path.join(process.cwd(), ...nextBinSegments);
    const nextBin = fs.existsSync(workspaceNext) ? workspaceNext : rootNext;
    if (!fs.existsSync(nextBin)) {
      throw new Error(`Next.js CLI not found at ${workspaceNext} or ${rootNext}`);
    }
    console.log(`[local-sandbox] Starting Next.js dev server for ${projectId} on port ${record.port}...`);

    try {
      const devProc = spawn(process.execPath, [nextBin, "dev", "-p", String(record.port), "-H", "127.0.0.1"], {
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

      const healedPackages = new Set<string>();

      devProc.stdout?.on("data", (data) => {
        console.log(`[${projectId}:${record.port}]`, data.toString().trim());
      });

      devProc.stderr?.on("data", (data) => {
        const text = data.toString();
        console.error(`[${projectId}:${record.port} err]`, text.trim());

        const missingPkg = extractMissingModuleFromError(text);
        if (missingPkg && !healedPackages.has(missingPkg)) {
          healedPackages.add(missingPkg);
          console.log(`[local-sandbox] Self-healing: detected missing package "${missingPkg}", installing...`);
          try {
            const rootDir = process.cwd();
            const result = installPackages(rootDir, [missingPkg]);
            if (result.installed.length > 0) {
              console.log(`[local-sandbox] Self-healing: installed "${missingPkg}" — HMR should reload automatically`);
            } else {
              console.error(`[local-sandbox] Self-healing: failed to install "${missingPkg}"`);
            }
          } catch (healErr: any) {
            console.error(`[local-sandbox] Self-healing install error:`, healErr.message || healErr);
          }
        }
      });

      devProc.on("close", (code) => {
        console.log(`[local-sandbox] Dev server for ${projectId} closed with code ${code}`);
        activeProcesses.delete(projectId);
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
      await readyPromise.catch(() => {});

      console.log(`[local-sandbox] Dev server startup finished for ${projectId} on port ${record.port}`);
      return `/api/preview/${projectId}`;
    } catch (err) {
      console.error(`[local-sandbox] Failed to start dev server for ${projectId}:`, err);
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
