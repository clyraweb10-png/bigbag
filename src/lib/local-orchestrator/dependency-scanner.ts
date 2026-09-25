import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { ALWAYS_AVAILABLE_PACKAGES, PREINSTALLED_DEPENDENCIES, PREINSTALLED_DEV_DEPENDENCIES } from "./starter-template";
import { generatedProcessEnvironment } from "./process-env";

/**
 * Node.js built-in modules that should never be npm-installed.
 */
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "sys", "timers", "tls", "trace_events", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

/**
 * Packages that are always available because they ship with the workspace
 * Vite template or are peer-provided by React.
 */
const ALWAYS_AVAILABLE = ALWAYS_AVAILABLE_PACKAGES;

/**
 * Extra packages the model may request. Keep this deliberately small and pin
 * every version so rebuilding the same generated workspace stays reproducible.
 * Unknown imports are left for the build/repair loop to reject instead of
 * installing arbitrary packages selected by model output.
 */
const ALLOWED_GENERATED_DEPENDENCIES = new Map<string, string>([
  // Restored projects may retain a server-exclusive legacy database client.
  ["@libsql/client", "0.18.0"],
  ["@hookform/resolvers", "5.2.2"],
  ["@radix-ui/react-accordion", "1.2.12"],
  ["@radix-ui/react-dialog", "1.1.15"],
  ["@radix-ui/react-dropdown-menu", "2.1.16"],
  ["@radix-ui/react-select", "2.2.6"],
  ["@radix-ui/react-switch", "1.2.6"],
  ["@radix-ui/react-tabs", "1.1.13"],
  ["@radix-ui/react-tooltip", "1.2.8"],
  ["react-router-dom", "7.9.4"],
  ["zod", "4.1.12"],
]);

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;
const REGISTRY_VERSION_TOKEN = /^(?:\^|~|>=|<=|>|<)?(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,2}(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;

function safeRegistryVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 &&
    value.split(/\s*\|\|\s*/).every((range) =>
      range.trim().split(/\s+/).every((token) => REGISTRY_VERSION_TOKEN.test(token)));
}

/**
 * Scan a list of generated file contents for third-party npm package imports.
 *
 * Returns a deduplicated list of bare specifiers (package names) that are NOT
 * Node built-ins and NOT in the always-available set.
 */
export function detectThirdPartyImports(
  files: Array<{ path: string; content: string }>,
  includeAlwaysAvailable = false
): string[] {
  const found = new Set<string>();

  const importPatterns = [
    /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"./][^'"]*)['"]/g,
    /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
  ];

  for (const file of files) {
    if (!file.path.match(/\.(tsx?|jsx?|mjs|cjs)$/)) continue;

    for (const pattern of importPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(file.content)) !== null) {
        let specifier = match[1];
        if (specifier.startsWith("@")) {
          const parts = specifier.split("/");
          specifier = parts.slice(0, 2).join("/");
        } else {
          specifier = specifier.split("/")[0];
        }

        if (NODE_BUILTINS.has(specifier)) continue;
        if (!includeAlwaysAvailable && ALWAYS_AVAILABLE.has(specifier)) continue;
        if (specifier.startsWith("@/")) continue;
        if (!PACKAGE_NAME.test(specifier)) continue;

        found.add(specifier);
      }
    }
  }

  return Array.from(found);
}

/**
 * Persist model-requested packages in the generated workspace. The sandbox owns
 * installation; mutating the app builder's package.json at runtime made Render
 * deployments slow, non-reproducible, and still left the generated app missing
 * the package it imported.
 */
