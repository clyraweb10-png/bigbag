import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Sandbox } from "e2b";
import { localProjectStore, persistentPreviewPath, persistentPreviewUrl } from "./project-store";
import { localSandboxManager } from "./sandbox-manager";
import { purgeInvalidStaticHtml } from "./starter-template";
import { GENERATED_RUNTIME_CHECK_SCRIPT } from "./runtime-validator";
import {
  durableProjectStore,
  requireDurablePersistence,
  type PersistedFile,
} from "./durable-project-store";

const PREVIEW_PORT = 3000;
const SANDBOX_TIMEOUT_MS = 3_600_000;
const INSTALL_TIMEOUT_MS = 180_000;
const BUILD_TIMEOUT_MS = 120_000;
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  "dist",
  "build",
]);
const STATIC_SERVER_SCRIPT = `
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve("dist");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2" };
http.createServer((request, response) => {
  let pathname = "/";
  try { pathname = decodeURIComponent(new URL(request.url, "http://preview").pathname); } catch {}
  const requested = path.resolve(root, "." + pathname);
  const safe = requested === root || requested.startsWith(root + path.sep);
  const file = safe && fs.existsSync(requested) && fs.statSync(requested).isFile()
    ? requested
    : path.join(root, "index.html");
  if (!safe || !fs.existsSync(file)) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "content-type": mime[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
}).listen(3000, "0.0.0.0");
`;

type StartOptions = {
  /** Re-sync, compile, and restart even when the current preview is healthy. */
  rebuild?: boolean;
  signal?: AbortSignal;
};

type SharedE2BState = {
  activeSandboxes: Map<string, Sandbox>;
  activeUrls: Map<string, string>;
  initializing: Map<string, { promise: Promise<string>; rebuild: boolean; controller?: AbortController }>;
};

const stateKey = Symbol.for("bigbag.local-orchestrator.e2b-state");
const globalState = globalThis as typeof globalThis & { [stateKey]?: SharedE2BState };
const sharedState: SharedE2BState = globalState[stateKey] || {
  activeSandboxes: new Map<string, Sandbox>(),
  activeUrls: new Map<string, string>(),
  initializing: new Map<string, { promise: Promise<string>; rebuild: boolean; controller?: AbortController }>(),
};
globalState[stateKey] = sharedState;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedLog(value: string, max = 4_000): string {
  const normalized = value.trim();
  return normalized.length > max ? normalized.slice(-max) : normalized;
}

function commandFailure(label: string, error: unknown): Error {
  const result = (error as {
    result?: { stdout?: string; stderr?: string; error?: string };
  })?.result;
  const logs = boundedLog([result?.stdout, result?.stderr, result?.error]
    .filter(Boolean)
    .join("\n"));
  return new Error(`${label}${logs ? `:\n${logs}` : `: ${errorText(error)}`}`);
}

class E2BSandboxManager {
  private activeSandboxes = sharedState.activeSandboxes;
  private activeUrls = sharedState.activeUrls;
  private initializing = sharedState.initializing;

  public isE2BEnabled(): boolean {
    return (
      (process.env.SANDBOX_PROVIDER || "local").toLowerCase() === "e2b" &&
      Boolean(process.env.E2B_API_KEY)
    );
  }

  public getPreviewUrl(projectId: string): string | null {
    const record = localProjectStore.getRecord(projectId);
    return record?.deployment?.status === "success" ? persistentPreviewPath(projectId) : null;
  }

  public async syncFile(projectId: string, relativePath: string, content: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(projectId);
    if (!sandbox) return;

    const normalizedPath = relativePath.replace(/\\/g, "/");
    try {
      await sandbox.files.write(normalizedPath, content);
    } catch (error) {
      console.warn(`[E2B] Failed to sync ${normalizedPath}: ${errorText(error)}`);
    }
  }

