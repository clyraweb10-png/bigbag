import fs from "fs";
import path from "path";
import ts from "typescript";

/**
 * Packages every generated app can import without waiting on npm.
 * They are installed on the platform itself; each workspace `node_modules`
 * is a junction/symlink to that shared tree (Lovable-style preinstall).
 */
export const PREINSTALLED_DEPENDENCIES: Record<string, string> = {
  react: "^19.0.0",
  "react-dom": "^19.0.0",
  "react-is": "^19.2.0",
  "lucide-react": "^0.536.0",
  clsx: "^2.1.1",
  "tailwind-merge": "^3.3.1",
  "class-variance-authority": "^0.7.1",
  "framer-motion": "^13.3.0",
  gsap: "^3.15.0",
  zustand: "^5.0.15",
  recharts: "^3.10.1",
  "date-fns": "^4.4.0",
  axios: "^1.20.0",
  "@tanstack/react-query": "^5.102.8",
  "canvas-confetti": "^1.9.4",
  "usehooks-ts": "^3.1.1",
  "embla-carousel-react": "^8.6.0",
  "@radix-ui/react-slot": "^1.2.3",
  "react-hook-form": "^7.62.0",
  "@supabase/supabase-js": "^2.116.0",
  sonner: "^2.0.7",
  jsdom: "^26.1.0",
  "@radix-ui/react-dialog": "^1.1.14",
  "@radix-ui/react-dropdown-menu": "^2.1.15",
  "@radix-ui/react-select": "^2.2.5",
  "@radix-ui/react-tabs": "^1.1.12",
  "@radix-ui/react-tooltip": "^1.2.7",
  "@radix-ui/react-popover": "^1.1.14",
  "@radix-ui/react-checkbox": "^1.3.2",
  "@radix-ui/react-switch": "^1.2.5",
  "@radix-ui/react-label": "^2.1.7",
  "@radix-ui/react-separator": "^1.1.7",
};

export const PREINSTALLED_DEV_DEPENDENCIES: Record<string, string> = {
  vite: "^6.3.5",
  "@vitejs/plugin-react": "^4.5.2",
  typescript: "^5.8.0",
  "@types/node": "^22.0.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
  tailwindcss: "^4.1.1",
  "@tailwindcss/postcss": "^4.1.4",
  postcss: "^8.5.6",
};

export const ALWAYS_AVAILABLE_PACKAGES = new Set([
  ...Object.keys(PREINSTALLED_DEPENDENCIES),
  ...Object.keys(PREINSTALLED_DEV_DEPENDENCIES),
]);

const VITE_LUCIDE_PLUGIN_SOURCE = `function directLucideImports() {
  return {
    name: "bigbag-direct-lucide-imports",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!/\\.[cm]?[jt]sx?$/.test(id) || !code.includes("lucide-react")) return null;
      const transformed = code.replace(
        /import\\s*\\{([^}]+)\\}\\s*from\\s*["']lucide-react["'];?/g,
        (_statement, rawBindings: string) => {
          const directImports: string[] = [];
          const retainedBindings: string[] = [];
          for (const raw of rawBindings.split(",")) {
            const binding = raw.trim();
            if (!binding || binding.startsWith("type ")) {
              if (binding) retainedBindings.push(binding);
              continue;
            }
            const parts = binding.split(/\\s+as\\s+/);
            const imported = parts[0];
            const local = parts[1] || imported;
            const fileName = imported
              .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
              .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
              .replace(/([A-Za-z])([0-9])/g, "$1-$2")
              .toLowerCase();
            const modulePath = __bigbagLucidePath.resolve(process.cwd(), "node_modules/lucide-react/dist/esm/icons/" + fileName + ".js");
            if (__bigbagLucideExistsSync(modulePath)) {
              directImports.push("import " + local + " from \\"lucide-react/dist/esm/icons/" + fileName + ".js\\";");
            } else {
              retainedBindings.push(binding);
            }
          }
          const retainedImport = retainedBindings.length
            ? "import { " + retainedBindings.join(", ") + " } from \\"lucide-react\\";"
            : "";
          return [retainedImport, ...directImports].filter(Boolean).join("\\n");
        }
      );
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}`;

/**
 * Browser-only client for the platform's project-scoped durable datastore.
 * Provider/database credentials stay in the builder server; generated bundles
 * contain only same-origin HTTP calls.
 */
const GENERATED_AUTH_CLIENT_MARKER = "// @bigbag-managed-auth-client";

export const GENERATED_AUTH_BRIDGE_SOURCE = `// @bigbag-managed-auth-bridge
type AuthTokenProvider = () => Promise<string | null>;

let tokenProvider: AuthTokenProvider | null = null;

export function registerAuthTokenProvider(provider: AuthTokenProvider): void {
  tokenProvider = provider;
}

export async function getPlatformAuthAccessToken(): Promise<string | null> {
  return tokenProvider ? tokenProvider() : null;
}
`;

export const GENERATED_AUTH_CLIENT_SOURCE = `${GENERATED_AUTH_CLIENT_MARKER}
import { createClient, type AuthChangeEvent, type Session, type User } from "@supabase/supabase-js";
import { registerAuthTokenProvider } from "@/lib/auth-bridge";

type AuthConfig = { url: string; anonKey: string };
type AuthUnsubscribe = (() => void) & { data: { subscription: { unsubscribe: () => void } } };
let clientPromise: ReturnType<typeof createClientPromise> | null = null;
let authUnavailable = false;

function previewBase(): string {
  const match = window.location.pathname.match(/^\\/api\\/preview\\/[^/]+/);
  if (!match) throw new Error("Authentication must run inside a BigBag preview");
  return match[0];
}

async function authStorageRequest(key: string, method: "GET" | "POST" | "DELETE", value?: string) {
  const capability = (window as Window & { __BIGBAG_GUEST_CAPABILITY__?: string })
    .__BIGBAG_GUEST_CAPABILITY__;
  if (!capability) throw new Error("Preview session authorization is unavailable");
  const response = await fetch(previewBase() + "/__bigbag/auth/storage?key=" + encodeURIComponent(key), {
    method,
    credentials: "include",
    headers: {
      "X-BigBag-Guest": capability,
      ...(value !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: value !== undefined ? JSON.stringify({ value }) : undefined,
  });
  const payload = await response.json().catch(() => null) as { value?: string | null; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || "Secure session storage failed");
  return payload?.value ?? null;
}

let previewSessionKey: string | null = null;
const transientAuthStorage = new Map<string, string>();

function getTransientAuthValue(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key) ?? transientAuthStorage.get(key) ?? null;
  } catch {
    return transientAuthStorage.get(key) ?? null;
  }
}

function setTransientAuthValue(key: string, value: string): void {
  transientAuthStorage.set(key, value);
  try { window.sessionStorage.setItem(key, value); } catch { /* opaque previews use the in-memory fallback */ }
}

function removeTransientAuthValue(key: string): void {
  transientAuthStorage.delete(key);
  try { window.sessionStorage.removeItem(key); } catch { /* opaque previews use the in-memory fallback */ }
}

const previewAuthStorage = {
  getItem(key: string) {
    if (key === previewSessionKey) return authStorageRequest(key, "GET");
    return Promise.resolve(getTransientAuthValue(key));
  },
  async setItem(key: string, value: string) {
    if (key === previewSessionKey) await authStorageRequest(key, "POST", value);
    else setTransientAuthValue(key, value);
  },
  async removeItem(key: string) {
    if (key === previewSessionKey) await authStorageRequest(key, "DELETE");
    else removeTransientAuthValue(key);
  },
};

async function createClientPromise() {
  const base = previewBase();
  previewSessionKey = "bigbag-preview-" + base.split("/").at(-1) + "-auth";
  const response = await fetch(base + "/__bigbag/auth/config", { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { data?: AuthConfig; error?: string } | null;
  if (response.status === 503) authUnavailable = true;
  if (!response.ok || !payload?.data) throw new Error(payload?.error || "Authentication is not configured");
  return createClient(payload.data.url, payload.data.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: previewAuthStorage,
      storageKey: previewSessionKey,
    },
  });
}

export function getAuthClient() {
  if (authUnavailable) return Promise.reject(new Error("Authentication is not configured"));
  clientPromise ||= createClientPromise().catch((error) => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

export async function getAuthAccessToken(): Promise<string | null> {
  try {
    const client = await getAuthClient();
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

registerAuthTokenProvider(getAuthAccessToken);

function onAuthStateChange(callback: (session: Session | null) => void): AuthUnsubscribe;
function onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): AuthUnsubscribe;
function onAuthStateChange(
  callback:
    | ((session: Session | null) => void)
    | ((event: AuthChangeEvent, session: Session | null) => void)
): AuthUnsubscribe {
  let active = true;
  let unsubscribe: (() => void) | undefined;
  void getAuthClient().then((client) => {
    if (!active) return;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (callback.length >= 2) {
        (callback as (event: AuthChangeEvent, session: Session | null) => void)(event, session);
      } else {
        (callback as (session: Session | null) => void)(session);
      }
    });
    unsubscribe = () => data.subscription.unsubscribe();
  }).catch(() => undefined);
  const stop = (() => {
    active = false;
    unsubscribe?.();
  }) as AuthUnsubscribe;
  stop.data = { subscription: { unsubscribe: stop } };
  return stop;
}

export const auth = {
  async signUp(email: string, password: string) {
    const client = await getAuthClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    return { ...data, data, error: null };
  },
  async signIn(email: string, password: string) {
    const client = await getAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { ...data, data, error: null };
  },
  async signOut() {
    const client = await getAuthClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  },
  async getSession(): Promise<Session | null> {
    const client = await getAuthClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  },
  async getUser(): Promise<User | null> {
    const client = await getAuthClient();
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    return data.user;
  },
  onAuthStateChange,
};
`;

const GENERATED_DB_CLIENT_MARKER = "// @bigbag-managed-db-client";

