import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GENERATED_RUNTIME_CHECK_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fileURLToPath, pathToFileURL } = require("node:url");

async function main() {
  const root = path.resolve(process.argv[2] || "dist");
  const moduleRoot = path.resolve(process.argv[3] || "node_modules");
  const { JSDOM } = require(path.join(moduleRoot, "jsdom"));
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const errors = [];
  const dom = new JSDOM(html, {
    // Match the same-origin route contract used by real generated previews so
    // the browser-safe project database client can initialize during validation.
    url: "http://preview.invalid/api/preview/runtime-validation/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  window.addEventListener("error", event => errors.push(event.error?.stack || event.message));
  window.addEventListener("unhandledrejection", event => errors.push(event.reason?.stack || String(event.reason)));
  window.matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  window.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo ||= () => {};
  const executableTypes = new Set(["", "text/javascript", "application/javascript", "module"]);
  const scripts = [...window.document.querySelectorAll("script[src]")]
    .map(element => ({
      src: element.getAttribute("src") || "",
      type: (element.getAttribute("type") || "").trim().toLowerCase(),
      noModule: element.hasAttribute("nomodule"),
    }))
    .filter(script => script.src && executableTypes.has(script.type) && !script.noModule);
  if (scripts.length === 0) throw new Error("Built preview has no executable script");
  const context = dom.getInternalVMContext();
  vm.runInContext([
    'class ValidatorHeaders {',
    '  constructor(values = {}) {',
    '    this._values = new Map();',
    '    if (values && typeof values !== "string" && values[Symbol.iterator]) {',
    '      for (const entry of values) { if (!entry || entry.length !== 2) throw new TypeError("Invalid header entry"); this.append(entry[0], entry[1]); }',
    '    } else { for (const [key, value] of Object.entries(values || {})) this.append(key, value); }',
    '  }',
    '  normalize(name) { const value = String(name).trim().toLowerCase(); if (!value) throw new TypeError("Invalid header name"); return value; }',
    '  get(name) { return this._values.get(this.normalize(name)) || null; }',
    '  set(name, value) { this._values.set(this.normalize(name), String(value).trim()); }',
    '  append(name, value) { const key = this.normalize(name); const next = String(value).trim(); this._values.set(key, this._values.has(key) ? this._values.get(key) + ", " + next : next); }',
    '  has(name) { return this._values.has(this.normalize(name)); }',
    '  delete(name) { this._values.delete(this.normalize(name)); }',
    '  entries() { return this._values.entries(); }',
    '  keys() { return this._values.keys(); }',
    '  values() { return this._values.values(); }',
    '  forEach(callback, thisArg) { for (const [key, value] of this._values) callback.call(thisArg, value, key, this); }',
    '  [Symbol.iterator]() { return this.entries(); }',
    '}',
    'class ValidatorResponse {',
    '  constructor(body = "", init = {}) {',
    '    this.body = String(body); this.status = init.status || 200;',
    '    this.ok = this.status >= 200 && this.status < 300;',
    '    this.headers = new ValidatorHeaders(init.headers || {});',
    '  }',
    '  async json() { return JSON.parse(this.body); }',
    '  async text() { return this.body; }',
    '  clone() { return new ValidatorResponse(this.body, { status: this.status, headers: this.headers }); }',
    '}',
    'class ValidatorRequest { constructor(input, init = {}) { this.url = String(input); Object.assign(this, init); } }',
    'globalThis.Headers = ValidatorHeaders;',
    'globalThis.Response = ValidatorResponse;',
    'globalThis.Request = ValidatorRequest;',
    'globalThis.__BIGBAG_WRITE_CAPABILITY__ = "runtime-validation-capability";',
    'globalThis.__BIGBAG_GUEST_CAPABILITY__ = "runtime-validation-guest";',
    'let authStorageValue = null;',
    'globalThis.fetch = async (input, init = {}) => {',
    '  const url = new URL(String(input), globalThis.location.href);',
    '  const prefix = "/api/preview/runtime-validation/__bigbag/data/";',
    '  const authConfig = "/api/preview/runtime-validation/__bigbag/auth/config";',
    '  const authStorage = "/api/preview/runtime-validation/__bigbag/auth/storage";',
    '  if (url.origin === globalThis.location.origin && url.pathname === authConfig) {',
    '    return new ValidatorResponse(JSON.stringify({ data: { url: "https://runtime-validation.supabase.invalid", anonKey: "runtime-validation-anon-key" } }), { status: 200, headers: { "content-type": "application/json" } });',
    '  }',
    '  if (url.origin === globalThis.location.origin && url.pathname === authStorage) {',
    '    const method = String(init.method || "GET").toUpperCase();',
    '    if (method === "POST") authStorageValue = JSON.parse(String(init.body || "{}")).value;',
    '    if (method === "DELETE") authStorageValue = null;',
    '    return new ValidatorResponse(JSON.stringify(method === "GET" ? { value: authStorageValue } : { ok: true }), { status: 200, headers: { "content-type": "application/json" } });',
    '  }',
    '  if (url.origin !== globalThis.location.origin || !url.pathname.startsWith(prefix)) throw new Error("Runtime validation blocked a non-platform network request");',
    '  const method = String(init.method || "GET").toUpperCase();',
    '  const headers = new ValidatorHeaders(init.headers || {});',
    '  if (["POST", "PATCH", "DELETE"].includes(method) && headers.get("X-BigBag-Capability") !== globalThis.__BIGBAG_WRITE_CAPABILITY__) {',
    '    return new ValidatorResponse(JSON.stringify({ error: "Missing or invalid preview write capability" }), { status: 401, headers: { "content-type": "application/json" } });',
    '  }',
    '  const suffix = url.pathname.slice(prefix.length).split("/").filter(Boolean);',
    '  const data = method === "DELETE" ? { deleted: true } : method === "GET" && suffix.length === 1 ? { records: [], total: 0 } : { _id: suffix[1] || "runtime-validation-record", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };',
    '  return new ValidatorResponse(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });',
    '};',
  ].join("\n"), context);
  const modules = new Map();
  const safeModulePath = (specifier, parentIdentifier) => {
    const resolvedUrl = new URL(specifier, parentIdentifier);
    if (resolvedUrl.protocol !== "file:") throw new Error("Built preview requested a non-local module");
    const fullPath = path.resolve(fileURLToPath(resolvedUrl));
    if (!fullPath.startsWith(root + path.sep)) throw new Error("Built preview references a module outside dist");
    return fullPath;
  };
  const moduleFor = fullPath => {
    const cached = modules.get(fullPath);
    if (cached) return cached;
    const module = new vm.SourceTextModule(fs.readFileSync(fullPath, "utf8"), {
      context,
      identifier: pathToFileURL(fullPath).href,
      initializeImportMeta(meta) { meta.url = pathToFileURL(fullPath).href; },
      importModuleDynamically: async (specifier, referencingModule) => {
        const child = moduleFor(safeModulePath(specifier, referencingModule.identifier));
        if (child.status === "unlinked") await child.link(linker);
        if (child.status === "linked") await child.evaluate();
        return child;
      },
    });
    modules.set(fullPath, module);
    return module;
  };
  const linker = async (specifier, referencingModule) =>
    moduleFor(safeModulePath(specifier, referencingModule.identifier));

  for (const script of scripts) {
    const scriptUrl = new URL(script.src, "http://preview.invalid/");
    if (scriptUrl.origin !== "http://preview.invalid") {
      throw new Error("Built preview references a non-local script URL");
    }
    const sourcePath = scriptUrl.pathname.replace(/^\/+/, "");
    const fullPath = path.resolve(root, sourcePath);
    if (!fullPath.startsWith(root + path.sep)) throw new Error("Built preview references an unsafe script path");
    if (script.type === "module") {
      const module = moduleFor(fullPath);
      if (module.status === "unlinked") await module.link(linker);
      if (module.status === "linked") await module.evaluate();
    } else {
      new vm.Script(fs.readFileSync(fullPath, "utf8"), { filename: fullPath }).runInContext(context);
    }
  }
  const appRoot = window.document.getElementById("root");
  const validationDeadline = Date.now() + 5_000;
  while (appRoot && appRoot.childNodes.length === 0 && Date.now() < validationDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!appRoot || appRoot.childNodes.length === 0) errors.push("React preview rendered no content");
  while (Date.now() < validationDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  dom.window.close();
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

main().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
`;

export async function validateGeneratedRuntime(workspaceDir: string): Promise<void> {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-runtime-check-"));
  try {
    const bubblewrapPath = "/usr/bin/bwrap";
    const prlimitPath = "/usr/bin/prlimit";
    if (!fs.existsSync(bubblewrapPath)) {
      // Bubblewrap is a Linux-only network-isolation tool. In non-Linux
      // development environments (Windows, macOS) it is not available; skip the
      // sandboxed validation step rather than aborting the entire build pipeline.
      // In production Linux deployments the tool IS present and the full check runs.
      console.warn("[runtime-validator] Skipping sandboxed runtime validation: bubblewrap (bwrap) is not available on this host");
      return;
    }
    if (!fs.existsSync(prlimitPath)) {
      console.warn("[runtime-validator] Skipping sandboxed runtime validation: prlimit is not available on this host");
      return;
    }
    const scriptPath = path.join(temporaryDirectory, "validate.cjs");
    const moduleRootCandidate = path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules");
    if (!fs.existsSync(path.join(moduleRootCandidate, "jsdom", "package.json"))) {
      throw new Error("Trusted runtime-validation dependencies are unavailable");
    }
    const moduleRoot = fs.realpathSync(moduleRootCandidate);
    const unresolvedDistRoot = path.join(workspaceDir, "dist");
    if (fs.lstatSync(unresolvedDistRoot).isSymbolicLink()) {
      throw new Error("Generated-app runtime validation rejected symlink: dist");
    }
    const distRoot = fs.realpathSync(unresolvedDistRoot);
    const rejectGeneratedSymlinks = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error(`Generated-app runtime validation rejected symlink: ${path.relative(distRoot, fullPath)}`);
        }
        if (entry.isDirectory()) rejectGeneratedSymlinks(fullPath);
      }
    };
    rejectGeneratedSymlinks(distRoot);
    fs.writeFileSync(scriptPath, GENERATED_RUNTIME_CHECK_SCRIPT);
    await import("node:child_process").then(({ execFile }) => new Promise<void>((resolve, reject) => {
      const sandboxScript = "/sandbox/validate.cjs";
      const sandboxDist = "/sandbox/dist";
      const sandboxModules = "/sandbox/node_modules";
      const nodeArgs = [
        "--permission",
        `--allow-fs-read=${sandboxScript}`,
        `--allow-fs-read=${sandboxDist}`,
        `--allow-fs-read=${sandboxModules}`,
        "--max-old-space-size=512",
        "--experimental-vm-modules",
        sandboxScript,
        sandboxDist,
        sandboxModules,
      ];
      const libraryMountArgs = [
        "--dir", "/usr",
        "--ro-bind", "/usr/lib", "/usr/lib",
        "--symlink", "usr/lib", "/lib",
        ...(fs.existsSync("/usr/lib64")
          ? ["--ro-bind", "/usr/lib64", "/usr/lib64", "--symlink", "usr/lib64", "/lib64"]
          : []),
      ];
      const bubblewrapArgs = [
        "--unshare-net",
        "--unshare-pid",
        "--die-with-parent",
        "--new-session",
        "--ro-bind", process.execPath, "/node",
        ...libraryMountArgs,
        "--dir", "/sandbox",
        "--ro-bind", scriptPath, sandboxScript,
        "--ro-bind", distRoot, sandboxDist,
        "--ro-bind", moduleRoot, sandboxModules,
        "--tmpfs", "/tmp",
        "--dev", "/dev",
        "--",
        "/node",
        ...nodeArgs,
      ];
      execFile(prlimitPath, [
        "--as=2147483648",
        "--",
        bubblewrapPath,
        ...bubblewrapArgs,
      ], {
        cwd: temporaryDirectory,
        timeout: 30_000,
        env: { NODE_ENV: "production" },
      }, (error, _stdout, stderr) => {
        if (error) reject(new Error(`Generated app failed runtime validation${stderr.trim() ? `:\n${stderr.trim()}` : ""}`));
        else resolve();
      });
    }));
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