  private collectWorkspaceFiles(projectId: string): Array<{ path: string; content: ArrayBuffer }> {
    const root = localProjectStore.getWorkspaceDir(projectId);
    const files: Array<{ path: string; content: ArrayBuffer }> = [];

    const walk = (current: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const data = fs.readFileSync(fullPath);
          files.push({
            path: path.relative(root, fullPath).replace(/\\/g, "/"),
            content: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
          });
        }
      }
    };

    walk(root);
    return files;
  }

  private async syncAllWorkspaceFiles(projectId: string, sandbox: Sandbox): Promise<void> {
    const files = this.collectWorkspaceFiles(projectId);
    if (files.length === 0) throw new Error("Generated workspace contains no files");

    for (const file of files) {
      await sandbox.files.write(file.path, file.content);
    }
    console.log(`[E2B] Synced ${files.length} source files for ${projectId}`);
  }

  private async previewIsReady(previewUrl: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await fetch(previewUrl, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000),
        cache: "no-store",
      });
      return response.ok;
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }

  private async createSandbox(projectId: string, apiKey: string): Promise<Sandbox> {
    const active = this.activeSandboxes.get(projectId);
    if (active && (await active.isRunning().catch(() => false))) return active;

    this.activeSandboxes.delete(projectId);
    this.activeUrls.delete(projectId);

    // Every build gets a disposable sandbox. Project state is restored from the
    // durable store, so Hobby's one-hour lifetime is sufficient and expected.
    const sandbox = await Sandbox.create({
      apiKey,
      // E2B sizes are properties of a template, not Sandbox.create options.
      // Teams with memory-heavy builds can supply a pre-provisioned template.
      template: process.env.E2B_BUILD_TEMPLATE?.trim() || "base",
      timeoutMs: SANDBOX_TIMEOUT_MS,
      // Keep E2B's control-plane/envd API token-protected. Application preview
      // ports remain reachable through our authenticated same-origin proxy;
      // verified against this SDK because `secure` governs envd, not app ports.
      secure: true,
      metadata: { projectId },
    });
    this.activeSandboxes.set(projectId, sandbox);
    return sandbox;
  }

  private async downloadBuild(sandbox: Sandbox): Promise<PersistedFile[]> {
    const files: PersistedFile[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await sandbox.files.list(directory);
      for (const entry of entries) {
        if (entry.type === "dir") await walk(entry.path);
        else if (entry.type === "file") {
          const content = await sandbox.files.read(entry.path, { format: "bytes" });
          const normalized = entry.path.replace(/\\/g, "/");
          const marker = normalized.lastIndexOf("/dist/");
          const relativePath = marker >= 0
            ? normalized.slice(marker + "/dist/".length)
            : normalized.replace(/^\.?\/?dist\//, "");
          files.push({
            path: relativePath,
            content,
          });
        }
      }
    };
    await walk("dist");
    return files;
  }

  private async compileAndStart(projectId: string, sandbox: Sandbox, signal?: AbortSignal): Promise<{ previewUrl: string; files: PersistedFile[] }> {
    signal?.throwIfAborted();
    await this.syncAllWorkspaceFiles(projectId, sandbox);
    signal?.throwIfAborted();

    try {
      await sandbox.commands.run(
        "npm install --legacy-peer-deps --no-audit --no-fund",
        { timeoutMs: INSTALL_TIMEOUT_MS }
      );
    } catch (error) {
      throw commandFailure("Dependency installation failed", error);
    }
    signal?.throwIfAborted();

    // Vite transpiles TypeScript without type-checking. An undeclared runtime
    // symbol can therefore bundle successfully and crash only in the browser.
    // Reject that class of failure before a preview can be marked ready.
    try {
      await sandbox.commands.run("npm exec tsc -- --noEmit", { timeoutMs: BUILD_TIMEOUT_MS });
    } catch (error) {
      throw commandFailure("Generated app failed to compile during type validation", error);
    }
    signal?.throwIfAborted();

    // A successful HTML response from Vite does not prove imported TSX compiles.
    // Build first so broken generations never get labelled as successful.
    try {
      console.info(`[E2B] ${JSON.stringify({ event: "build_command_started", projectId, command: "npm run build" })}`);
      await sandbox.commands.run("npm run build", { timeoutMs: BUILD_TIMEOUT_MS });
      console.info(`[E2B] ${JSON.stringify({ event: "build_command_completed", projectId, command: "npm run build" })}`);
    } catch (error) {
      if (signal?.aborted) console.info(`[E2B] ${JSON.stringify({ event: "build_command_cancelled", projectId })}`);
      throw commandFailure("Generated app failed to compile", error);
    }
    signal?.throwIfAborted();

    try {
      // Generation and dependency installation need outbound access, but
      // untrusted built code never does. Disable all E2B egress at the sandbox
      // boundary before evaluating the browser bundle or serving the preview.
      await sandbox.updateNetwork({ allowInternetAccess: false });
      await sandbox.files.write("_bigbag-runtime-check.cjs", GENERATED_RUNTIME_CHECK_SCRIPT);
      await sandbox.commands.run(
        "node --experimental-vm-modules _bigbag-runtime-check.cjs dist node_modules",
        { timeoutMs: 30_000 }
      );
    } catch (error) {
      throw commandFailure("Generated app failed runtime validation", error);
    }
    signal?.throwIfAborted();

    await sandbox.commands.run(
      "pkill -f '[v]ite.*--port 3000' || true; pkill -f '[p]ython3 -m http.server 3000' || true; pkill -f '[n]ode _bigbag-preview.cjs' || true",
      { timeoutMs: 10_000 }
    );
    await sandbox.files.write("_bigbag-preview.cjs", STATIC_SERVER_SCRIPT);
    await sandbox.commands.run(
      "node _bigbag-preview.cjs > /tmp/bigbag-preview.log 2>&1",
      { background: true, timeoutMs: 0 }
    );
    signal?.throwIfAborted();

    const previewUrl = `https://${sandbox.getHost(PREVIEW_PORT)}`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      signal?.throwIfAborted();
      if (await this.previewIsReady(previewUrl, signal)) {
        const files = await this.downloadBuild(sandbox);
        signal?.throwIfAborted();
        return { previewUrl, files };
      }
      await delay(1_000, undefined, { signal });
    }

    const logs = await sandbox.commands
      .run("tail -n 120 /tmp/bigbag-preview.log 2>/dev/null || true", { timeoutMs: 10_000 })
      .then((result) => boundedLog(result.stdout || result.stderr))
      .catch(() => "No preview logs were available");
    throw new Error(`Preview server did not become ready:\n${logs}`);
  }

  public async startDevServer(projectId: string, options: StartOptions = {}): Promise<string> {
    options.signal?.throwIfAborted();
    purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
    localSandboxManager.ensureProjectTemplate(projectId);

    if (!this.isE2BEnabled()) {
      localProjectStore.update(projectId, {
        deployment: { status: "deploying", createdAt: new Date().toISOString() },
      });
      try {
        if (options.rebuild) {
          await this.stopDevServer(projectId);
        }
        const previewUrl = await localSandboxManager.startDevServer(projectId, options.signal);
        if (options.signal?.aborted) {
          localSandboxManager.stopDevServer(projectId);
          options.signal.throwIfAborted();
        }
        localProjectStore.update(projectId, {
          previewUrl,
          deployment: {
            status: "success",
            createdAt: new Date().toISOString(),
            versionId: randomUUID(),
          },
        });
        return previewUrl;
      } catch (error) {
        if (!options.signal?.aborted) localProjectStore.update(projectId, {
          deployment: {
            status: "error",
            createdAt: new Date().toISOString(),
            errorMessage: errorText(error),
          },
        });
        throw error;
      }
    }

    requireDurablePersistence();

    const ongoing = this.initializing.get(projectId);
    if (ongoing) {
      if (!options.rebuild || ongoing.rebuild) return ongoing.promise;

      // A rebuild must include the latest workspace state. Wait for a weaker
      // health-check/start operation, then enqueue one real rebuild. Concurrent
      // rebuild callers will all converge on the same replacement promise.
      const rebuildAfterOngoing = () => {
        if (this.initializing.get(projectId)?.promise === ongoing.promise) {
          this.initializing.delete(projectId);
        }
        return this.startDevServer(projectId, { rebuild: true, signal: options.signal });
      };
      return ongoing.promise.then(rebuildAfterOngoing, rebuildAfterOngoing);
    }

    const initializationController = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, initializationController.signal])
      : initializationController.signal;

    // Defer the body to the next microtask so the shared promise is registered
    // before even the first readiness probe can yield to another request.
    const initialization = Promise.resolve().then(async () => {
      try {
        signal.throwIfAborted();
        const apiKey = process.env.E2B_API_KEY;
        if (!apiKey) throw new Error("E2B_API_KEY is not configured");

        localProjectStore.update(projectId, {
          serverStatus: "Starting",
          deployment: { status: "deploying", createdAt: new Date().toISOString() },
        });
        // This is the durability boundary: the complete source is outside E2B
        // before any disposable build worker is created.
        await localProjectStore.persistSource(projectId);
        signal.throwIfAborted();
        const sandbox = await this.createSandbox(projectId, apiKey);
        if (signal.aborted) {
          await sandbox.kill().catch(() => undefined);
          signal.throwIfAborted();
        }
        const onCancel = () => { void sandbox.kill().catch(() => undefined); };
        signal.addEventListener("abort", onCancel, { once: true });
        try {
          const build = await this.compileAndStart(projectId, sandbox, signal);
          signal.throwIfAborted();
          const deployment = {
            status: "success" as const,
            createdAt: new Date().toISOString(),
            versionId: randomUUID(),
          };
          const current = localProjectStore.getRecord(projectId);
          if (!current) throw new Error(`Project ${projectId} disappeared during deployment`);
          const deploymentFields = {
            serverStatus: "Active" as const,
            previewUrl: persistentPreviewPath(projectId),
            productionProjectUrl: persistentPreviewUrl(projectId),
            sandboxId: undefined,
            deployment,
          };
          // Never advertise a successful preview before the transactional
          // artifact snapshot commits. An aborted transaction keeps the last
          // deployed version visible (or keeps this project unready).
          await durableProjectStore.saveDeployment({ ...current, ...deploymentFields }, build.files, signal);
          signal.throwIfAborted();
          localProjectStore.update(projectId, deploymentFields);
          await sandbox.kill().catch(() => undefined);
          this.activeSandboxes.delete(projectId);
          this.activeUrls.delete(projectId);
          console.log(`[E2B] Build verified and deployed persistently for ${projectId}`);
          return persistentPreviewPath(projectId);
        } finally {
          signal.removeEventListener("abort", onCancel);
        }
      } catch (error) {
        const sandbox = this.activeSandboxes.get(projectId);
        if (sandbox) await sandbox.kill().catch(() => undefined);
        this.activeSandboxes.delete(projectId);
        this.activeUrls.delete(projectId);
        if (!signal.aborted) localProjectStore.update(projectId, {
          serverStatus: "Error",
          sandboxId: undefined,
          deployment: {
            status: "error",
            createdAt: new Date().toISOString(),
            errorMessage: errorText(error),
          },
        });
        throw error;
      }
    });

    this.initializing.set(projectId, {
      promise: initialization,
      rebuild: Boolean(options.rebuild),
      controller: initializationController,
    });
    const clearInitialization = () => {
      if (this.initializing.get(projectId)?.promise === initialization) {
        this.initializing.delete(projectId);
      }
    };
    void initialization.then(clearInitialization, clearInitialization);
    return initialization;
  }

  public async stopDevServer(projectId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(projectId);
    if (sandbox) await sandbox.kill().catch(() => undefined);
    this.activeSandboxes.delete(projectId);
    this.activeUrls.delete(projectId);
    localSandboxManager.stopDevServer(projectId);
    localProjectStore.update(projectId, {
      serverStatus: "Stopped",
      sandboxId: undefined,
    });
  }

  public async cancelBuild(projectId: string): Promise<void> {
    this.initializing.get(projectId)?.controller?.abort();
    localSandboxManager.cancelBuild(projectId);
    const sandbox = this.activeSandboxes.get(projectId);
    if (sandbox) await sandbox.kill().catch(() => undefined);
    this.activeSandboxes.delete(projectId);
    this.activeUrls.delete(projectId);
  }
}

export const e2bSandboxManager = new E2BSandboxManager();