export const GENERATED_DB_CLIENT_SOURCE = `${GENERATED_DB_CLIENT_MARKER}
import { getPlatformAuthAccessToken } from "@/lib/auth-bridge";

export type DbRecord = Record<string, unknown> & {
  _id: string;
  createdAt: string;
  updatedAt: string;
};

export interface ListOptions {
  limit?: number;
  offset?: number;
}

function collectionPath(name: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)) {
    throw new Error("Collection names must start with a letter and contain only letters, numbers, _ or -");
  }
  const preview = window.location.pathname.match(/^\\/api\\/preview\\/[^/]+/);
  if (!preview) throw new Error("The data client must run inside a BigBag preview");
  return preview[0] + "/__bigbag/data/" + encodeURIComponent(name);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const accessToken = await getPlatformAuthAccessToken().catch(() => null);
  const capability = (window as Window & { __BIGBAG_WRITE_CAPABILITY__?: string })
    .__BIGBAG_WRITE_CAPABILITY__;
  const guestCapability = (window as Window & { __BIGBAG_GUEST_CAPABILITY__?: string })
    .__BIGBAG_GUEST_CAPABILITY__;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(capability ? { "X-BigBag-Capability": capability } : {}),
      ...(guestCapability ? { "X-BigBag-Guest": guestCapability } : {}),
      ...(accessToken ? { "Authorization": "Bearer " + accessToken } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: string } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error || "Database request failed (" + response.status + ")");
  }
  return payload.data;
}

export function collection<T extends object = DbRecord>(name: string) {
  const url = collectionPath(name);
  return {
    async list(options: ListOptions = {}): Promise<{ records: T[]; total: number }> {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.offset !== undefined) query.set("offset", String(options.offset));
      return request(url + (query.size ? "?" + query.toString() : ""));
    },
    async get(id: string): Promise<T> {
      return request(url + "/" + encodeURIComponent(id));
    },
    async create(data: object): Promise<T> {
      return request(url, { method: "POST", body: JSON.stringify({ data }) });
    },
    async update(id: string, data: object): Promise<T> {
      return request(url + "/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify({ data }),
      });
    },
    async remove(id: string): Promise<{ deleted: boolean }> {
      return request(url + "/" + encodeURIComponent(id), { method: "DELETE" });
    },
  };
}

export const db = { collection, from: collection };
export default db;
`;

export const LEGACY_GENERATED_DB_CLIENT_SOURCE = `import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const localDbPath = path.join(dataDir, "app.db").replace(/\\\\/g, "/");
const url = process.env.TURSO_DATABASE_URL || \`file:\${localDbPath}\`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({
  url,
  authToken,
});

export default db;
`;

function workspaceLegacyDatabaseReferences(
  dir: string,
  dbClientPath: string
): { any: boolean; browser: boolean; browserUsesLegacyApi: boolean; importsLibsql: boolean } {
  const sourceRoot = path.join(dir, "src");
  if (!fs.existsSync(sourceRoot)) {
    return { any: false, browser: false, browserUsesLegacyApi: false, importsLibsql: false };
  }
  const pending = [sourceRoot];
  const sourceExtension = /\.[cm]?[jt]sx?$/i;

  try {
    const sources = new Map<string, { fullPath: string; relativePath: string; content: string }>();
    const moduleKey = (fullPath: string) => path
      .relative(sourceRoot, fullPath)
      .replace(/\\/g, "/")
      .replace(/\.[cm]?[jt]sx?$/i, "")
      .replace(/\/index$/, "");
    const resolveModuleKey = (
      source: { fullPath: string },
      specifier: string
    ): string | null => {
      if (specifier.startsWith("@/")) {
        return specifier.slice(2).replace(/\.[cm]?[jt]sx?$/i, "").replace(/\/index$/, "");
      }
      if (specifier.startsWith(".")) {
        return moduleKey(path.resolve(path.dirname(source.fullPath), specifier));
      }
      return null;
    };

    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(fullPath);
        } else if (entry.isFile() && sourceExtension.test(entry.name)) {
          sources.set(moduleKey(fullPath), {
            fullPath,
            relativePath: path.relative(sourceRoot, fullPath).replace(/\\/g, "/"),
            content: fs.readFileSync(fullPath, "utf-8"),
          });
        }
      }
    }

    const dbKey = moduleKey(dbClientPath);
    const directConsumers = new Set<string>();
    const reverseImports = new Map<string, Set<string>>();
    let importsLibsql = false;
    for (const [sourceKey, source] of sources) {
      if (source.fullPath === dbClientPath) continue;
      const importPattern = /(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']|(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
      for (const match of source.content.matchAll(importPattern)) {
        const specifier = match[1] || match[2];
        if (specifier === "@libsql/client") importsLibsql = true;
        const targetKey = resolveModuleKey(source, specifier);
        if (!targetKey) continue;
        if (!reverseImports.has(targetKey)) reverseImports.set(targetKey, new Set());
        reverseImports.get(targetKey)!.add(sourceKey);
        if (targetKey === dbKey) directConsumers.add(sourceKey);
      }
    }

    const isServerOnly = (sourceKey: string) => {
      const sourcePath = sources.get(sourceKey)?.relativePath || sourceKey;
      return sourcePath.startsWith("app/api/") ||
        sourcePath.startsWith("server/") ||
        sourcePath.includes("/server/") ||
        /\.server\.[cm]?[jt]sx?$/i.test(sourcePath);
    };
    const exclusivelyServerReachable = (sourceKey: string, visiting = new Set<string>()): boolean => {
      if (visiting.has(sourceKey)) return false;
      const importers = reverseImports.get(sourceKey);
      if (!importers?.size) return isServerOnly(sourceKey);
      const nextVisiting = new Set(visiting).add(sourceKey);
      return [...importers].every((importer) => exclusivelyServerReachable(importer, nextVisiting));
    };

    const browserConsumers = [...directConsumers]
      .filter((consumer) => !exclusivelyServerReachable(consumer));
    const browserReachable = new Set<string>();
    const collectImporters = (sourceKey: string) => {
      if (browserReachable.has(sourceKey)) return;
      browserReachable.add(sourceKey);
      reverseImports.get(sourceKey)?.forEach(collectImporters);
    };
    browserConsumers.forEach(collectImporters);
    const legacyMethods = new Set([
      "execute", "executeMultiple", "prepare", "transaction", "batch", "sync",
    ]);
    const parsedSources = new Map<string, ts.SourceFile>();
    const parsedSource = (sourceKey: string): ts.SourceFile | null => {
      const source = sources.get(sourceKey);
      if (!source) return null;
      const existing = parsedSources.get(sourceKey);
      if (existing) return existing;
      const parsed = ts.createSourceFile(
        source.relativePath,
        source.content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      parsedSources.set(sourceKey, parsed);
      return parsed;
    };
    const legacyExports = new Map<string, Set<string>>([
      [dbKey, new Set(["default", "db"])],
    ]);
    const clientBindingsFor = (sourceKey: string): Set<string> => {
      const source = sources.get(sourceKey);
      const sourceFile = parsedSource(sourceKey);
      const bindings = new Set<string>();
      if (!source || !sourceFile) return bindings;

      const collect = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const targetKey = resolveModuleKey(source, node.moduleSpecifier.text);
          const targetExports = targetKey ? legacyExports.get(targetKey) : undefined;
          const clause = node.importClause;
          if (targetExports && clause) {
            if (clause.name && targetExports.has("default")) bindings.add(clause.name.text);
            if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
              bindings.add(clause.namedBindings.name.text);
            } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
              clause.namedBindings.elements.forEach((element) => {
                const imported = element.propertyName?.text || element.name.text;
                if (targetExports.has(imported)) bindings.add(element.name.text);
              });
            }
          }
        }
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === "require" &&
          node.initializer.arguments.length === 1 &&
          ts.isStringLiteral(node.initializer.arguments[0])
        ) {
          const targetKey = resolveModuleKey(source, node.initializer.arguments[0].text);
          if (targetKey && legacyExports.has(targetKey)) bindings.add(node.name.text);
        }
        ts.forEachChild(node, collect);
      };
      collect(sourceFile);

      let changed = true;
      while (changed) {
        changed = false;
        const collectAliases = (node: ts.Node): void => {
          if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            ts.isIdentifier(node.initializer) &&
            bindings.has(node.initializer.text) &&
            !bindings.has(node.name.text)
          ) {
            bindings.add(node.name.text);
            changed = true;
          }
          ts.forEachChild(node, collectAliases);
        };
        collectAliases(sourceFile);
      }
      return bindings;
    };

    for (let pass = 0; pass <= sources.size; pass += 1) {
      let changed = false;
      for (const [sourceKey, source] of sources) {
        if (sourceKey === dbKey) continue;
        const sourceFile = parsedSource(sourceKey);
        if (!sourceFile) continue;
        const bindings = clientBindingsFor(sourceKey);
        const exported = legacyExports.get(sourceKey) || new Set<string>();
        const addExport = (name: string) => {
          if (!exported.has(name)) {
            exported.add(name);
            changed = true;
          }
        };
        const collectExports = (node: ts.Node): void => {
          if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
            const targetKey = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
              ? resolveModuleKey(source, node.moduleSpecifier.text)
              : null;
            const targetExports = targetKey ? legacyExports.get(targetKey) : undefined;
            node.exportClause.elements.forEach((element) => {
              const imported = element.propertyName?.text || element.name.text;
              if (targetExports?.has(imported) || (!targetKey && bindings.has(imported))) {
                addExport(element.name.text);
              }
            });
          }
          if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression) && bindings.has(node.expression.text)) {
            addExport("default");
          }
          if (
            ts.isVariableStatement(node) &&
            node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            node.declarationList.declarations.forEach((declaration) => {
              if (ts.isIdentifier(declaration.name) && bindings.has(declaration.name.text)) {
                addExport(declaration.name.text);
              }
            });
          }
          ts.forEachChild(node, collectExports);
        };
        collectExports(sourceFile);
        if (exported.size > 0) legacyExports.set(sourceKey, exported);
      }
      if (!changed) break;
    }

    const browserSourceUsesLegacyApi = (sourceKey: string): boolean => {
      const source = sources.get(sourceKey);
      if (!source) return false;
      const sourceFile = parsedSource(sourceKey);
      if (!sourceFile) return false;
      const clientBindings = clientBindingsFor(sourceKey);
      const methodBindings = new Set<string>();

      let changed = true;
      while (changed) {
        changed = false;
        const collectAliases = (node: ts.Node): void => {
          if (ts.isVariableDeclaration(node) && node.initializer) {
            if (
              ts.isIdentifier(node.name) &&
              ts.isIdentifier(node.initializer) &&
              clientBindings.has(node.initializer.text) &&
              !clientBindings.has(node.name.text)
            ) {
              clientBindings.add(node.name.text);
              changed = true;
            }
            if (
              ts.isIdentifier(node.name) &&
              ts.isPropertyAccessExpression(node.initializer) &&
              ts.isIdentifier(node.initializer.expression) &&
              clientBindings.has(node.initializer.expression.text) &&
              legacyMethods.has(node.initializer.name.text) &&
              !methodBindings.has(node.name.text)
            ) {
              methodBindings.add(node.name.text);
              changed = true;
            }
            if (
              ts.isObjectBindingPattern(node.name) &&
              ts.isIdentifier(node.initializer) &&
              clientBindings.has(node.initializer.text)
            ) {
              node.name.elements.forEach((element) => {
                const imported = element.propertyName && ts.isIdentifier(element.propertyName)
                  ? element.propertyName.text
                  : element.name.getText(sourceFile);
                if (legacyMethods.has(imported) && ts.isIdentifier(element.name)) {
                  if (!methodBindings.has(element.name.text)) changed = true;
                  methodBindings.add(element.name.text);
                }
              });
            }
          }
          ts.forEachChild(node, collectAliases);
        };
        collectAliases(sourceFile);
      }

      let found = false;
      const rootBinding = (expression: ts.Expression): string | null => {
        if (ts.isIdentifier(expression)) return expression.text;
        if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
          return rootBinding(expression.expression);
        }
        return null;
      };
      const findCalls = (node: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression) && methodBindings.has(node.expression.text)) {
            found = true;
            return;
          }
          const expression = node.expression;
          const method = ts.isPropertyAccessExpression(expression)
            ? expression.name.text
            : ts.isElementAccessExpression(expression) &&
                expression.argumentExpression &&
                ts.isStringLiteral(expression.argumentExpression)
              ? expression.argumentExpression.text
              : null;
          const receiver = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
            ? rootBinding(expression.expression)
            : null;
          if (method && receiver && legacyMethods.has(method) && clientBindings.has(receiver)) {
            found = true;
            return;
          }
        }
        ts.forEachChild(node, findCalls);
      };
      findCalls(sourceFile);
      return found;
    };

    return {
      any: directConsumers.size > 0,
      browser: browserConsumers.length > 0,
      browserUsesLegacyApi: [...browserReachable]
        .some(browserSourceUsesLegacyApi),
      importsLibsql,
    };
  } catch {
    // A Node-only client must not leak into a browser bundle when the scan is
    // incomplete. Prefer the browser-safe migration in this uncertain case.
    return { any: true, browser: true, browserUsesLegacyApi: true, importsLibsql: true };
  }
}

