import fs from "fs";
import path from "path";
import { Sandbox } from "e2b";
import { localProjectStore } from "./project-store";
import { localSandboxManager } from "./sandbox-manager";
import { purgeInvalidStaticHtml } from "./starter-template";

class E2BSandboxManager {
  private activeSandboxes: Map<string, Sandbox> = new Map();
  private activeUrls: Map<string, string> = new Map();
  private initializing: Map<string, Promise<string>> = new Map();

  public isE2BEnabled(): boolean {
    const provider = process.env.SANDBOX_PROVIDER || "local";
    const apiKey = process.env.E2B_API_KEY || "";
    return provider === "e2b" && Boolean(apiKey);
  }

  public getPreviewUrl(projectId: string): string | null {
    return this.activeUrls.get(projectId) || null;
  }

  public async syncFile(projectId: string, relativePath: string, content: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(projectId);
    if (!sandbox) return;

    try {
      const normalizedPath = relativePath.replace(/\\/g, "/");
      await sandbox.files.write(normalizedPath, content);
      console.log(`[E2B] Synced ${normalizedPath} to sandbox ${sandbox.sandboxId}`);

      // If syncing public/index.html or index.html, mirror to both root and public/
      if (normalizedPath === "public/index.html") {
        await sandbox.files.write("index.html", content).catch(() => {});
        console.log(`[E2B] Mirrored public/index.html → root index.html in sandbox`);
      } else if (normalizedPath === "index.html") {
        await sandbox.files.write("public/index.html", content).catch(() => {});
        console.log(`[E2B] Mirrored index.html → public/index.html in sandbox`);
      }
    } catch (err: any) {
      console.warn(`[E2B] Failed to sync ${relativePath}:`, err.message || err);
    }
  }

