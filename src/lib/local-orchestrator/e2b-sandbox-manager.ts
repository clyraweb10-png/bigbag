import fs from "fs";
import path from "path";
import { Sandbox } from "e2b";
import { localProjectStore } from "./project-store";
import { localSandboxManager } from "./sandbox-manager";
import { purgeInvalidStaticHtml } from "./starter-template";

const PREVIEW_PORT = 3000;
const SANDBOX_TIMEOUT_MS = 3_600_000;
const INSTALL_TIMEOUT_MS = 180_000;
const BUILD_TIMEOUT_MS = 180_000;
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  "dist",
  "build",
]);

type StartOptions = {
  /** Re-sync, compile, and restart even when the current preview is healthy. */
  rebuild?: boolean;
};

type SharedE2BState = {
  activeSandboxes: Map<string, Sandbox>;
  activeUrls: Map<string, string>;
  initializing: Map<string, { promise: Promise<string>; rebuild: boolean }>;
};

const stateKey = Symbol.for("bigbag.local-orchestrator.e2b-state");
const globalState = globalThis as typeof globalThis & { [stateKey]?: SharedE2BState };
const sharedState = globalState[stateKey] || {
  activeSandboxes: new Map<string, Sandbox>(),
  activeUrls: new Map<string, string>(),
  initializing: new Map<string, { promise: Promise<string>; rebuild: boolean }>(),
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
    return this.activeUrls.get(projectId) || null;
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

  private async previewIsReady(previewUrl: string): Promise<boolean> {
    try {
      const response = await fetch(previewUrl, {
        signal: AbortSignal.timeout(4_000),
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async connectOrCreate(projectId: string, apiKey: string): Promise<Sandbox> {
    const active = this.activeSandboxes.get(projectId);
    if (active && (await active.isRunning().catch(() => false))) return active;

    this.activeSandboxes.delete(projectId);
    this.activeUrls.delete(projectId);

    const savedId = localProjectStore.getRecord(projectId)?.sandboxId;
    if (savedId) {
      try {
        const resumed = await Sandbox.connect(savedId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });
        // Restricted preview traffic from older sandboxes cannot be reached by
        // the current same-origin proxy, so replace those instances once.
        if (resumed.trafficAccessToken) {
          await resumed.kill().catch(() => undefined);
        } else {
          await resumed.setTimeout(SANDBOX_TIMEOUT_MS);
          this.activeSandboxes.set(projectId, resumed);
          return resumed;
        }
      } catch (error) {
        console.warn(`[E2B] Could not resume ${savedId}: ${errorText(error)}`);
      }
      localProjectStore.update(projectId, { sandboxId: undefined, previewUrl: undefined });
    }

    const sandbox = await Sandbox.create({
      apiKey,
      timeoutMs: SANDBOX_TIMEOUT_MS,
      // Keep E2B's control-plane/envd API token-protected. Application preview
      // ports remain reachable through our authenticated same-origin proxy;
      // verified against this SDK because `secure` governs envd, not app ports.
      secure: true,
      metadata: { projectId },
      envs: Object.fromEntries(
        ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"].flatMap((key) => process.env[key] ? [[key, process.env[key] as string]] : [])
      ),
    });
    this.activeSandboxes.set(projectId, sandbox);
    return sandbox;
  }

  private async compileAndStart(projectId: string, sandbox: Sandbox): Promise<string> {
    await this.syncAllWorkspaceFiles(projectId, sandbox);

    try {
      await sandbox.commands.run(
        "npm install --legacy-peer-deps --no-audit --no-fund",
        { timeoutMs: INSTALL_TIMEOUT_MS }
      );
    } catch (error) {
      throw commandFailure("Dependency installation failed", error);
    }

    // A successful HTML response from Vite does not prove imported TSX compiles.
    // Build first so broken generations never get labelled as successful.
    try {
      await sandbox.commands.run("npm run build", { timeoutMs: BUILD_TIMEOUT_MS });
    } catch (error) {
      throw commandFailure("Generated app failed to compile", error);
    }

    await sandbox.commands.run(
      "pkill -f '[n]ext.*start.*3000' || true; pkill -f '[n]ext-server' || true; pkill -f '[v]ite.*--port 3000' || true",
      { timeoutMs: 10_000 }
    );
    await sandbox.commands.run(
      "npm run start -- --hostname 0.0.0.0 --port 3000 > /tmp/bigbag-preview.log 2>&1",
      { background: true, timeoutMs: 0 }
    );

    const previewUrl = `https://${sandbox.getHost(PREVIEW_PORT)}`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await this.previewIsReady(previewUrl)) return previewUrl;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const logs = await sandbox.commands
      .run("tail -n 120 /tmp/bigbag-preview.log 2>/dev/null || true", { timeoutMs: 10_000 })
      .then((result) => boundedLog(result.stdout || result.stderr))
      .catch(() => "No preview logs were available");
    throw new Error(`Preview server did not become ready:\n${logs}`);
  }

  public async startDevServer(projectId: string, options: StartOptions = {}): Promise<string> {
    purgeInvalidStaticHtml(localProjectStore.getWorkspaceDir(projectId));
    localSandboxManager.ensureProjectTemplate(projectId);

    if (!this.isE2BEnabled()) {
      return localSandboxManager.startDevServer(projectId, options);
    }

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
        return this.startDevServer(projectId, { rebuild: true });
      };
      return ongoing.promise.then(rebuildAfterOngoing, rebuildAfterOngoing);
    }

    // Defer the body to the next microtask so the shared promise is registered
    // before even the first readiness probe can yield to another request.
    const initialization = Promise.resolve().then(async () => {
      try {
        const existingUrl = this.activeUrls.get(projectId);
        if (!options.rebuild && existingUrl && (await this.previewIsReady(existingUrl))) {
          return existingUrl;
        }

        const apiKey = process.env.E2B_API_KEY;
        if (!apiKey) throw new Error("E2B_API_KEY is not configured");

        localProjectStore.update(projectId, { serverStatus: "Starting" });
        const sandbox = await this.connectOrCreate(projectId, apiKey);
        const previewUrl = await this.compileAndStart(projectId, sandbox);
        this.activeUrls.set(projectId, previewUrl);
        localProjectStore.update(projectId, {
          serverStatus: "Active",
          previewUrl,
          sandboxId: sandbox.sandboxId,
        });
        console.log(`[E2B] Preview ready for ${projectId}`);
        return previewUrl;
      } catch (error) {
        const sandbox = this.activeSandboxes.get(projectId);
        if (sandbox) await sandbox.kill().catch(() => undefined);
        this.activeSandboxes.delete(projectId);
        this.activeUrls.delete(projectId);
        localProjectStore.update(projectId, {
          serverStatus: "Error",
          previewUrl: undefined,
          sandboxId: undefined,
        });
        throw error;
      }
    });

    this.initializing.set(projectId, {
      promise: initialization,
      rebuild: Boolean(options.rebuild),
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
      previewUrl: undefined,
      sandboxId: undefined,
    });
  }
}

export const e2bSandboxManager = new E2BSandboxManager();