function write(dir: string, relative: string, content: string) {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

function writeIfMissing(dir: string, relative: string, content: string): void {
  const full = path.join(dir, relative);
  if (!fs.existsSync(full)) write(dir, relative, content);
}

const RUNTIME_ENTRY_MARKER = "@bigbag-runtime-entry";

function isManagedRuntimeEntry(content: string): boolean {
  if (content.includes(RUNTIME_ENTRY_MARKER)) return true;

  const appImport = content.match(/^import App from "([^"]+)";$/m)?.[1];
  const cssImport = content.match(/^import "([^"]+\.css)";$/m)?.[1];
  const rawTitle = content.match(/^document\.title = (.+);$/m)?.[1];
  const rawDescription = content.match(/^descriptionMeta\.content = (.+);$/m)?.[1];
  if (!appImport || !cssImport || !rawTitle || !rawDescription) return false;

  try {
    const metadata = {
      title: JSON.parse(rawTitle) as string,
      description: JSON.parse(rawDescription) as string,
    };
    return (
      content === runtimeMainSource(appImport, cssImport, metadata).replace(`// ${RUNTIME_ENTRY_MARKER}\n`, "") ||
      content === legacyRuntimeMainSource(appImport, cssImport, metadata)
    );
  } catch {
    return false;
  }
}

export function legacyStarterPageSource(projectId: string): string {
  return `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-md p-8 bg-slate-900/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-800">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-white mb-2">
          ${projectId}
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          AI is assembling your application. Preview will update live as files are generated.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
          Ready for Prompt
        </div>
      </div>
    </main>
  );
}
`;
}

export function legacyStarterLayoutSource(projectId: string): string {
  return `import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: '${projectId}',
  description: 'Built with AI App Builder',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
}

function isLegacyStarterPage(content: string): boolean {
  const embeddedId = content.match(/<h1 className="text-xl font-semibold tracking-tight text-white mb-2">\s*([^\r\n<]+)\s*<\/h1>/)?.[1]?.trim();
  return Boolean(embeddedId && content === legacyStarterPageSource(embeddedId));
}

function isLegacyStarterLayout(content: string): boolean {
  const embeddedId = content.match(/\btitle:\s*'([^'\r\n]+)'/)?.[1];
  return Boolean(embeddedId && content === legacyStarterLayoutSource(embeddedId));
}

function removeLegacyStarterFiles(dir: string): void {
  for (const relativePath of ["src/app/page.tsx", "src/app/page.jsx"]) {
    const fullPath = path.join(/* turbopackIgnore: true */ dir, relativePath);
    if (!fs.existsSync(/* turbopackIgnore: true */ fullPath)) continue;
    const content = fs.readFileSync(/* turbopackIgnore: true */ fullPath, "utf-8");
    if (isLegacyStarterPage(content) || content.includes("@bigbag-managed-starter")) {
      fs.unlinkSync(/* turbopackIgnore: true */ fullPath);
    }
  }

  const layoutPath = path.join(/* turbopackIgnore: true */ dir, "src/app/layout.tsx");
  if (fs.existsSync(/* turbopackIgnore: true */ layoutPath)) {
    const content = fs.readFileSync(/* turbopackIgnore: true */ layoutPath, "utf-8");
    if (isLegacyStarterLayout(content) || content.includes("@bigbag-managed-starter")) {
      fs.unlinkSync(/* turbopackIgnore: true */ layoutPath);
    }
  }
}

function generatedAppImport(dir: string): string | null {
  const candidates = [
    "src/App.tsx",
    "src/App.jsx",
    "src/App.js",
    "src/app.tsx",
    "src/app.jsx",
    "src/app.js",
    "src/app/page.tsx",
    "src/app/page.jsx",
    "src/app/page.js",
    "src/pages/index.tsx",
    "src/pages/index.jsx",
    "src/pages/index.js",
    "app/page.tsx",
    "app/page.jsx",
    "app/page.js",
    "pages/index.tsx",
    "pages/index.jsx",
    "pages/index.js",
  ];
  for (const candidate of candidates) {
    const parent = path.join(/* turbopackIgnore: true */ dir, path.dirname(candidate));
    const requestedName = path.basename(candidate);
    try {
      const files = fs.readdirSync(/* turbopackIgnore: true */ parent, { withFileTypes: true })
        .filter((item) => item.isFile());
      const entry = files.find((item) => item.name === requestedName) ||
        files.find((item) => item.name.toLocaleLowerCase() === requestedName.toLocaleLowerCase());
      if (!entry) continue;
      const relativePath = path.posix.join(path.dirname(candidate), entry.name)
        .replace(/\.[cm]?[jt]sx?$/i, "");
      const fromRuntimeEntry = path.posix.relative("src", relativePath);
      return fromRuntimeEntry.startsWith(".") ? fromRuntimeEntry : `./${fromRuntimeEntry}`;
    } catch {
      // Try the next conventional generated entrypoint.
    }
  }
  return null;
}

function runtimeMainSource(
  appImport: string | null,
  cssImport: string,
  metadata: { title: string; description: string }
): string {
  const appDefinition = appImport
    ? `import App from ${JSON.stringify(appImport)};`
    : `function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-center text-white">
      <p className="text-sm text-slate-400">Waiting for the first generated application...</p>
    </main>
  );
}`;

  return `// ${RUNTIME_ENTRY_MARKER}
import { createRoot } from "react-dom/client";
${appDefinition}
import ${JSON.stringify(cssImport)};

document.title = ${JSON.stringify(metadata.title)};
let descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
if (!descriptionMeta) {
  descriptionMeta = document.createElement("meta");
  descriptionMeta.name = "description";
  document.head.appendChild(descriptionMeta);
}
descriptionMeta.content = ${JSON.stringify(metadata.description)};

const fallbackImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1000' viewBox='0 0 1600 1000'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%23dedbd4'/%3E%3Cstop offset='1' stop-color='%238b877f'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1600' height='1000' fill='url(%23g)'/%3E%3Cpath d='M0 760L430 390l230 205 220-175 720 580H0Z' fill='%23181715' opacity='.28'/%3E%3C/svg%3E";

document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.dataset.fallbackApplied !== "true") {
    image.dataset.fallbackApplied = "true";
    image.src = fallbackImage;
  }
}, true);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('Missing <div id="root"></div> in index.html');

createRoot(rootElement).render(<App />);
`;
}

function legacyRuntimeMainSource(
  appImport: string,
  cssImport: string,
  metadata: { title: string; description: string }
): string {
  return runtimeMainSource(appImport, cssImport, metadata)
    .replace(`// ${RUNTIME_ENTRY_MARKER}\n`, "")
    .replace(
      'import { createRoot } from "react-dom/client";',
      'import React from "react";\nimport { createRoot } from "react-dom/client";',
    )
    .replace(
      `const rootElement = document.getElementById("root");\nif (!rootElement) throw new Error('Missing <div id="root"></div> in index.html');\n\n`,
      "",
    )
    .replace(
      "createRoot(rootElement).render(<App />);",
      `createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`,
    );
}

