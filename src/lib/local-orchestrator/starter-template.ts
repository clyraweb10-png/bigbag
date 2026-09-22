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
  sonner: "^2.0.7",
  jsdom: "^26.1.0",
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

/**
 * Browser-only client for the platform's project-scoped durable datastore.
 * Provider/database credentials stay in the builder server; generated bundles
 * contain only same-origin HTTP calls.
 */
export const GENERATED_DB_CLIENT_SOURCE = `export type DbRecord = Record<string, unknown> & {
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
  const capability = (window as Window & { __BIGBAG_WRITE_CAPABILITY__?: string })
    .__BIGBAG_WRITE_CAPABILITY__;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(capability ? { "X-BigBag-Capability": capability } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: string } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error || "Database request failed (" + response.status + ")");
  }
  return payload.data;
}

export function collection(name: string) {
  const url = collectionPath(name);
  return {
    async list(options: ListOptions = {}): Promise<{ records: DbRecord[]; total: number }> {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.offset !== undefined) query.set("offset", String(options.offset));
      return request(url + (query.size ? "?" + query.toString() : ""));
    },
    async get(id: string): Promise<DbRecord> {
      return request(url + "/" + encodeURIComponent(id));
    },
    async create(data: Record<string, unknown>): Promise<DbRecord> {
      return request(url, { method: "POST", body: JSON.stringify({ data }) });
    },
    async update(id: string, data: Record<string, unknown>): Promise<DbRecord> {
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
function ensureViteRuntime(dir: string, projectId: string): void {
  const pkgPath = path.join(dir, "package.json");
  const dbClientPath = path.join(dir, "src/lib/db.ts");
  const currentDbClient = fs.existsSync(dbClientPath)
    ? fs.readFileSync(dbClientPath, "utf-8")
    : null;
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
  } else if (migrateLegacyDbClient) {
    write(dir, "src/lib/db.ts", GENERATED_DB_CLIENT_SOURCE);
  }

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
    `import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
  const templateServerConfig = 'server: { allowedHosts: [".e2b.app"] },';
  if (updatedViteConfig.includes(templateServerConfig)) {
    updatedViteConfig = updatedViteConfig.replace(
      templateServerConfig,
      'server: { allowedHosts: [".e2b.app"], hmr: false },'
    );
  }
  if (!/\bbuild\s*:/.test(updatedViteConfig)) {
    updatedViteConfig = updatedViteConfig.replace(
      /plugins:\s*\[react\(\)\],/,
      'plugins: [react()],\n  build: { minify: false },'
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

:root {
  --background: 248 250 252;
  --foreground: 15 23 42;
  --primary: 79 70 229;
  --primary-foreground: 255 255 255;
  --muted: 241 245 249;
  --muted-foreground: 100 116 139;
  --border: 226 232 240;
  --ring: 79 70 229;
}

body {
  color: rgb(var(--foreground));
  background: rgb(var(--background));
  min-height: 100vh;
}

@theme inline {
  --color-background: rgb(var(--background));
  --color-foreground: rgb(var(--foreground));
  --color-primary: rgb(var(--primary));
  --color-primary-foreground: rgb(var(--primary-foreground));
  --color-muted: rgb(var(--muted));
  --color-muted-foreground: rgb(var(--muted-foreground));
  --color-border: rgb(var(--border));
  --color-ring: rgb(var(--ring));
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
    "src/components/ui/button.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-indigo-600 text-white hover:bg-indigo-500",
        variant === "outline" && "border border-slate-300 bg-white hover:bg-slate-50 text-slate-900",
        variant === "ghost" && "hover:bg-slate-100 text-slate-900",
        variant === "secondary" && "bg-slate-100 text-slate-900 hover:bg-slate-200",
        size === "default" && "h-10 px-4 py-2",
        size === "sm" && "h-9 px-3",
        size === "lg" && "h-11 px-8",
        size === "icon" && "h-10 w-10",
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
    "src/components/ui/card.tsx",
    `import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-slate-500", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
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