export async function ensureWorkspaceDependencies(
  files: Array<{ path: string; content: string }>,
  workspaceDir: string,
  signal?: AbortSignal
): Promise<{ added: string[]; installed: string[]; failed: string[] }> {
  const existingSources: Array<{ path: string; content: string }> = [];
  const visit = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && !["node_modules", "dist", "build", ".next", ".git"].includes(entry.name)) visit(full);
      else if (entry.isFile() && /\.(?:tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
        existingSources.push({ path: path.relative(workspaceDir, full), content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  for (const directory of ["src", "app", "pages"]) visit(path.join(/* turbopackIgnore: true */ workspaceDir, directory));
  const allSources = [...existingSources, ...files];
  const requested = detectThirdPartyImports(allSources);
  const imported = new Set(detectThirdPartyImports(allSources, true));
  const unsupported = requested.filter((name) => !ALLOWED_GENERATED_DEPENDENCIES.has(name));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported generated dependency: ${unsupported.join(", ")}. Replace the import with an installed React, CSS, or browser implementation.`
    );
  }
  const packagePath = path.join(workspaceDir, "package.json");
  let pkg: {
    dependencies?: Record<string, string>;
  } = {};

  if (fs.existsSync(packagePath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        pkg = parsed as { dependencies?: Record<string, string> };
      }
    } catch (error) {
      console.warn("[dependency-scanner] Repairing an unreadable generated package.json:", error);
    }
  }

  const dependencies =
    pkg.dependencies && typeof pkg.dependencies === "object" && !Array.isArray(pkg.dependencies)
      ? { ...pkg.dependencies }
      : {};

  // Old model output may leave an unused unsupported package in a restored
  // manifest. Remove that declaration before npm install, while preserving a
  // diagnostic above if any current source still imports the package.
  let manifestChanged = false;
  for (const name of Object.keys(dependencies)) {
    // The starter advertises a broad installed stack for model generation,
    // but each E2B worker installs its manifest afresh. Remove unused starter
    // packages before the build so a basic app does not pay for charts, motion,
    // browser test utilities, and other optional dependencies it never uses.
    if (name !== "react" && name !== "react-dom" && name !== "jsdom" &&
        PREINSTALLED_DEPENDENCIES[name] && !imported.has(name)) {
      delete dependencies[name];
      manifestChanged = true;
    } else if (!ALWAYS_AVAILABLE.has(name) && !ALLOWED_GENERATED_DEPENDENCIES.has(name)) {
      delete dependencies[name];
      manifestChanged = true;
    } else if (!safeRegistryVersion(dependencies[name])) {
      const pinned = ALLOWED_GENERATED_DEPENDENCIES.get(name) ||
        PREINSTALLED_DEPENDENCIES[name] || PREINSTALLED_DEV_DEPENDENCIES[name];
      if (pinned) dependencies[name] = pinned;
      else delete dependencies[name];
      manifestChanged = true;
    }
  }

  const added: string[] = [];
  for (const name of imported) {
    const version = PREINSTALLED_DEPENDENCIES[name];
    if (version && !dependencies[name]) {
      dependencies[name] = version;
      added.push(name);
      manifestChanged = true;
    }
  }
  for (const name of requested) {
    if (!dependencies[name]) {
      const version = ALLOWED_GENERATED_DEPENDENCIES.get(name)!;
      dependencies[name] = version;
      added.push(name);
      manifestChanged = true;
    }
  }

  if (manifestChanged && fs.existsSync(packagePath)) {
    pkg.dependencies = dependencies;
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
  }

  // Check missing packages and run real install if needed
  const nodeModulesDir = path.join(workspaceDir, "node_modules");
  const allNeeded = [...new Set([...requested, ...Object.keys(dependencies)])];
  const missing = findMissingPackages(nodeModulesDir, allNeeded).filter(
    (name) => !ALWAYS_AVAILABLE.has(name) && !NODE_BUILTINS.has(name)
  );

  let installResult = { installed: [] as string[], failed: [] as string[] };
  if (missing.length > 0) {
    installResult = await installPackages(workspaceDir, missing, dependencies, signal);
  }
  if (installResult.failed.length > 0) {
    throw new Error(
      `Dependency installation failed for ${installResult.failed.join(", ")}. Replace these optional imports with installed React, CSS, or browser code.`
    );
  }

  return { added, installed: installResult.installed, failed: installResult.failed };
}

/**
 * Check which packages from the list are NOT present in node_modules.
 */
export function findMissingPackages(
  nodeModulesDir: string,
  packages: string[]
): string[] {
  return packages.filter((pkg) => {
    const pkgDir = path.join(nodeModulesDir, ...pkg.split("/"));
    return !fs.existsSync(pkgDir);
  });
}

/**
 * Install packages into the given directory using npm.
 * Returns the list of packages that were successfully installed.
 */
export async function installPackages(
  targetDir: string,
  packages: string[],
  versions: Record<string, string> = {},
  signal?: AbortSignal
): Promise<{ installed: string[]; failed: string[] }> {
  if (packages.length === 0) return { installed: [], failed: [] };
  const unsupported = packages.filter((name) => !ALLOWED_GENERATED_DEPENDENCIES.has(name));
  if (unsupported.length > 0) throw new Error(`Unsupported generated dependency: ${unsupported.join(", ")}`);

  const installed: string[] = [];
  const failed: string[] = [];

  console.log(
    `[dep-scanner] Installing ${packages.length} missing packages: ${packages.join(", ")}`
  );

  const runInstall = (requested: string[], timeout: number): Promise<void> => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    execFile(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--legacy-peer-deps", "--no-audit", "--no-fund", "--", ...requested.map((name) => `${name}@${safeRegistryVersion(versions[name]) ? versions[name] : ALLOWED_GENERATED_DEPENDENCIES.get(name)!}`)],
      {
        cwd: targetDir,
        timeout,
        signal,
        maxBuffer: 1024 * 1024,
        shell: process.platform === "win32",
        env: generatedProcessEnvironment("development"),
      },
      (error, _stdout, stderr) => {
        if (!error) return resolve();
        if (signal?.aborted) return reject(signal.reason);
        const npmCode = stderr.match(/\b(?:E404|ETARGET|ENOVERSIONS|ERESOLVE|EINVALIDTAGNAME)\b/)?.[0];
        reject(new Error(`npm install failed${npmCode ? ` (${npmCode})` : ""}`));
      }
    );
  });

  try {
    await runInstall(packages, 120_000);
    installed.push(...packages);
    console.log(`[dep-scanner] Successfully installed: ${packages.join(", ")}`);
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.warn(`[dep-scanner] Batch install failed, trying one by one...`);

    for (const pkg of packages) {
      try {
        await runInstall([pkg], 60_000);
        installed.push(pkg);
        console.log(`[dep-scanner] Installed: ${pkg}`);
      } catch (pkgErr: any) {
        if (signal?.aborted) throw pkgErr;
        failed.push(pkg);
        console.error(
          `[dep-scanner] Failed to install ${pkg}:`,
          pkgErr.message || pkgErr
        );
      }
    }
  }

  return { installed, failed };
}

/**
 * Full pipeline: scan files → detect imports → find missing → install.
 * Returns which packages were installed and which failed.
 */
export async function autoInstallDependencies(
  files: Array<{ path: string; content: string }>,
  rootDir: string
): Promise<{ installed: string[]; failed: string[] }> {
  const imports = detectThirdPartyImports(files);
  const unsupported = imports.filter((name) => !ALLOWED_GENERATED_DEPENDENCIES.has(name));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported generated dependency: ${unsupported.join(", ")}`);
  }
  if (imports.length === 0) {
    console.log("[dep-scanner] No third-party imports detected.");
    return { installed: [], failed: [] };
  }

  console.log(
    `[dep-scanner] Detected third-party imports: ${imports.join(", ")}`
  );

  const nodeModulesDir = path.join(rootDir, "node_modules");
  const missing = findMissingPackages(nodeModulesDir, imports);

  if (missing.length === 0) {
    console.log("[dep-scanner] All detected packages are already installed.");
    return { installed: [], failed: [] };
  }

  console.log(`[dep-scanner] Missing packages: ${missing.join(", ")}`);
  return installPackages(rootDir, missing);
}

/**
 * Parse a compiler/build error to extract a missing module name.
 * Works with Next.js / Turbopack / Webpack error messages.
 */
export function extractMissingModuleFromError(
  errorText: string
): string | null {
  const patterns = [
    /Module not found:\s*(?:Error:\s*)?Can't resolve\s+'([^']+)'/i,
    /Cannot find module\s+'([^']+)'/i,
    /Module not found:\s*(?:Error:\s*)?(?:Can't|Cannot) resolve\s+'([^']+)'/i,
    /Error:\s*Cannot find package\s+'([^']+)'/i,
    /error\s*\[ERR_MODULE_NOT_FOUND\]:\s*Cannot find package\s+'([^']+)'/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(errorText);
    if (match) {
      let specifier = match[1];
      if (specifier.startsWith("@")) {
        const parts = specifier.split("/");
        specifier = parts.slice(0, 2).join("/");
      } else {
        specifier = specifier.split("/")[0];
      }
      if (NODE_BUILTINS.has(specifier)) return null;
      if (ALWAYS_AVAILABLE.has(specifier)) return null;
      if (specifier.startsWith(".") || specifier.startsWith("@/")) return null;
      return specifier;
    }
  }

  return null;
}