function ensureRuntimeIndexHtml(dir: string, content: string): string {
  let updated = content;
  // Keep comments intact, but do not let disabled markup satisfy the runtime
  // contract. Replacing non-newline comment characters with spaces preserves
  // source offsets, so invalid active script tags can still be removed from
  // the original document below.
  const activeHtml = content.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\r\n]/g, " ")
  );
  const hasRoot = /<[a-z][\w:-]*\b[^>]*\bid\s*=\s*["']root["'][^>]*>/i.test(activeHtml);
  let hasMainScript = false;
  for (const match of activeHtml.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    const element = match[0];
    const tag = element.match(/^<script\b[^>]*>/i)?.[0] || "";
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const source = tag.match(
      /\bsrc\s*=\s*["'](?:(?:\/|\.\/)?)(src\/[a-zA-Z0-9_.@/-]+\.(?:js|jsx|ts|tsx))(?:[?#][^"']*)?["']/i,
    )?.[1];
    if (!source) continue;
    const relativePath = path.posix.normalize(source.replace(/^(?:\/|\.\/)/, ""));
    const workspaceRoot = path.resolve(/* turbopackIgnore: true */ dir);
    const fullPath = path.resolve(/* turbopackIgnore: true */ workspaceRoot, relativePath);
    const isInsideWorkspace =
      relativePath.startsWith("src/") &&
      fullPath.startsWith(`${workspaceRoot}${path.sep}`);
    if (
      isInsideWorkspace &&
      (relativePath === "src/main.tsx" || fs.existsSync(/* turbopackIgnore: true */ fullPath))
    ) {
      hasMainScript = true;
    } else {
      const start = match.index ?? -1;
      if (start >= 0) {
        // Preserve offsets while removing only the active invalid element. A
        // matching string inside a preceding comment must remain untouched.
        updated = `${updated.slice(0, start)}${" ".repeat(element.length)}${updated.slice(start + element.length)}`;
      }
    }
  }
  if (hasRoot && hasMainScript) return updated;
  const insertionPoint = /<\/body\s*>/i.exec(activeHtml) || /<\/html\s*>/i.exec(activeHtml);
  const insertionIndex = insertionPoint?.index ?? updated.length;

  const requiredNodes = [
    !hasRoot ? '    <div id="root"></div>' : null,
    !hasMainScript ? '    <script type="module" src="/src/main.tsx"></script>' : null,
  ].filter((line): line is string => Boolean(line));
  const closingIndent = insertionPoint ? "  " : "";
  return `${updated.slice(0, insertionIndex)}\n${requiredNodes.join("\n")}\n${closingIndent}${updated.slice(insertionIndex)}`;
}