  private async syncAllWorkspaceFiles(projectId: string, sandbox: Sandbox): Promise<void> {
    const dir = localProjectStore.getWorkspaceDir(projectId);
    if (!fs.existsSync(dir)) return;

    const filesToSync: Array<{ relPath: string; fullPath: string }> = [];

    function walk(current: string) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git" || entry.name === "dist") {
          continue;
        }
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          filesToSync.push({
            relPath: path.relative(dir, full).replace(/\\/g, "/"),
            fullPath: full,
          });
        }
      }
    }

    walk(dir);

    console.log(`[E2B] Syncing ${filesToSync.length} files to sandbox...`);
    let syncedCount = 0;
    for (const f of filesToSync) {
      try {
        const content = fs.readFileSync(f.fullPath, "utf-8");
        await sandbox.files.write(f.relPath, content);
        syncedCount++;
        if (syncedCount % 10 === 0) {
          console.log(`[E2B] Synced ${syncedCount}/${filesToSync.length} files...`);
        }
      } catch (e: any) {
        console.warn(`[E2B] File sync error for ${f.relPath}:`, e.message);
      }
    }
    // If public/index.html was synced, also mirror to root index.html
    const pubIndex = filesToSync.find(f => f.relPath === "public/index.html");
    if (pubIndex) {
      try {
        const content = fs.readFileSync(pubIndex.fullPath, "utf-8");
        await sandbox.files.write("index.html", content);
        console.log(`[E2B] Mirrored public/index.html → root index.html`);
      } catch {}
    }
    console.log(`[E2B] Successfully synced ${syncedCount}/${filesToSync.length} workspace files to sandbox ${sandbox.sandboxId}`);
  }

  public async startDevServer(projectId: string): Promise<string> {
    localSandboxManager.ensureProjectTemplate(projectId);
    const dir = localProjectStore.getWorkspaceDir(projectId);
    purgeInvalidStaticHtml(dir);

    const hasNextApp = fs.existsSync(path.join(dir, "src", "app", "page.tsx"));

    /**
     * Next.js apps must be compiled. E2B's default VM is too small for Turbopack,
     * and a static file server would print JSX like `{children}` as plain text.
     * Lovable-style live preview = local `next dev` with preinstalled packages.
     */
    if (hasNextApp || !this.isE2BEnabled()) {
      if (hasNextApp && this.isE2BEnabled()) {
        console.log(`[E2B] Next.js project ${projectId} — using local compiled preview`);
      }
      return localSandboxManager.startDevServer(projectId);
    }

    // Check if currently initializing
    const ongoing = this.initializing.get(projectId);
    if (ongoing) {
      console.log(`[E2B] Sandbox initialization already in progress for ${projectId}`);
      return ongoing;
    }

    // Check if already active
    const existing = this.activeSandboxes.get(projectId);
    const existingUrl = this.activeUrls.get(projectId);
    if (existing && existingUrl) {
      console.log(`[E2B] Sandbox already active for ${projectId}, URL: ${existingUrl}`);
      return existingUrl;
    }

    const initPromise = (async () => {
      try {
        console.log(`[E2B] Booting cloud micro-VM sandbox for project ${projectId}...`);
        const apiKey = process.env.E2B_API_KEY;

        if (!apiKey) {
          throw new Error("E2B_API_KEY not set");
        }

        const sandbox = await Sandbox.create({
          apiKey,
          timeoutMs: 3600_000, // 1 hour session
        });

        this.activeSandboxes.set(projectId, sandbox);
        console.log(`[E2B] Sandbox created: ${sandbox.sandboxId}`);

        // Sync all workspace files into sandbox
        await this.syncAllWorkspaceFiles(projectId, sandbox);

        const dir = localProjectStore.getWorkspaceDir(projectId);
        const hasPublicIndex = fs.existsSync(path.join(dir, "public", "index.html"));
        const hasRootIndex = fs.existsSync(path.join(dir, "index.html"));
        const hasPackageJson = fs.existsSync(path.join(dir, "package.json"));

        if (hasPublicIndex) {
          console.log(`[E2B] Starting static HTTP server for public/index.html on 0.0.0.0:3000...`);
          try {
            const proc = await sandbox.commands.run("python3 -m http.server 3000 --directory public --bind 0.0.0.0", { background: true });
            console.log(`[E2B] Static server process ID: ${proc.pid}`);
          } catch (serverErr) {
            console.error(`[E2B] Failed to start server:`, serverErr);
            // Try without directory flag
            const altProc = await sandbox.commands.run("python3 -m http.server 3000 --bind 0.0.0.0", { background: true });
            console.log(`[E2B] Alternative server process ID: ${altProc.pid}`);
          }
          
          // Wait and verify binding
          await new Promise(resolve => setTimeout(resolve, 5000));
          try {
            const portCheck = await sandbox.commands.run("ss -lntp 2>/dev/null | grep 3000 || true");
            console.log(`[E2B] Port 3000 status:\n${portCheck.stdout}`);
            
            // If nothing is listening, try using nohup
            if (!portCheck.stdout.includes("3000")) {
              console.error(`[E2B] No process listening on 3000, trying with nohup...`);
              await sandbox.commands.run("nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/server.log 2>&1 &");
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          } catch (checkErr) {
            console.warn(`[E2B] Could not verify port binding:`, checkErr);
          }
        } else if (hasRootIndex) {
          console.log(`[E2B] Starting static HTTP server for root index.html on 0.0.0.0:3000...`);
          try {
            const proc = await sandbox.commands.run("python3 -m http.server 3000 --bind 0.0.0.0", { background: true });
            console.log(`[E2B] Static server process ID: ${proc.pid}`);
          } catch (serverErr) {
            console.error(`[E2B] Failed to start server:`, serverErr);
            // Try with nohup
            await sandbox.commands.run("nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/server.log 2>&1 &");
          }
          
          // Wait and verify binding
          await new Promise(resolve => setTimeout(resolve, 5000));
          try {
            const portCheck = await sandbox.commands.run("ss -lntp 2>/dev/null | grep 3000 || true");
            console.log(`[E2B] Port 3000 status:\n${portCheck.stdout}`);
            
            // If nothing is listening, try nohup
            if (!portCheck.stdout.includes("3000")) {
              console.error(`[E2B] No process listening on 3000, trying with nohup...`);
              await sandbox.commands.run("nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/server.log 2>&1 &");
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          } catch (checkErr) {
            console.warn(`[E2B] Could not verify port binding:`, checkErr);
          }
        } else if (hasPackageJson) {
          // E2B free VMs have limited RAM (~512MB) — Next.js Turbopack will OOM.
          // Instead, serve files with a lightweight Node.js static server.
          console.log(`[E2B] Starting lightweight static server (Next.js too heavy for E2B VM)...`);

          // Write a minimal static server script
          const serverScript = `
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.tsx': 'text/plain', '.ts': 'text/plain', '.jsx': 'text/plain',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';

  // Try public/ first, then root
  const candidates = [
    path.join(__dirname, 'public', url),
    path.join(__dirname, url),
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // Fallback: serve index.html for SPA routing
  const fallback = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(fallback)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(fallback).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(3000, '0.0.0.0', () => console.log('Static server on 0.0.0.0:3000'));
`;
          try {
            await sandbox.files.write("_serve.cjs", serverScript);
            await sandbox.commands.run("node _serve.cjs &", { background: true });
            console.log(`[E2B] Lightweight static server started on port 3000`);
          } catch (serverErr) {
            console.error(`[E2B] Static server failed, trying Python fallback...`, serverErr);
            await sandbox.commands.run("nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/server.log 2>&1 &");
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          console.log(`[E2B] Starting fallback static server on 0.0.0.0:3000...`);
          try {
            const proc = await sandbox.commands.run("python3 -m http.server 3000 --bind 0.0.0.0", { background: true });
            console.log(`[E2B] Fallback server process ID: ${proc.pid}`);
          } catch (serverErr) {
            console.error(`[E2B] Failed to start fallback server, trying nohup...`);
            await sandbox.commands.run("nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/server.log 2>&1 &");
          }
          
          // Wait and verify binding
          await new Promise(resolve => setTimeout(resolve, 5000));
          try {
            const portCheck = await sandbox.commands.run("ss -lntp 2>/dev/null | grep 3000 || true");
            console.log(`[E2B] Port 3000 status:\n${portCheck.stdout}`);
            
            if (!portCheck.stdout.includes("3000")) {
              console.error(`[E2B] No process listening on 3000, trying nohup...`);
              await sandbox.commands.run("nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/server.log 2>&1 &");
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          } catch (checkErr) {
            console.warn(`[E2B] Could not verify port binding:`, checkErr);
          }
        }

        const host = sandbox.getHost(3000);
        const previewUrl = `https://${host}`;
        this.activeUrls.set(projectId, previewUrl);

        localProjectStore.update(projectId, {
          serverStatus: "Starting",
          previewUrl,
          sandboxId: sandbox.sandboxId,
        });

        console.log(`[E2B] Project ${projectId} live preview URL: ${previewUrl}, waiting for server to be ready...`);
        
        // Wait for server to be ready by checking if we can fetch from it
        let serverReady = false;
        for (let i = 0; i < 60; i++) { // Increased to 60 seconds
          try {
            console.log(`[E2B] Checking server readiness attempt ${i + 1}/60...`);
            const testResponse = await fetch(previewUrl, { 
              method: 'GET',
              signal: AbortSignal.timeout(5000)
            });
            console.log(`[E2B] Server check response: ${testResponse.status}`);
            if (testResponse.ok || testResponse.status === 404) {
              serverReady = true;
              console.log(`[E2B] Server is ready for ${projectId}`);
              break;
            }
          } catch (fetchErr) {
            console.log(`[E2B] Server not ready yet, attempt ${i + 1}:`, fetchErr);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!serverReady) {
          console.error(`[E2B] Server did not become ready for ${projectId} after 60 seconds`);
          // Try to get sandbox logs and debug info
          try {
            // Check what's actually listening on which interface
            const portCheck = await sandbox.commands.run("ss -lntp || netstat -tlnp");
            console.log(`[E2B] All listening ports:\n${portCheck.stdout}`);
            
            // Check for any processes
            const allProcs = await sandbox.commands.run("ps aux");
            console.log(`[E2B] All processes:\n${allProcs.stdout}`);
            
            // Check specifically for Python HTTP server
            const pythonProcs = await sandbox.commands.run("ps aux | grep python");
            console.log(`[E2B] Python processes:\n${pythonProcs.stdout}`);
            
            // Check server log if exists
            const serverLog = await sandbox.commands.run("cat /tmp/server.log 2>/dev/null || echo 'No server log'");
            console.log(`[E2B] Server log:\n${serverLog.stdout}`);
          } catch (logErr) {
            console.log(`[E2B] Could not fetch sandbox debug info:`, logErr);
          }
        }
        
        localProjectStore.update(projectId, {
          serverStatus: serverReady ? "Active" : "Error",
        });
        
        return previewUrl;
      } catch (err: any) {
        console.error(`[E2B] Failed to start E2B sandbox for ${projectId}:`, err.message || err);
        console.log(`[E2B] Full error details:`, err);
        console.log(`[E2B] Falling back to local dev server...`);
        
        // Clean up any partial state
        this.activeSandboxes.delete(projectId);
        this.activeUrls.delete(projectId);
        
        // Update project status to reflect fallback
        localProjectStore.update(projectId, {
          serverStatus: "Starting",
          previewUrl: undefined,
          sandboxId: undefined,
        });
        
        // Fall back to local sandbox
        return localSandboxManager.startDevServer(projectId);
      } finally {
        this.initializing.delete(projectId);
      }
    })();

    this.initializing.set(projectId, initPromise);
    return initPromise;
  }

  public async stopDevServer(projectId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(projectId);
    if (sandbox) {
      try {
        await sandbox.kill();
        console.log(`[E2B] Killed sandbox for ${projectId}`);
      } catch {}
      this.activeSandboxes.delete(projectId);
      this.activeUrls.delete(projectId);
    }
    localSandboxManager.stopDevServer(projectId);
    localProjectStore.update(projectId, { serverStatus: "Stopped" });
  }
}

export const e2bSandboxManager = new E2BSandboxManager();
