import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  GENERATED_CORE_DEPENDENCIES,
  GENERATED_CORE_DEV_DEPENDENCIES,
  PREINSTALLED_DEPENDENCIES,
} from "./starter-template";

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
 * Packages that every generated Next.js workspace installs before its first
 * build. Everything else is added only when generated source imports it.
 */
const ALWAYS_AVAILABLE = new Set([
  ...Object.keys(GENERATED_CORE_DEPENDENCIES),
  ...Object.keys(GENERATED_CORE_DEV_DEPENDENCIES),
]);

/**
 * Extra packages the model may request. Keep the catalog controlled and pin
 * every version so rebuilding the same generated workspace stays reproducible.
 * Unknown imports are left for the build/repair loop to reject instead of
 * installing arbitrary packages selected by model output.
 */
const ALLOWED_GENERATED_DEPENDENCIES = new Map<string, string>(
  Object.entries(PREINSTALLED_DEPENDENCIES)
);

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;

/**
 * Scan a list of generated file contents for third-party npm package imports.
 *
 * Returns a deduplicated list of bare specifiers (package names) that are NOT
 * Node built-ins and NOT in the always-available set.
 */
export function detectThirdPartyImports(
  files: Array<{ path: string; content: string }>
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
        if (ALWAYS_AVAILABLE.has(specifier)) continue;
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
export function ensureWorkspaceDependencies(
  files: Array<{ path: string; content: string }>,
  workspaceDir: string
): { added: string[]; removed: string[] } {
  const workspaceFiles: Array<{ path: string; content: string }> = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git", "dist", "build"].includes(entry.name) || entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && /\.(?:tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
        workspaceFiles.push({ path: path.relative(workspaceDir, fullPath), content: fs.readFileSync(fullPath, "utf8") });
      }
    }
  };
  walk(workspaceDir);
  const requested = detectThirdPartyImports([...workspaceFiles, ...files]);

  const packagePath = path.join(workspaceDir, "package.json");
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
  } = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("package.json must contain an object");
    }
    pkg = parsed as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      [key: string]: unknown;
    };
  } catch (error) {
    console.warn("[dependency-scanner] Repairing an unreadable generated package.json:", error);
  }
  const previousDependencies =
    pkg.dependencies && typeof pkg.dependencies === "object" && !Array.isArray(pkg.dependencies)
      ? { ...pkg.dependencies }
      : {};
  const dependencies: Record<string, string> = { ...GENERATED_CORE_DEPENDENCIES };
  for (const name of requested) {
    const allowedVersion = ALLOWED_GENERATED_DEPENDENCIES.get(name);
    if (allowedVersion) dependencies[name] = allowedVersion;
  }
  const added = Object.keys(dependencies).filter((name) => !previousDependencies[name]);
  const removed = Object.keys(previousDependencies).filter((name) => !dependencies[name]);

  pkg.dependencies = dependencies;
  pkg.devDependencies = GENERATED_CORE_DEV_DEPENDENCIES;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

  return { added, removed };
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
export function installPackages(
  targetDir: string,
  packages: string[]
): { installed: string[]; failed: string[] } {
  if (packages.length === 0) return { installed: [], failed: [] };

  const installed: string[] = [];
  const failed: string[] = [];

  console.log(
    `[dep-scanner] Installing ${packages.length} missing packages: ${packages.join(", ")}`
  );

  const runInstall = (requested: string[], timeout: number) =>
    spawnSync(
      "npm",
      ["install", "--legacy-peer-deps", "--no-audit", "--no-fund", "--", ...requested],
      {
        cwd: targetDir,
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development" },
        encoding: "utf8",
      }
    );

  try {
    const batch = runInstall(packages, 120_000);
    if (batch.error) throw batch.error;
    if (batch.status !== 0) {
      throw new Error(batch.stderr || `npm exited with status ${batch.status}`);
    }
    installed.push(...packages);
    console.log(`[dep-scanner] Successfully installed: ${packages.join(", ")}`);
  } catch (err: any) {
    console.warn(`[dep-scanner] Batch install failed, trying one by one...`);

    for (const pkg of packages) {
      try {
        const single = runInstall([pkg], 60_000);
        if (single.error) throw single.error;
        if (single.status !== 0) {
          throw new Error(single.stderr || `npm exited with status ${single.status}`);
        }
        installed.push(pkg);
        console.log(`[dep-scanner] Installed: ${pkg}`);
      } catch (pkgErr: any) {
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
export function autoInstallDependencies(
  files: Array<{ path: string; content: string }>,
  rootDir: string
): { installed: string[]; failed: string[] } {
  const imports = detectThirdPartyImports(files);
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