function readLayoutMetadata(
  dir: string,
  projectId: string
): { title: string; description: string } {
  const defaults = {
    title: projectId,
    description: "Built with AI App Builder",
  };
  try {
    const layout = fs.readFileSync(path.join(dir, "src/app/layout.tsx"), "utf-8");
    return {
      title: layout.match(/\btitle\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] || defaults.title,
      description:
        layout.match(/\bdescription\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ||
        defaults.description,
    };
  } catch {
    return defaults;
  }
}

/**
 * Keep older generated Next workspaces previewable without rewriting the user's
 * page. Vite mounts the existing `src/app/page.tsx` directly and uses a fraction
 * of the memory required by `next dev` in the small E2B VM.
 */
function ensureGeneratedAuthClient(dir: string): void {
  const authClientPath = path.join(dir, "src/lib/auth.ts");
  const current = fs.existsSync(authClientPath)
    ? fs.readFileSync(authClientPath, "utf8")
    : null;
  if (current === null || current.includes(GENERATED_AUTH_CLIENT_MARKER)) {
    write(dir, "src/lib/auth.ts", GENERATED_AUTH_CLIENT_SOURCE);
  }
}

function ensureViteRuntime(dir: string, projectId: string): void {
  const pkgPath = path.join(dir, "package.json");
  const dbClientPath = path.join(dir, "src/lib/db.ts");
  const currentDbClient = fs.existsSync(dbClientPath)
    ? fs.readFileSync(dbClientPath, "utf-8")
    : null;
  const migrateManagedGeneratedDbClient = Boolean(
    currentDbClient?.includes(GENERATED_DB_CLIENT_MARKER) &&
    currentDbClient !== GENERATED_DB_CLIENT_SOURCE
  );
  const legacyReferences = workspaceLegacyDatabaseReferences(dir, dbClientPath);
  if (
    currentDbClient === LEGACY_GENERATED_DB_CLIENT_SOURCE &&
    legacyReferences.browserUsesLegacyApi
  ) {
    throw new Error(
      "This restored app uses legacy server-only database methods in browser code. Migrate those calls to db.collection() before rebuilding."
    );
  }
  const preserveLegacyDbClient =
    currentDbClient === LEGACY_GENERATED_DB_CLIENT_SOURCE &&
    legacyReferences.any &&
    !legacyReferences.browser;
  const migrateLegacyDbClient =
    currentDbClient === LEGACY_GENERATED_DB_CLIENT_SOURCE &&
    !preserveLegacyDbClient;
  const keepLibsqlDependency =
    legacyReferences.importsLibsql ||
    (Boolean(currentDbClient?.includes("@libsql/client")) && !migrateLegacyDbClient);
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    // A malformed package file is repaired below while preserving source files.
  }

  const scripts = (pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, string>;
  const dependencies = (pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {}) as Record<string, string>;
  const devDependencies = (pkg.devDependencies && typeof pkg.devDependencies === "object" ? pkg.devDependencies : {}) as Record<string, string>;
  const { "@libsql/client": legacyDbDependency, ...browserDependencies } = dependencies;

  pkg = {
    ...pkg,
    name: typeof pkg.name === "string" ? pkg.name : projectId,
    version: typeof pkg.version === "string" ? pkg.version : "0.1.0",
    private: true,
    scripts: {
      ...scripts,
      dev: "vite --host 0.0.0.0",
      build: "vite build",
      preview: "vite preview --host 0.0.0.0",
    },
    dependencies: {
      ...PREINSTALLED_DEPENDENCIES,
      ...browserDependencies,
      ...(keepLibsqlDependency
        ? { "@libsql/client": legacyDbDependency || "^0.18.0" }
        : {}),
    },
    devDependencies: {
      ...PREINSTALLED_DEV_DEPENDENCIES,
      ...devDependencies,
      // These two own the generated build boundary. Keep older restored
      // projects off vulnerable Vite/esbuild releases as they are recreated.
      vite: PREINSTALLED_DEV_DEPENDENCIES.vite,
      "@vitejs/plugin-react": PREINSTALLED_DEV_DEPENDENCIES["@vitejs/plugin-react"],
    },
  };
  write(dir, "package.json", JSON.stringify(pkg, null, 2));

  const postcssConfig = `import tailwindcss from "@tailwindcss/postcss";

export default {
  plugins: [tailwindcss()],
};
`;
  const postcssPath = path.join(dir, "postcss.config.mjs");
  if (!fs.existsSync(postcssPath)) {
    write(dir, "postcss.config.mjs", postcssConfig);
  } else {
    const currentPostcss = fs.readFileSync(postcssPath, "utf-8");
    // Tailwind 4 rejects the legacy direct `tailwindcss` PostCSS plugin. Repair
    // only that known-incompatible migration case; preserve every other custom
    // or generated configuration.
    if (
      /(?:from\s+["']tailwindcss["']|\btailwindcss\s*:)/.test(currentPostcss) &&
      !currentPostcss.includes("@tailwindcss/postcss")
    ) {
      write(dir, "postcss.config.mjs", postcssConfig);
    }
  }

  const globalsCssPath = path.join(/* turbopackIgnore: true */ dir, "src/app/globals.css");
  const hadGlobalsCss = fs.existsSync(/* turbopackIgnore: true */ globalsCssPath);
  const indexCssPath = path.join(/* turbopackIgnore: true */ dir, "src/index.css");
  const useIndexCss = !hadGlobalsCss && fs.existsSync(/* turbopackIgnore: true */ indexCssPath);
  if (!useIndexCss) writeIfMissing(dir, "src/app/globals.css", `@import "tailwindcss";\n`);

  if (!fs.existsSync(dbClientPath)) {
    write(dir, "src/lib/db.ts", GENERATED_DB_CLIENT_SOURCE);
  } else if (
    migrateLegacyDbClient ||
    migrateManagedGeneratedDbClient
  ) {
    write(dir, "src/lib/db.ts", GENERATED_DB_CLIENT_SOURCE);
  }
  write(dir, "src/lib/auth-bridge.ts", GENERATED_AUTH_BRIDGE_SOURCE);
  ensureGeneratedAuthClient(dir);

  const runtimeIndex = `<!doctype html>
<html lang="en">
  <head>
    <!-- ${RUNTIME_ENTRY_MARKER} -->
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#09090b" />
    <title>${projectId}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
  const indexPath = path.join(/* turbopackIgnore: true */ dir, "index.html");
  if (!fs.existsSync(/* turbopackIgnore: true */ indexPath)) {
    write(dir, "index.html", runtimeIndex);
  } else {
    const currentIndex = fs.readFileSync(/* turbopackIgnore: true */ indexPath, "utf-8");
    const updatedIndex = currentIndex.includes(RUNTIME_ENTRY_MARKER)
      ? runtimeIndex
      : ensureRuntimeIndexHtml(dir, currentIndex);
    if (updatedIndex !== currentIndex) write(dir, "index.html", updatedIndex);
  }

  writeIfMissing(
    dir,
    "vite.config.ts",
    `import { existsSync as __bigbagLucideExistsSync } from "node:fs";
import __bigbagLucidePath from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configDir = path.dirname(fileURLToPath(import.meta.url));

${VITE_LUCIDE_PLUGIN_SOURCE}

export default defineConfig({
  plugins: [directLucideImports(), react()],
  build: { minify: false },
  server: { allowedHosts: [".e2b.app"], hmr: false },
  resolve: {
    alias: { "@": path.resolve(configDir, "./src") },
  },
});
`
  );

  const viteConfigPath = path.join(dir, "vite.config.ts");
  const currentViteConfig = fs.readFileSync(viteConfigPath, "utf-8");
  let updatedViteConfig = currentViteConfig;
  const legacyAlias = /alias:\s*\{\s*["']@["']:\s*path\.resolve\(\s*__dirname\s*,\s*["']\.\/src["']\s*\)\s*\}/;
  if (legacyAlias.test(updatedViteConfig)) {
    let migrationCandidate = updatedViteConfig;
    const nodeUrlImport = /import\s*{\s*([^}]*)}\s*from\s*(["'])node:url\2\s*;/;
    const nodeUrlMatch = migrationCandidate.match(nodeUrlImport);
    const hasFileUrlBinding = nodeUrlMatch?.[1]
      .split(",")
      .some((binding) => binding.trim() === "fileURLToPath") || false;
    if (!hasFileUrlBinding) {
      if (nodeUrlMatch) {
        migrationCandidate = migrationCandidate.replace(
          nodeUrlImport,
          (_full, bindings: string, quote: string) =>
            `import { ${bindings.trim()}${bindings.trim() ? ", " : ""}fileURLToPath } from ${quote}node:url${quote};`
        );
      } else {
        migrationCandidate = migrationCandidate.replace(
          /import\s+path\s+from\s+["']node:path["']\s*;/,
          (pathImport) => `${pathImport}\nimport { fileURLToPath } from "node:url";`
        );
      }
    }
    if (!migrationCandidate.includes("fileURLToPath(import.meta.url)")) {
      migrationCandidate = migrationCandidate.replace(
        /import\s+\w+\s+from\s+["']@vitejs\/plugin-react["']\s*;/,
        (reactImport) => `${reactImport}\n\nconst configDir = path.dirname(fileURLToPath(import.meta.url));`
      );
    }
    const completeImport = /import\s*{[^}]*\bfileURLToPath\b[^}]*}\s*from\s*["']node:url["']\s*;/
      .test(migrationCandidate);
    const completeDeclaration = /const\s+configDir\s*=\s*path\.dirname\(fileURLToPath\(import\.meta\.url\)\)\s*;/
      .test(migrationCandidate);
    if (completeImport && completeDeclaration) {
      updatedViteConfig = migrationCandidate.replace(
        legacyAlias,
        'alias: { "@": path.resolve(configDir, "./src") }'
      );
    }
  }
  updatedViteConfig = updatedViteConfig.replace(
    /^\s*["']lucide-react["']:\s*path\.resolve\([^\n]+lucide-react\.js["']\),?\s*$/m,
    ""
  );
  let hasLucidePluginDefinition = /function\s+directLucideImports\s*\(\s*\)/.test(updatedViteConfig);
  if (!hasLucidePluginDefinition) {
    updatedViteConfig = updatedViteConfig.replace(
      /export default defineConfig/,
      `${VITE_LUCIDE_PLUGIN_SOURCE}\n\nexport default defineConfig`
    );
    hasLucidePluginDefinition = /function\s+directLucideImports\s*\(\s*\)/.test(updatedViteConfig);
  }
  if (hasLucidePluginDefinition) {
    if (!/import\s*\{[^}]*\bexistsSync\s+as\s+__bigbagLucideExistsSync\b[^}]*}\s*from\s*["']node:fs["']/.test(updatedViteConfig)) {
      updatedViteConfig = `import { existsSync as __bigbagLucideExistsSync } from "node:fs";\n${updatedViteConfig}`;
    }
    if (!/import\s+__bigbagLucidePath\s+from\s*["']node:path["']/.test(updatedViteConfig)) {
      updatedViteConfig = `import __bigbagLucidePath from "node:path";\n${updatedViteConfig}`;
    }
  }
  if (hasLucidePluginDefinition && !/plugins:\s*\[[^\]]*\bdirectLucideImports\(\)/.test(updatedViteConfig)) {
    updatedViteConfig = updatedViteConfig.replace(
      /plugins:\s*\[react\(\)\]/,
      "plugins: [directLucideImports(), react()]"
    );
  }
  const templateServerConfig = 'server: { allowedHosts: [".e2b.app"] },';
  if (updatedViteConfig.includes(templateServerConfig)) {
    updatedViteConfig = updatedViteConfig.replace(
      templateServerConfig,
      'server: { allowedHosts: [".e2b.app"], hmr: false },'
    );
  }
  if (!/\bbuild\s*:/.test(updatedViteConfig)) {
    updatedViteConfig = updatedViteConfig.replace(
      /(plugins:\s*\[(?:directLucideImports\(\),\s*)?react\(\)\],)/,
      '$1\n  build: { minify: false },'
    );
  }
  if (updatedViteConfig !== currentViteConfig) {
    write(dir, "vite.config.ts", updatedViteConfig);
  }

  removeLegacyStarterFiles(dir);
  const metadata = readLayoutMetadata(dir, projectId);
  const appImport = generatedAppImport(dir);
  const cssImport = useIndexCss ? "./index.css" : "./app/globals.css";

  const mainPath = path.join(/* turbopackIgnore: true */ dir, "src/main.tsx");
  if (
    !fs.existsSync(/* turbopackIgnore: true */ mainPath) ||
    isManagedRuntimeEntry(fs.readFileSync(/* turbopackIgnore: true */ mainPath, "utf-8"))
  ) {
    write(dir, "src/main.tsx", runtimeMainSource(appImport, cssImport, metadata));
  }
}

/** Seed a Lovable-style Vite + React + Tailwind app. Idempotent. */
export function writeStarterTemplate(dir: string, projectId: string): void {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    ensureViteRuntime(dir, projectId);
    return;
  }

  write(
    dir,
    "package.json",
    JSON.stringify(
      {
        name: projectId,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          dev: "vite --host 0.0.0.0",
          build: "vite build",
          preview: "vite preview --host 0.0.0.0",
        },
        dependencies: PREINSTALLED_DEPENDENCIES,
        devDependencies: PREINSTALLED_DEV_DEPENDENCIES,
      },
      null,
      2
    )
  );

  write(
    dir,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "react-jsx",
          paths: { "@/*": ["./src/*"] },
        },
        include: ["src", "vite.config.ts"],
        exclude: ["node_modules"],
      },
      null,
      2
    )
  );

  write(
    dir,
    "src/app/globals.css",
    `@import "tailwindcss";

/* ═══════════════════════════════════════════════════════════════════
   BIGBAG SEMANTIC TOKEN SYSTEM — HSL
   Full surface hierarchy + semantic roles for generated apps.
   The AI resolves custom palette choices into these variables.
   ═══════════════════════════════════════════════════════════════════ */

:root {
  /* Radius scale */
  --radius: 0.75rem;

  /* ── 3-tier surface depth ───────────────────────────────────────── */
  /* Base canvas: soft off-white, never stark #fff */
  --background: hsl(210 40% 98%);
  --foreground: hsl(222 47% 11%);

  /* Elevated surface: white cards on the canvas */
  --card: hsl(0 0% 100%);
  --card-foreground: hsl(222 47% 11%);

  /* Floating overlay: dropdowns, popovers, dialogs */
  --popover: hsl(0 0% 100%);
  --popover-foreground: hsl(222 47% 11%);

  /* ── Semantic roles ─────────────────────────────────────────────── */
  --primary: hsl(239 84% 67%);
  --primary-foreground: hsl(0 0% 100%);

  --secondary: hsl(214 32% 94%);
  --secondary-foreground: hsl(222 47% 20%);

  --muted: hsl(214 32% 94%);
  --muted-foreground: hsl(215 16% 47%);

  --accent: hsl(239 84% 95%);
  --accent-foreground: hsl(239 84% 30%);

  --destructive: hsl(0 72% 51%);
  --destructive-foreground: hsl(0 0% 100%);

  /* ── Structure ──────────────────────────────────────────────────── */
  /* Muted border: never harsh 1px solid black wireframe */
  --border: hsl(214 32% 91%);
  --input: hsl(214 32% 91%);
  --ring: hsl(239 84% 67%);
}

.dark {
  /* Base canvas: deep tinted slate, never pure #000000 */
  --background: hsl(224 71% 4%);
  --foreground: hsl(213 31% 91%);

  /* Elevated surface in dark mode */
  --card: hsl(224 45% 8%);
  --card-foreground: hsl(213 31% 91%);

  /* Floating overlay in dark mode */
  --popover: hsl(224 45% 10%);
  --popover-foreground: hsl(213 31% 91%);

  --primary: hsl(239 84% 67%);
  --primary-foreground: hsl(0 0% 100%);

  --secondary: hsl(222 47% 14%);
  --secondary-foreground: hsl(213 31% 91%);

  --muted: hsl(223 47% 11%);
  --muted-foreground: hsl(215 16% 57%);

  --accent: hsl(239 84% 20%);
  --accent-foreground: hsl(239 84% 85%);

  --destructive: hsl(0 72% 61%);
  --destructive-foreground: hsl(0 0% 100%);

  --border: hsl(216 34% 17%);
  --input: hsl(216 34% 17%);
  --ring: hsl(239 84% 67%);
}

/* ── Tailwind 4 theme bridge ────────────────────────────────────── */
@theme inline {
  /* Radius */
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  /* Color tokens */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

/* ── Base styles ────────────────────────────────────────────────── */
@layer base {
  * {
    border-color: var(--border);
    box-sizing: border-box;
  }
  html {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    background: var(--background);
    color: var(--foreground);
    min-height: 100vh;
    font-family: 'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.6;
  }
}

/* ── Elevation & shadow utilities ───────────────────────────────── */
.shadow-subtle {
  box-shadow:
    0 1px 2px 0 rgba(0, 0, 0, 0.04),
    0 1px 3px 0 rgba(0, 0, 0, 0.06);
}

.shadow-card {
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.06),
    0 4px 8px -2px rgba(0, 0, 0, 0.06),
    0 0 0 1px rgba(0, 0, 0, 0.04);
}

.shadow-float {
  box-shadow:
    0 4px 6px -2px rgba(0, 0, 0, 0.05),
    0 12px 24px -4px rgba(0, 0, 0, 0.10),
    0 0 0 1px rgba(0, 0, 0, 0.04);
}

.dark .shadow-subtle {
  box-shadow:
    0 1px 2px 0 rgba(0, 0, 0, 0.30),
    0 1px 3px 0 rgba(0, 0, 0, 0.40);
}

.dark .shadow-card {
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.35),
    0 4px 8px -2px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.05);
}

.dark .shadow-float {
  box-shadow:
    0 4px 6px -2px rgba(0, 0, 0, 0.45),
    0 12px 24px -4px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.07);
}
`
  );

  write(
    dir,
    "src/lib/utils.ts",
    `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`
  );

  write(
    dir,
    "src/lib/db.ts",
    GENERATED_DB_CLIENT_SOURCE
  );

  write(
    dir,
    "src/lib/auth-bridge.ts",
    GENERATED_AUTH_BRIDGE_SOURCE
  );

  ensureGeneratedAuthClient(dir);

  write(
    dir,
    "src/components/ui/button.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  size?: "xs" | "sm" | "default" | "lg" | "icon";
  isLoading?: boolean;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  isLoading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] whitespace-nowrap select-none",
        variant === "default" && "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 shadow-subtle",
        variant === "secondary" && "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--muted)]",
        variant === "outline" && "border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]",
        variant === "ghost" && "bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]",
        variant === "destructive" && "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
        variant === "link" && "bg-transparent text-[var(--primary)] underline-offset-4 hover:underline p-0 h-auto",
        size === "xs" && "h-7 px-2.5 text-xs",
        size === "sm" && "h-8 px-3 text-sm",
        size === "default" && "h-9 px-4 text-sm",
        size === "lg" && "h-11 px-8 text-base",
        size === "icon" && "h-9 w-9 p-0",
        className
      )}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {children}
        </>
      ) : children}
    </button>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/card.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "ghost";
  interactive?: boolean;
}

export function Card({ className, variant = "default", interactive = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]",
        variant === "default" && "shadow-card",
        variant === "elevated" && "shadow-float border-[var(--border)]",
        variant === "ghost" && "border-transparent shadow-none bg-transparent",
        interactive && "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-[var(--muted-foreground)] leading-relaxed", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
`
  );


  write(
    dir,
    "src/components/ui/label.tsx",
    `import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm font-medium leading-none text-[var(--foreground)] peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  );
}
`
  );

  write(
    dir,
    "src/components/ui/input.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1 text-sm text-[var(--foreground)] shadow-subtle transition-colors placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-[var(--destructive)] focus-visible:ring-[var(--destructive)]",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
`
  );

  write(
    dir,
    "src/components/ui/textarea.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] shadow-subtle placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none",
          error && "border-[var(--destructive)] focus-visible:ring-[var(--destructive)]",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
`
  );

  write(
    dir,
    "src/components/ui/checkbox.tsx",
    `import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded border border-[var(--border)] shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--primary)] data-[state=checked]:text-[var(--primary-foreground)] data-[state=checked]:border-[var(--primary)] transition-colors",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3 w-3" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
`
  );

  write(
    dir,
    "src/components/ui/switch.tsx",
    `import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--primary)] data-[state=unchecked]:bg-[var(--muted)]",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-card ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;
`
  );

  write(
    dir,
    "src/components/ui/separator.tsx",
    `import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/utils";

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-[var(--border)]",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;
`
  );

  write(
    dir,
    "src/components/ui/badge.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
  dot?: boolean;
}

export function Badge({ className, variant = "default", dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        variant === "default" && "bg-[var(--primary)] text-[var(--primary-foreground)]",
        variant === "secondary" && "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        variant === "success" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
        variant === "warning" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        variant === "destructive" && "bg-[var(--destructive)] text-[var(--destructive-foreground)]",
        variant === "outline" && "border border-[var(--border)] text-[var(--foreground)] bg-transparent",
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            variant === "success" && "bg-emerald-500",
            variant === "warning" && "bg-amber-500",
            variant === "destructive" && "bg-white",
            variant === "default" && "bg-white/70",
            variant === "secondary" && "bg-[var(--muted-foreground)]",
            variant === "outline" && "bg-[var(--muted-foreground)]",
          )}
        />
      )}
      {children}
    </span>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/skeleton.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-[var(--muted)] before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent",
        className
      )}
      {...props}
    />
  );
}

// Semantic skeleton shapes
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 && lines > 1 && "w-3/4")} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-[var(--border)] p-6 space-y-4", className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/alert.tsx",
    `import * as React from "react";
import { Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "info" | "success" | "warning" | "destructive";
  title?: string;
}

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
};

export function Alert({ className, variant = "info", title, children, ...props }: AlertProps) {
  const Icon = icons[variant];
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-lg border p-4 text-sm",
        variant === "info" && "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/30 dark:bg-blue-950/30 dark:text-blue-300",
        variant === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/30 dark:bg-emerald-950/30 dark:text-emerald-300",
        variant === "warning" && "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/30 dark:text-amber-300",
        variant === "destructive" && "border-red-200 bg-red-50 text-red-800 dark:border-red-800/30 dark:bg-red-950/30 dark:text-red-300",
        className
      )}
      {...props}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/empty-state.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-4", className)}>
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--muted)] text-[var(--muted-foreground)]">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-[var(--muted-foreground)] max-w-sm leading-relaxed mb-4">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/metric-card.tsx",
    `import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  className?: string;
  description?: string;
}

export function MetricCard({
  label,
  value,
  trend,
  trendLabel,
  icon,
  className,
  description,
}: MetricCardProps) {
  const isPositive = trend !== undefined && trend > 0;
  const isNegative = trend !== undefined && trend < 0;

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-card",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            {label}
          </p>
          <p className="text-2xl font-bold tracking-tight text-[var(--foreground)] truncate">
            {value}
          </p>
          {description && (
            <p className="text-xs text-[var(--muted-foreground)] mt-1">{description}</p>
          )}
        </div>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
            {icon}
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div className="mt-3 flex items-center gap-1.5">
          {isPositive && <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />}
          {isNegative && <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
          {!isPositive && !isNegative && <Minus className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
          <span
            className={cn(
              "text-xs font-medium",
              isPositive && "text-emerald-600 dark:text-emerald-400",
              isNegative && "text-red-600 dark:text-red-400",
              !isPositive && !isNegative && "text-[var(--muted-foreground)]"
            )}
          >
            {trend > 0 ? "+" : ""}{trend}%{trendLabel ? " " + trendLabel : ""}
          </span>
        </div>
      )}
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/table.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-[var(--border)]", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn("border-t border-[var(--border)] bg-[var(--muted)]/50 font-medium", className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50 data-[state=selected]:bg-[var(--muted)]",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("p-3 align-middle text-sm text-[var(--foreground)] [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("mt-4 text-sm text-[var(--muted-foreground)]", className)} {...props} />;
}
`
  );

  write(
    dir,
    "src/components/ui/dialog.tsx",
    `import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-float duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}
    >
      {children}
      <DialogClose className="absolute right-4 top-4 rounded-sm p-1 opacity-70 ring-offset-[var(--background)] transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogClose>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-left mb-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-[var(--foreground)]", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--muted-foreground)]", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
`
  );

  write(
    dir,
    "src/components/ui/sheet.tsx",
    `import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

type SheetSide = "top" | "right" | "bottom" | "left";

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: SheetSide }
>(({ className, children, side = "right", ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 bg-[var(--card)] border-[var(--border)] shadow-float transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
        side === "right" && "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
        side === "left" && "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        side === "top" && "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        side === "bottom" && "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        className
      )}
      {...props}
    >
      <div className="flex flex-col h-full p-6">
        {children}
      </div>
      <SheetClose className="absolute right-4 top-4 rounded-sm p-1 opacity-70 ring-offset-[var(--background)] transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetClose>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 mb-4", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-auto pt-4", className)} {...props} />;
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold tracking-tight text-[var(--foreground)]", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--muted-foreground)]", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
`
  );

  write(
    dir,
    "src/components/ui/dropdown-menu.tsx",
    `import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--popover-foreground)] shadow-float data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]", inset && "pl-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--border)]", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ml-auto text-xs tracking-widest text-[var(--muted-foreground)] opacity-60", className)} {...props} />;
}
`
  );

  write(
    dir,
    "src/components/ui/tabs.tsx",
    `import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-[var(--muted)] p-1 text-[var(--muted-foreground)]",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-[var(--background)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--foreground)] data-[state=active]:shadow-subtle",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-[var(--background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
`
  );

  write(
    dir,
    "src/components/ui/tooltip.tsx",
    `import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-[var(--foreground)] px-2.5 py-1 text-xs text-[var(--background)] shadow-float animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
`
  );

  write(
    dir,
    "src/components/ui/select.tsx",
    `import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between rounded-md border border-[var(--border)] bg-transparent px-3 py-1 text-sm text-[var(--foreground)] shadow-subtle ring-offset-[var(--background)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-float data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-[var(--accent)] focus:text-[var(--accent-foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--border)]", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
`
  );

  write(
    dir,
    "src/components/ui/breadcrumbs.tsx",
    `import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className={cn("flex items-center gap-1.5 text-sm", className)}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1.5">
              {isLast ? (
                <span className="font-medium text-[var(--foreground)]" aria-current="page">
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {item.label}
                </a>
              ) : (
                <button
                  onClick={item.onClick}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              )}
              {!isLast && <ChevronRight className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/pagination.tsx",
    `import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ currentPage, totalPages, onPageChange, className }: PaginationProps) {
  const getVisiblePages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [1];
    if (currentPage > 3) pages.push("...");
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
    return pages;
  };

  return (
    <nav aria-label="Pagination" className={cn("flex items-center gap-1", className)}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="Previous page"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {getVisiblePages().map((page, i) =>
        page === "..." ? (
          <span key={\`ellipsis-\${i}\`} className="inline-flex h-8 w-8 items-center justify-center text-sm text-[var(--muted-foreground)]">
            <MoreHorizontal className="h-4 w-4" />
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page as number)}
            aria-current={page === currentPage ? "page" : undefined}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors",
              page === currentPage
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--secondary)]"
            )}
          >
            {page}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="Next page"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/form.tsx",
    `import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  children: React.ReactNode;
  className?: string;
}

export function FormField({ children, className }: FormFieldProps) {
  return <div className={cn("space-y-1.5", className)}>{children}</div>;
}

export function FormLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm font-medium leading-none text-[var(--foreground)] peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-[var(--muted-foreground)]", className)} {...props} />;
}

export function FormMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) return null;
  return (
    <p className={cn("text-xs font-medium text-[var(--destructive)]", className)} role="alert" {...props}>
      {children}
    </p>
  );
}
`
  );

  write(
    dir,
    "src/components/ui/index.ts",
    `// UI Primitive Exports — BigBag Starter Component Suite
export * from "./button";
export * from "./card";
export * from "./label";
export * from "./input";
export * from "./textarea";
export * from "./checkbox";
export * from "./switch";
export * from "./separator";
export * from "./badge";
export * from "./skeleton";
export * from "./alert";
export * from "./empty-state";
export * from "./metric-card";
export * from "./table";
export * from "./dialog";
export * from "./sheet";
export * from "./dropdown-menu";
export * from "./tabs";
export * from "./tooltip";
export * from "./select";
export * from "./breadcrumbs";
export * from "./pagination";
export * from "./form";
`
  );

  // ── Layout Shells ──────────────────────────────────────────────────────────

  write(
    dir,
    "src/components/layout/dashboard-shell.tsx",
    `import * as React from "react";
import { Menu, X, Bell, Search, ChevronDown, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  badge?: string | number;
}

export interface DashboardShellProps {
  children: React.ReactNode;
  /** Top-level navigation items shown in the sidebar */
  navItems?: NavItem[];
  /** Brand logo or name */
  brand?: React.ReactNode;
  /** User display name */
  userName?: string;
  /** User avatar URL */
  userAvatar?: string;
  /** Topbar right-side actions */
  actions?: React.ReactNode;
  /** Page title shown in the topbar breadcrumb */
  pageTitle?: string;
  className?: string;
}

function NavLink({ item }: { item: NavItem }) {
  const Tag = item.href ? "a" : "button";
  return (
    <Tag
      href={item.href}
      onClick={item.onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-[44px]",
        item.active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
      )}
    >
      {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>}
      <span className="flex-1 truncate text-left">{item.label}</span>
      {item.badge !== undefined && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-[10px] font-semibold text-[var(--primary-foreground)]">
          {item.badge}
        </span>
      )}
    </Tag>
  );
}

export function DashboardShell({
  children,
  navItems = [],
  brand,
  userName = "User",
  actions,
  pageTitle,
  className,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      <div className="mb-4 flex items-center gap-2 px-2">
        {brand ?? (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary)]">
              <LayoutDashboard className="h-4 w-4 text-[var(--primary-foreground)]" />
            </div>
            <span className="text-sm font-semibold text-[var(--foreground)]">Dashboard</span>
          </div>
        )}
      </div>
      <div className="flex-1 space-y-0.5">
        {navItems.map((item, i) => (
          <NavLink key={i} item={item} />
        ))}
      </div>
      <div className="border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-[var(--accent-foreground)]">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="flex-1 truncate text-xs font-medium text-[var(--foreground)]">{userName}</span>
          <ChevronDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        </div>
      </div>
    </nav>
  );

  return (
    <div className={cn("flex min-h-screen bg-[var(--background)]", className)}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col border-r border-[var(--border)] bg-[var(--card)]">
        {sidebar}
      </aside>

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Sticky topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)]/80 px-4 backdrop-blur-sm sm:px-6">
          {/* Mobile menu trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>

          {pageTitle && (
            <h1 className="text-sm font-semibold text-[var(--foreground)] truncate">{pageTitle}</h1>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Search">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Button>
            {actions}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/layout/marketing-shell.tsx",
    `import * as React from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface MarketingNavItem {
  label: string;
  href: string;
}

export interface MarketingShellProps {
  children: React.ReactNode;
  /** Brand name or logo element */
  brand?: React.ReactNode;
  /** Navigation anchor links */
  navItems?: MarketingNavItem[];
  /** Primary CTA button label */
  ctaLabel?: string;
  /** Primary CTA click handler or href */
  ctaHref?: string;
  onCtaClick?: () => void;
  className?: string;
}

export function MarketingShell({
  children,
  brand,
  navItems = [],
  ctaLabel = "Get Started",
  ctaHref,
  onCtaClick,
  className,
}: MarketingShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className={cn("min-h-screen bg-[var(--background)]", className)}>
      {/* Sticky glass navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)]/60 bg-[var(--background)]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <div className="flex items-center">
            {brand ?? (
              <span className="text-lg font-bold tracking-tight text-[var(--foreground)]">Brand</span>
            )}
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" size="sm">Sign in</Button>
            <Button
              size="sm"
              onClick={onCtaClick}
              {...(ctaHref ? { as: "a", href: ctaHref } : {})}
            >
              {ctaLabel}
            </Button>
          </div>

          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-2">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center min-h-[44px] px-2 text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)] transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
                <div className="mt-4 flex flex-col gap-2">
                  <Button variant="outline" className="w-full">Sign in</Button>
                  <Button className="w-full" onClick={() => { onCtaClick?.(); setMobileOpen(false); }}>
                    {ctaLabel}
                  </Button>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Page content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--card)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-[var(--muted-foreground)]">
              © {new Date().getFullYear()} All rights reserved.
            </div>
            <div className="flex items-center gap-4">
              {navItems.slice(0, 4).map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Reusable hero section for marketing pages */
export interface HeroSectionProps {
  badge?: string;
  headline: string;
  subheadline?: string;
  primaryCta?: { label: string; onClick?: () => void; href?: string };
  secondaryCta?: { label: string; onClick?: () => void; href?: string };
  visual?: React.ReactNode;
  className?: string;
}

export function HeroSection({
  badge,
  headline,
  subheadline,
  primaryCta,
  secondaryCta,
  visual,
  className,
}: HeroSectionProps) {
  return (
    <section className={cn("py-16 sm:py-24 lg:py-32", className)}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {badge && (
          <div className="mb-6 flex justify-center">
            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-subtle">
              {badge}
            </span>
          </div>
        )}
        <h1 className="text-4xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
          {headline}
        </h1>
        {subheadline && (
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--muted-foreground)]">
            {subheadline}
          </p>
        )}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          {primaryCta && (
            <Button size="lg" onClick={primaryCta.onClick} className="w-full sm:w-auto min-w-[160px]">
              {primaryCta.label}
            </Button>
          )}
          {secondaryCta && (
            <Button variant="outline" size="lg" onClick={secondaryCta.onClick} className="w-full sm:w-auto min-w-[160px]">
              {secondaryCta.label}
            </Button>
          )}
        </div>
        {visual && (
          <div className="mt-16 relative">
            <div className="absolute inset-0 -z-10 mx-auto w-3/4 rounded-3xl bg-[var(--primary)] opacity-10 blur-3xl" />
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-float overflow-hidden">
              {visual}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Reusable feature grid section */
export interface FeatureItem {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function FeatureGrid({ features, className }: { features: FeatureItem[]; className?: string }) {
  return (
    <section className={cn("py-16 sm:py-24", className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div key={i} className="flex flex-col gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
                {f.icon}
              </div>
              <h3 className="text-base font-semibold text-[var(--foreground)]">{f.title}</h3>
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
`
  );

  write(
    dir,
    "src/components/layout/storefront-shell.tsx",
    `import * as React from "react";
import { ShoppingBag, Search, Menu, X, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface StorefrontShellProps {
  children: React.ReactNode;
  brand?: React.ReactNode;
  cartCount?: number;
  onCartOpen?: () => void;
  cartDrawer?: React.ReactNode;
  filterPanel?: React.ReactNode;
  className?: string;
}

export function StorefrontShell({
  children,
  brand,
  cartCount = 0,
  onCartOpen,
  cartDrawer,
  filterPanel,
  className,
}: StorefrontShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = React.useState(false);

  return (
    <div className={cn("min-h-screen bg-[var(--background)]", className)}>
      {/* Sticky store header */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            {/* Mobile menu */}
            <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>

            {/* Brand */}
            <div className="flex-shrink-0">
              {brand ?? (
                <span className="text-lg font-bold tracking-tight text-[var(--foreground)]">Store</span>
              )}
            </div>

            {/* Search bar */}
            <div className="hidden sm:flex flex-1 max-w-lg mx-4">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input className="pl-9 h-9" placeholder="Search products..." />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Mobile search */}
              <Button variant="ghost" size="icon" className="sm:hidden">
                <Search className="h-5 w-5" />
              </Button>

              {/* Cart trigger */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" aria-label="Shopping cart">
                    <ShoppingBag className="h-5 w-5" />
                    {cartCount > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-bold text-[var(--primary-foreground)]">
                        {cartCount > 99 ? "99+" : cartCount}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-md">
                  <SheetHeader>
                    <SheetTitle>Your Cart ({cartCount})</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4">
                    {cartDrawer ?? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <ShoppingBag className="h-10 w-10 text-[var(--muted-foreground)] mb-3" />
                        <p className="text-sm text-[var(--muted-foreground)]">Your cart is empty</p>
                      </div>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      {/* Main catalog layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-8">
          {/* Desktop filter sidebar */}
          {filterPanel && (
            <aside className="hidden lg:block w-60 shrink-0">
              <div className="sticky top-24 space-y-6">
                {filterPanel}
              </div>
            </aside>
          )}

          {/* Catalog content */}
          <div className="flex-1 min-w-0">
            {/* Mobile filter trigger */}
            {filterPanel && (
              <div className="flex items-center justify-between mb-4 lg:hidden">
                <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      Filters
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
                    <SheetHeader>
                      <SheetTitle>Filters</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4 space-y-6">{filterPanel}</div>
                  </SheetContent>
                </Sheet>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 border-t border-[var(--border)] bg-[var(--card)] py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-[var(--muted-foreground)]">
          © {new Date().getFullYear()} All rights reserved.
        </div>
      </footer>
    </div>
  );
}

/** Standard product card for storefronts */
export interface ProductCardProps {
  image?: string;
  name: string;
  price: string | number;
  originalPrice?: string | number;
  badge?: string;
  onAddToCart?: () => void;
  className?: string;
}

export function ProductCard({ image, name, price, originalPrice, badge, onAddToCart, className }: ProductCardProps) {
  return (
    <div className={cn("group rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-card hover:shadow-float transition-all duration-200 hover:-translate-y-0.5", className)}>
      <div className="relative aspect-square overflow-hidden bg-[var(--muted)]">
        {badge && (
          <div className="absolute left-2 top-2 z-10">
            <Badge variant="destructive" className="text-xs">{badge}</Badge>
          </div>
        )}
        {image ? (
          <img src={image} alt={name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--muted-foreground)]">
            <ShoppingBag className="h-10 w-10 opacity-30" />
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="text-sm font-medium text-[var(--foreground)] truncate mb-1">{name}</h3>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-[var(--foreground)]">
            {typeof price === "number" ? \`$\${price.toFixed(2)}\` : price}
          </span>
          {originalPrice && (
            <span className="text-sm text-[var(--muted-foreground)] line-through">
              {typeof originalPrice === "number" ? \`$\${originalPrice.toFixed(2)}\` : originalPrice}
            </span>
          )}
        </div>
        <Button size="sm" className="mt-3 w-full" onClick={onAddToCart}>
          Add to Cart
        </Button>
      </div>
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/layout/editorial-shell.tsx",
    `import * as React from "react";
import { ArrowLeft, Clock, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EditorialShellProps {
  children: React.ReactNode;
  /** Page title shown in the minimal header */
  siteTitle?: string;
  /** Back button label and handler */
  backLabel?: string;
  onBack?: () => void;
  className?: string;
}

export function EditorialShell({ children, siteTitle, backLabel, onBack, className }: EditorialShellProps) {
  return (
    <div className={cn("min-h-screen bg-[var(--background)]", className)}>
      {/* Minimal header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          {onBack ? (
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
              <ArrowLeft className="h-4 w-4" />
              {backLabel ?? "Back"}
            </Button>
          ) : (
            <span className="text-sm font-semibold text-[var(--foreground)]">{siteTitle ?? "Editorial"}</span>
          )}
        </div>
      </header>

      {/* Reading content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        {children}
      </main>

      {/* Minimal footer */}
      <footer className="border-t border-[var(--border)] mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 text-sm text-[var(--muted-foreground)]">
          © {new Date().getFullYear()} All rights reserved.
        </div>
      </footer>
    </div>
  );
}

/** Article/post header with byline */
export interface ArticleHeaderProps {
  title: string;
  subtitle?: string;
  author?: string;
  authorAvatar?: string;
  date?: string;
  readingTime?: number;
  coverImage?: string;
  tags?: string[];
  className?: string;
}

export function ArticleHeader({
  title,
  subtitle,
  author,
  date,
  readingTime,
  coverImage,
  tags,
  className,
}: ArticleHeaderProps) {
  return (
    <header className={cn("mb-10", className)}>
      {tags && tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs font-medium text-[var(--muted-foreground)]">
              {tag}
            </span>
          ))}
        </div>
      )}
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-4xl leading-tight mb-4">
        {title}
      </h1>
      {subtitle && (
        <p className="text-lg text-[var(--muted-foreground)] leading-relaxed mb-6">{subtitle}</p>
      )}
      <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)] border-b border-[var(--border)] pb-6">
        {author && (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-[var(--accent-foreground)]">
              {author.charAt(0).toUpperCase()}
            </div>
            <span className="font-medium text-[var(--foreground)]">{author}</span>
          </div>
        )}
        {date && (
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span>{date}</span>
          </div>
        )}
        {readingTime && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{readingTime} min read</span>
          </div>
        )}
      </div>
      {coverImage && (
        <div className="mt-8 aspect-video overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--muted)]">
          <img src={coverImage} alt={title} className="h-full w-full object-cover" />
        </div>
      )}
    </header>
  );
}

/** Consistent prose-style body wrapper */
export function ArticleBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "text-[var(--foreground)] leading-relaxed space-y-6",
      "[&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-4",
      "[&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-8 [&_h3]:mb-3",
      "[&_p]:text-base [&_p]:text-[var(--foreground)] [&_p]:leading-7",
      "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2",
      "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2",
      "[&_blockquote]:border-l-4 [&_blockquote]:border-[var(--primary)] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[var(--muted-foreground)]",
      className
    )}>
      {children}
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/layout/focus-shell.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface FocusShellProps {
  children: React.ReactNode;
  /** Content shown in the left marketing panel (desktop only) */
  visual?: React.ReactNode;
  /** Step indicator (e.g., for multi-step flows) */
  stepIndicator?: React.ReactNode;
  /** Minimal brand mark shown at the top */
  brand?: React.ReactNode;
  className?: string;
}

export function FocusShell({ children, visual, stepIndicator, brand, className }: FocusShellProps) {
  return (
    <div className={cn("min-h-screen bg-[var(--background)]", className)}>
      {/* Mobile brand header */}
      <div className="flex items-center justify-between p-4 lg:hidden border-b border-[var(--border)]">
        {brand ?? <span className="text-sm font-semibold text-[var(--foreground)]">App</span>}
        {stepIndicator && <div className="text-xs text-[var(--muted-foreground)]">{stepIndicator}</div>}
      </div>

      <div className="flex min-h-[calc(100vh-57px)] lg:min-h-screen">
        {/* Left visual panel (desktop only) */}
        {visual && (
          <div className="hidden lg:flex lg:w-1/2 xl:w-[45%] flex-col bg-[var(--card)] border-r border-[var(--border)]">
            <div className="flex items-center p-8">
              {brand ?? <span className="text-base font-semibold text-[var(--foreground)]">App</span>}
            </div>
            <div className="flex flex-1 items-center justify-center p-12">
              {visual}
            </div>
          </div>
        )}

        {/* Right form panel */}
        <div className={cn(
          "flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-12",
          !visual && "lg:w-full"
        )}>
          {stepIndicator && (
            <div className="mb-8 hidden lg:flex w-full max-w-sm">
              {stepIndicator}
            </div>
          )}
          <div className="w-full max-w-sm">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Multi-step progress indicator */
export interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
  className?: string;
}

export function StepProgress({ currentStep, totalSteps, stepLabels, className }: StepProgressProps) {
  return (
    <div className={cn("w-full", className)}>
      {/* Mobile compact indicator */}
      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] mb-2 lg:hidden">
        <span>Step {currentStep} of {totalSteps}</span>
        {stepLabels?.[currentStep - 1] && (
          <span className="font-medium text-[var(--foreground)]">{stepLabels[currentStep - 1]}</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[var(--primary)] transition-all duration-500"
          style={{ width: \`\${(currentStep / totalSteps) * 100}%\` }}
        />
      </div>

      {/* Desktop step dots */}
      <div className="hidden lg:flex items-center justify-between mt-4">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const step = i + 1;
          const isComplete = step < currentStep;
          const isCurrent = step === currentStep;
          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold border-2 transition-colors",
                isComplete && "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]",
                isCurrent && "border-[var(--primary)] bg-[var(--background)] text-[var(--primary)]",
                !isComplete && !isCurrent && "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
              )}>
                {isComplete ? "✓" : step}
              </div>
              {stepLabels?.[i] && (
                <span className={cn(
                  "text-xs",
                  isCurrent ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
                )}>
                  {stepLabels[i]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
`
  );

  write(
    dir,
    "src/components/layout/index.ts",
    `// Layout Shell Exports — BigBag Archetype Layouts
export * from "./dashboard-shell";
export * from "./marketing-shell";
export * from "./storefront-shell";
export * from "./editorial-shell";
export * from "./focus-shell";
`
  );

  ensureViteRuntime(dir, projectId);
}

/** True when a file is a JSX/TSX snippet, not a real HTML document. */
export function isJsxHtmlSnippet(content: string): boolean {
  return (
    /\{children\}/.test(content) ||
    /className=\{/.test(content) ||
    /import\s+.+from\s+['"]next/.test(content) ||
    /export\s+default\s+function/.test(content)
  );
}

export function isCompleteHtmlDocument(content: string): boolean {
  const trimmed = content.trim();
  if (isJsxHtmlSnippet(trimmed)) return false;
  if (trimmed.length < 80) return false;
  const hasDoctype = /<!DOCTYPE html/i.test(trimmed);
  const hasHtml = /<html[\s>]/i.test(trimmed);
  const hasBody = /<body[\s>]/i.test(trimmed);
  return (hasDoctype || hasHtml) && hasBody && !/\{[a-zA-Z_][\w.]*\}/.test(trimmed);
}

/** Remove JSX dumps that were wrongly saved as public/index.html. */
export function purgeInvalidStaticHtml(dir: string): void {
  for (const rel of ["public/index.html", "index.html"]) {
    const full = path.join(/* turbopackIgnore: true */ dir, rel);
    if (!fs.existsSync(/* turbopackIgnore: true */ full)) continue;
    try {
      const content = fs.readFileSync(/* turbopackIgnore: true */ full, "utf-8");
      if (!isCompleteHtmlDocument(content)) {
        fs.unlinkSync(full);
        console.log(`[starter-template] Removed invalid static HTML: ${rel}`);
      }
    } catch {
      // ignore
    }
  }
}
