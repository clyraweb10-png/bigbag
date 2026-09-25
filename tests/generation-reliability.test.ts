import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { ensureWorkspaceDependencies } from "../src/lib/local-orchestrator/dependency-scanner";
import { probeBuiltPreview } from "../src/lib/local-orchestrator/preview-readiness";
import { generationValidationIssues, isRuntimeOwnedGeneratedPath, validationRepairContext } from "../src/lib/local-orchestrator/generation-validator";
import { GENERATED_AUTH_CLIENT_SOURCE, GENERATED_DB_CLIENT_SOURCE, PREINSTALLED_DEPENDENCIES, writeStarterTemplate } from "../src/lib/local-orchestrator/starter-template";
import { compactRepairContext, completeSemanticCss, fixCssImportOrder, hasRealGeneratedSource, postProcessGeneratedFiles, promptRequestsAuthentication, promptRequestsCommerce, promptRequestsPersistence, promptRequestsPrivateFiles, repairContextIncludesAffectedFiles, requestedSharedCatalogCollections, workspaceRepairContext } from "../src/lib/local-orchestrator/agent-engine";
import { localProjectStore } from "../src/lib/local-orchestrator/project-store";
import { localFileManager } from "../src/lib/local-orchestrator/file-manager";
import { multiModelRouter } from "../src/lib/local-orchestrator/multi-model-router";
import { GET as getConnectorStatus } from "../src/app/api/connectors/status/route";
import { AUTH_COOKIE, createAuthSession } from "../src/lib/auth-session";
import { NextRequest } from "next/server";
import { generatedProcessEnvironment } from "../src/lib/local-orchestrator/process-env";
import { GENERATED_RUNTIME_CHECK_SCRIPT } from "../src/lib/local-orchestrator/runtime-validator";
import { safeConfiguredModel } from "../src/lib/local-orchestrator/provider-model-config";

function previewFetch(overrides: Record<string, Response> = {}): typeof fetch {
  const responses: Record<string, Response> = {
    "https://preview.example/": new Response('<div id="root"></div><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>', { headers: { "content-type": "text/html" } }),
    "https://preview.example/assets/app.css": new Response("body{color:black}", { headers: { "content-type": "text/css" } }),
    "https://preview.example/assets/app.js": new Response("console.log('ready')", { headers: { "content-type": "text/javascript" } }),
    ...overrides,
  };
  return (async (input: RequestInfo | URL) => responses[String(input)]?.clone() ||
    new Response("missing", { status: 404, headers: { "content-type": "text/html" } })) as typeof fetch;
}

test("a fresh starter workspace is not mistaken for an incremental user project", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-fresh-starter-"));
  try {
    writeStarterTemplate(workspace, "fresh-starter-qualification");
    const files: Array<{ path: string; content: string }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); }
        else if (/\.(?:tsx?|jsx?|css|html)$/.test(entry.name)) {
          files.push({ path: path.relative(workspace, full).replaceAll(path.sep, "/"), content: fs.readFileSync(full, "utf8") });
        }
      }
    };
    walk(workspace);
    assert.equal(hasRealGeneratedSource(files), false);
    const shell = files.find((file) => file.path === "src/components/layout/dashboard-shell.tsx");
    assert.ok(shell);
    assert.equal(fs.readFileSync(path.join(workspace, "src/components/ui/skeleton-card.tsx"), "utf8"),
      'export { SkeletonCard } from "./skeleton";\n');
    assert.match(fs.readFileSync(path.join(workspace, "src/components/ui/spinner.tsx"), "utf8"), /LoaderCircle/);
    assert.match(fs.readFileSync(path.join(workspace, "src/components/ui/empty-state.tsx"), "utf8"), /<h2\b/);
    assert.match(fs.readFileSync(path.join(workspace, "src/components/ui/empty-state.tsx"), "utf8"), /icon\?: React\.ReactNode \| React\.ElementType/);
    const focusShell = fs.readFileSync(path.join(workspace, "src/components/layout/focus-shell.tsx"), "utf8");
    assert.match(focusShell, /<header\b/);
    assert.match(focusShell, /<main\b/);
    assert.equal(isRuntimeOwnedGeneratedPath(shell.path, shell.content), true);
    assert.equal(isRuntimeOwnedGeneratedPath(shell.path, shell.content.replace("// @bigbag-runtime-layout\n", "")), false,
      "A newly customized shell without the runtime marker must remain editable");
    assert.equal(isRuntimeOwnedGeneratedPath(shell.path, "export function DashboardShell() { return <main>Custom shell</main>; }"), false);
    assert.equal(isRuntimeOwnedGeneratedPath("src/components/layout/index.tsx", "export * from './custom-shell';"), true);
    assert.equal(isRuntimeOwnedGeneratedPath("src/components/ui.tsx", "export function Button() { return null; }"), true);
    assert.equal(hasRealGeneratedSource([...files, {
      path: "src/components/customer-view.tsx", content: "export function CustomerView() { return <main>Customers</main>; }",
    }]), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unimported generated stylesheet replaces the stylesheet loaded by the runtime", () => {
  const files = [
    { path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }" },
    { path: "src/globals.css", content: "@import \"tailwindcss\"; body { color: red; }" },
  ];
  postProcessGeneratedFiles(files);
  assert.equal(files.find((file) => file.path.endsWith("globals.css"))?.path, "src/app/globals.css");
  assert.match(files[1].content, /--color-card:\s*var\(--card\)/);
  assert.match(files[1].content, /--card:\s*var\(--surface/);
  assert.equal(completeSemanticCss(files[1].content), files[1].content);

  const explicitlyImported = [
    { path: "src/App.tsx", content: 'import "./globals.css"; export default function App() { return <main>Ready</main>; }' },
    { path: "src/globals.css", content: "@import \"tailwindcss\";" },
  ];
  postProcessGeneratedFiles(explicitlyImported);
  assert.equal(explicitlyImported[1].path, "src/globals.css");

  const importedByExistingApp = [{ path: "src/globals.css", content: "body { color: blue; }" }];
  postProcessGeneratedFiles(importedByExistingApp, [
    { path: "src/App.tsx", content: 'import "./globals.css"; export default function App() { return <main>Ready</main>; }' },
  ]);
  assert.equal(importedByExistingApp[0].path, "src/globals.css");
});

test("generated app and entrypoint do not mount duplicate toast regions", () => {
  const files = [
    { path: "src/App.tsx", content: 'import { Toaster, toast } from "sonner";\nexport default function App() { return <><main>Ready</main><Toaster position="top-right" /></>; }' },
    { path: "src/main.tsx", content: 'import { Toaster } from "sonner";\ncreateRoot(root).render(<><App/><Toaster /></>);' },
  ];
  postProcessGeneratedFiles(files);
  assert.doesNotMatch(files[0].content, /<Toaster\b/);
  assert.match(files[0].content, /import \{ toast \} from "sonner"/);
  assert.match(files[1].content, /<Toaster\b/);
});

test("an unrelated sign-in password does not make project CRUD look like an auth store", () => {
  const safe = generationValidationIssues([{ path: "src/App.tsx", content: `import db from "@/lib/db";
import { auth } from "@/lib/auth";
async function submit(email: string, password: string) {
  await db.collection("reservations").create({ date: "2030-04-02" });
  await auth.signUp(email, password);
}
export default function App() { return <main>Reservations</main>; }` }], [], { requireEntrypoint: true, allowAuthentication: true });
  assert.equal(safe.some((issue) => issue.includes("CRUD datastore as an authentication system")), false);
  const unsafe = generationValidationIssues([{ path: "src/App.tsx", content: `import db from "@/lib/db";
async function submit(password: string) { await db.collection("users").create({ password }); }
export default function App() { return <main>Accounts</main>; }` }], [], { requireEntrypoint: true, allowAuthentication: true });
  assert.equal(unsafe.some((issue) => issue.includes("CRUD datastore as an authentication system")), true);
});

test("service catalog classification requires service or availability intent", () => {
  assert.deepEqual(requestedSharedCatalogCollections("Build a personal appointment tracker"), []);
  assert.deepEqual(requestedSharedCatalogCollections("Build a restaurant reservation app with table availability"), ["tables"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build a booking application with providers, services and availability"), ["services"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build a real estate app with searchable property listings"), ["listings"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build a private listing of household chores"), []);
});

test("conditional safety wording does not add login to a public application", () => {
  assert.equal(promptRequestsAuthentication("Build a Kanban board. Use real supported authentication and server/database authorization when requested. Never use browser storage as the authority for authentication."), false);
  assert.equal(promptRequestsAuthentication("Build a public portfolio. Do not add login or signup."), false);
  assert.equal(promptRequestsAuthentication("Build a CRM with real authentication and private customer records."), true);
  assert.equal(promptRequestsAuthentication("Create a SaaS."), true);
  assert.equal(promptRequestsAuthentication("Build a production inventory manager with stock updates."), true);
  assert.equal(promptRequestsAuthentication("Never use fake login. Add real sign in and protected routes."), true);
  assert.equal(promptRequestsAuthentication("Build a CRM without login or user accounts."), false);
  assert.equal(promptRequestsAuthentication("Make a SaaS dashboard. Do not require users to log in."), false);
});

test("requested private uploads use the platform file boundary", () => {
  assert.equal(promptRequestsPrivateFiles("Build a document manager with actual uploads"), true);
  assert.equal(promptRequestsPrivateFiles("Add photo uploads to my portfolio"), true);
  assert.equal(promptRequestsPrivateFiles("Build a landing page. Never upload private files."), false);
  assert.equal(promptRequestsPrivateFiles("Create a Kanban board"), false);
  assert.equal(isRuntimeOwnedGeneratedPath("src/lib/files.ts"), true);
});

test("continuation refreshes known starter primitives while preserving customized components", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-runtime-refresh-"));
  try {
    writeStarterTemplate(workspace, "runtime-refresh-check");
    const button = path.join(workspace, "src/components/ui/button.tsx");
    const alert = path.join(workspace, "src/components/ui/alert.tsx");
    const uiIndex = path.join(workspace, "src/components/ui/index.ts");
    const dashboard = path.join(workspace, "src/components/layout/dashboard-shell.tsx");
    const marketing = path.join(workspace, "src/components/layout/marketing-shell.tsx");
    const customDashboard = "// @bigbag-runtime-layout\nexport function DashboardShell() { return <main>Custom shell</main>; }\n";
    const customMarketing = "export function MarketingShell() { return <main>Custom layout</main>; }\n";
    fs.writeFileSync(button, fs.readFileSync(path.join(process.cwd(), "tests/fixtures/runtime-button-legacy.tsx"), "utf8"));
    fs.writeFileSync(alert, "export function Alert() { return null; }\n");
    fs.writeFileSync(uiIndex, 'export { Button } from "./button";\n');
    fs.writeFileSync(dashboard, customDashboard);
    fs.writeFileSync(marketing, customMarketing);
    writeStarterTemplate(workspace, "runtime-refresh-check");
    assert.match(fs.readFileSync(button, "utf8"), /asChild\?: boolean/);
    assert.match(fs.readFileSync(button, "utf8"), /icon-sm/);
    assert.equal(fs.readFileSync(alert, "utf8"), "export function Alert() { return null; }\n");
    assert.equal(fs.readFileSync(uiIndex, "utf8"), 'export { Button } from "./button";\nexport * from "./spinner";\n');
    assert.equal(fs.readFileSync(dashboard, "utf8"), customDashboard);
    assert.equal(fs.readFileSync(marketing, "utf8"), customMarketing);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("generated apps may import the supplied layout shell barrel", () => {
  const issues = generationValidationIssues([{
    path: "src/App.tsx",
    content: 'import { DashboardShell } from "@/components/layout"; export default function App() { return <DashboardShell />; }',
  }], [], { requireEntrypoint: true });
  assert.equal(issues.some((issue) => issue.includes("imports missing local module @/components/layout")), false);
});

test("generated apps may import the supplied SkeletonCard alias", () => {
  const issues = generationValidationIssues([{
    path: "src/App.tsx",
    content: 'import { SkeletonCard } from "@/components/ui/skeleton-card"; export default function App() { return <SkeletonCard />; }',
  }], [], { requireEntrypoint: true });
  assert.equal(issues.some((issue) => issue.includes("imports missing local module @/components/ui/skeleton-card")), false);
});

test("build repair sees a failing caller and its imported prop definition before unrelated files", () => {
  const projectId = `repair-context-${randomUUID()}`;
  localProjectStore.create({ projectId, tenantId: "synthetic", description: "Repair context ordering" });
  try {
    localFileManager.writeContent(projectId, "src/components/Caller.tsx",
      'import { DashboardShell } from "@/components/layout"; export function Caller() { return <DashboardShell brand="example" />; }', "utf8");
    localFileManager.writeContent(projectId, "src/components/layout.tsx",
      'interface LayoutProps { user: string; children: React.ReactNode } export function DashboardShell(props: LayoutProps) { return props.children; }', "utf8");
    localFileManager.writeContent(projectId, "src/components/layout/index.ts",
      'export { DashboardShell } from "../layout";', "utf8");
    localFileManager.writeContent(projectId, "src/components/unrelated.tsx", "export const unrelated = 1;", "utf8");
    const context = workspaceRepairContext(projectId,
      "src/components/Caller.tsx(1,1): Type '{ brand: string; }' is not assignable to type LayoutProps");
    assert.deepEqual([...context.matchAll(/^### File: (.+)$/gm)].slice(0, 2).map((match) => match[1]),
      ["src/components/Caller.tsx", "src/components/layout.tsx"]);
  } finally {
    localProjectStore.remove(projectId);
  }
});

test("compact repair includes complete affected files or rejects an unsafe provider context", () => {
  const files = [
    { path: "src/components/Unrelated.tsx", content: "export const unrelated = true;" },
    { path: "src/App.tsx", content: "import db from '@/lib/db';\n" + "const middle = 1;\n".repeat(2_000) + "export default function App() { return <main>Ready</main>; }" },
  ];
  const issues = ["syntax error in src/App.tsx: '>' expected"];
  const context = compactRepairContext(files, issues, 12_000);
  assert.ok(context.length < 13_000);
  assert.doesNotMatch(context, /### File: src\/App\.tsx/);
  assert.equal(repairContextIncludesAffectedFiles(files, issues, context), false);
  const complete = compactRepairContext([
    { path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }" },
    files[0],
  ], issues, 12_000);
  assert.equal(repairContextIncludesAffectedFiles([{ path: "src/App.tsx", content: "export default function App() { return <main>Ready</main>; }" }], issues, complete), true);
  assert.match(complete, /### File: src\/App\.tsx\n```\nexport default function App/);
  const full = validationRepairContext(files, issues, 12_000);
  assert.equal(repairContextIncludesAffectedFiles(files, issues, full), false);
  assert.equal(full.includes("const middle = 1"), false);
});

test("router skips a provider when complete repair source cannot fit", async () => {
  const previousGroq = process.env.GROQ_API_KEY;
  const previousFetch = global.fetch;
  process.env.GROQ_API_KEY = "synthetic-groq-context-skip";
  let requests = 0;
  global.fetch = (async () => { requests += 1; throw new Error("Provider should not be called"); }) as typeof fetch;
  try {
    await assert.rejects(multiModelRouter.complete([{ role: "user", content: "Repair" }], undefined, {
      onlyProviderId: "groq", providerMessageTransform: () => null,
    }), (error: unknown) => Boolean(error && typeof error === "object" && "category" in error && error.category === "context_limit"));
    assert.equal(requests, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroq;
  }
});

test("credential-looking model configuration cannot reach provider requests or status logs", () => {
  assert.equal(safeConfiguredModel("gsk_synthetic_not_a_model_123456789", "qwen/default"), "qwen/default");
  assert.equal(safeConfiguredModel("sk-synthetic-not-a-model-123456789", "qwen/default"), "qwen/default");
  assert.equal(safeConfiguredModel("zai-org/GLM-5.3-Flash", "fallback"), "zai-org/GLM-5.3-Flash");
  const previous = process.env.TEST_PROVIDER_TOKEN;
  process.env.TEST_PROVIDER_TOKEN = "custom.model.identifier";
  try {
    assert.equal(safeConfiguredModel("custom.model.identifier", "fallback"), "fallback");
  } finally {
    if (previous === undefined) delete process.env.TEST_PROVIDER_TOKEN;
    else process.env.TEST_PROVIDER_TOKEN = previous;
  }
});

test("preview readiness requires served JavaScript and CSS with correct MIME types", async () => {
  assert.deepEqual(await probeBuiltPreview("https://preview.example/", { fetcher: previewFetch() }), { ok: true });
  const missingScript = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/assets/app.js": new Response("missing", { status: 404 }) }),
  });
  assert.equal(missingScript.ok, false);
  assert.match(missingScript.error || "", /script returned HTTP 404/);
  const wrongMime = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/assets/app.js": new Response("<html>fallback</html>", { headers: { "content-type": "text/html" } }) }),
  });
  assert.equal(wrongMime.ok, false);
  assert.match(wrongMime.error || "", /invalid content type/);
  const uncompiledCss = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/assets/app.css": new Response("@tailwind utilities;", { headers: { "content-type": "text/css" } }) }),
  });
  assert.equal(uncompiledCss.ok, false);
  assert.match(uncompiledCss.error || "", /Tailwind utilities were not compiled/);
  const dataAttributeOnly = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/": new Response('<script data-src="/assets/app.js"></script>', { headers: { "content-type": "text/html" } }) }),
  });
  assert.equal(dataAttributeOnly.ok, false);
  assert.match(dataAttributeOnly.error || "", /no JavaScript entrypoint/);
  const redirectModes: Array<RequestRedirect | undefined> = [];
  const checkedFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    redirectModes.push(init?.redirect);
    return previewFetch()(input);
  }) as typeof fetch;
  assert.deepEqual(await probeBuiltPreview("https://preview.example/", { fetcher: checkedFetcher }), { ok: true });
  assert.ok(redirectModes.length >= 2 && redirectModes.every((mode) => mode === "error"));
  const missingPreload = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/": new Response(
      '<script type="module" src="/assets/app.js"></script><link rel="modulepreload" href="/assets/dependency.js">',
      { headers: { "content-type": "text/html" } }
    ) }),
  });
  assert.equal(missingPreload.ok, false);
  assert.match(missingPreload.error || "", /script returned HTTP 404/);
  const externalStyle = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/": new Response(
      '<link rel="stylesheet" href="https://fonts.example/style.css"><script type="module" src="/assets/app.js"></script>',
      { headers: { "content-type": "text/html" } }
    ) }),
  });
  assert.deepEqual(externalStyle, { ok: true });
  const externalOnlyScript = await probeBuiltPreview("https://preview.example/", {
    fetcher: previewFetch({ "https://preview.example/": new Response(
      '<script type="module" src="https://scripts.example/app.js"></script>',
      { headers: { "content-type": "text/html" } }
    ) }),
  });
  assert.equal(externalOnlyScript.ok, false);
  assert.match(externalOnlyScript.error || "", /no JavaScript entrypoint/);
});

test("runtime validation ignores optional external fonts while running local JavaScript", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-external-font-"));
  try {
    const dist = path.join(workspace, "dist");
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), '<div id="root"></div><link rel="stylesheet" href="https://fonts.example/font.css"><link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>');
    fs.writeFileSync(path.join(dist, "assets/app.css"), "body { color: black; }");
    fs.writeFileSync(path.join(dist, "assets/app.js"), 'document.getElementById("root").textContent = "Ready";');
    const script = path.join(workspace, "validate.cjs");
    fs.writeFileSync(script, GENERATED_RUNTIME_CHECK_SCRIPT);
    const checked = spawnSync(process.execPath, ["--experimental-vm-modules", script, dist, path.join(process.cwd(), "node_modules")], {
      encoding: "utf8", timeout: 15_000,
    });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("generated data client retries one rejected auth request but does not retry authorization denial", async () => {
  const source = ts.transpileModule(GENERATED_DB_CLIENT_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let attempts = 0;
  let status = 401;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert.equal(name, "@/lib/auth-bridge");
      return { getPlatformAuthAccessToken: async () => "synthetic-access-token" };
    },
    window: { location: { pathname: "/api/preview/test-project/" } },
    URLSearchParams,
    fetch: async (_url: string, init: RequestInit) => {
      attempts += 1;
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer synthetic-access-token");
      return attempts === 1 ? Response.json({ error: "Session is refreshing" }, { status })
        : Response.json({ data: { records: [], total: 0 } });
    },
  });
  const db = exports.db as { collection: (name: string) => { list: () => Promise<{ total: number }> } };
  assert.equal((await db.collection("trips").list()).total, 0);
  assert.equal(attempts, 2);
  attempts = 0;
  status = 403;
  await assert.rejects(db.collection("trips").list(), /Session is refreshing/);
  assert.equal(attempts, 1);
});

test("managed generated clients expose public auth types and preserve durable response shapes", () => {
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /export type Session = Omit<SupabaseSession, "user"> & \{ user: User \}/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /async signUp\(emailOrName: string, passwordOrEmail: string, suppliedPassword\?: string\)/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /options: name \? \{ data: \{ name \} \} : undefined/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /session: Session \| null/);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /export type ListResult<T> = \{ records: T\[\]; total: number \}/);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /return result;/);
});

test("unsupported optional imports are rejected before package metadata changes", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-dependency-check-"));
  try {
    const packagePath = path.join(workspace, "package.json");
    fs.writeFileSync(packagePath, '{"dependencies":{"react":"19.2.7"}}\n');
    const before = fs.readFileSync(packagePath, "utf8");
    await assert.rejects(() => ensureWorkspaceDependencies([
      { path: "src/App.tsx", content: 'import Fancy from "unnecessary-ui-library"; export default Fancy;' },
    ], workspace), /Unsupported generated dependency: unnecessary-ui-library/);
    assert.equal(fs.readFileSync(packagePath, "utf8"), before);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("unused unsupported declarations are pruned but imported ones remain explicit errors", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-stale-dependency-"));
  try {
    const packagePath = path.join(workspace, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ dependencies: { react: "19.2.7", "unnecessary-ui-library": "1.0.0" } }));
    const result = await ensureWorkspaceDependencies([{ path: "src/App.tsx", content: 'import React from "react"; export default React;' }], workspace);
    assert.deepEqual(result.added, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(packagePath, "utf8")).dependencies, { react: "19.2.7" });
    fs.mkdirSync(path.join(workspace, "src"));
    fs.writeFileSync(path.join(workspace, "src/legacy.tsx"), 'import Fancy from "unnecessary-ui-library"; export default Fancy;');
    const before = fs.readFileSync(packagePath, "utf8");
    await assert.rejects(() => ensureWorkspaceDependencies([], workspace), /Unsupported generated dependency: unnecessary-ui-library/);
    assert.equal(fs.readFileSync(packagePath, "utf8"), before);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("generated build manifest keeps imported starter packages and drops unused heavy packages", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-starter-dependencies-"));
  try {
    const packagePath = path.join(workspace, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ dependencies: {
      react: PREINSTALLED_DEPENDENCIES.react,
      "react-dom": PREINSTALLED_DEPENDENCIES["react-dom"],
      "lucide-react": PREINSTALLED_DEPENDENCIES["lucide-react"],
      recharts: PREINSTALLED_DEPENDENCIES.recharts,
      jsdom: PREINSTALLED_DEPENDENCIES.jsdom,
    } }));
    fs.mkdirSync(path.join(workspace, "node_modules", "lucide-react"), { recursive: true });
    await ensureWorkspaceDependencies([
      { path: "src/App.tsx", content: 'import { Menu } from "lucide-react"; export default Menu;' },
    ], workspace);
    const dependencies = JSON.parse(fs.readFileSync(packagePath, "utf8")).dependencies;
    assert.deepEqual(Object.keys(dependencies).sort(), ["react", "react-dom", "lucide-react", "jsdom"].sort());
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("runtime refresh preserves a lean manifest and later imports restore needed starter packages", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-lean-runtime-"));
  try {
    writeStarterTemplate(workspace, "lean-runtime-check");
    await ensureWorkspaceDependencies([], workspace);
    const packagePath = path.join(workspace, "package.json");
    const before = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    assert.equal(before.dependencies.recharts, undefined);
    assert.equal(before.dependencies.jsdom, PREINSTALLED_DEPENDENCIES.jsdom);
    writeStarterTemplate(workspace, "lean-runtime-check");
    const refreshed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    assert.equal(refreshed.dependencies.recharts, undefined);
    assert.equal(refreshed.dependencies.jsdom, PREINSTALLED_DEPENDENCIES.jsdom);
    await ensureWorkspaceDependencies([{ path: "src/App.tsx", content: 'import { motion } from "framer-motion"; export default motion.div;' }], workspace);
    const imported = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    assert.equal(imported.dependencies["framer-motion"], PREINSTALLED_DEPENDENCIES["framer-motion"]);
    assert.equal(imported.dependencies.recharts, undefined);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("generated manifests cannot install local files or Git URLs as dependency versions", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-registry-version-"));
  try {
    const packagePath = path.join(workspace, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ dependencies: {
      react: "file:/tmp/untrusted-react",
      zod: "git+https://example.invalid/untrusted.git",
    } }));
    fs.mkdirSync(path.join(workspace, "node_modules/react"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "node_modules/zod"), { recursive: true });
    await ensureWorkspaceDependencies([{ path: "src/App.tsx", content: 'import { z } from "zod"; export default z;' }], workspace);
    const sanitized = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    assert.equal(sanitized.dependencies.react, PREINSTALLED_DEPENDENCIES.react);
    assert.equal(sanitized.dependencies.zod, "4.1.12");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("a restored legacy server dependency can be resolved without changing its declared version", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-legacy-dependency-"));
  try {
    fs.writeFileSync(path.join(workspace, "package.json"), '{"dependencies":{"@libsql/client":"^0.14.0"}}\n');
    fs.mkdirSync(path.join(workspace, "node_modules", "@libsql", "client"), { recursive: true });
    const result = await ensureWorkspaceDependencies([
      { path: "src/server/legacy-db.ts", content: 'import { createClient } from "@libsql/client"; export { createClient };' },
    ], workspace);
    assert.deepEqual(result.added, []);
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8")).dependencies["@libsql/client"], "^0.14.0");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("generated browser source rejects private credential references and literals", () => {
  const issues = generationValidationIssues([
    { path: "src/App.tsx", content: 'export default function App() { return <main>{import.meta.env.VITE_GEMINI_API_KEY}</main>; }' },
  ], [], { requireEntrypoint: true });
  assert.ok(issues.some((issue) => issue.includes("Server-only credential identifier")));
  const literalIssues = generationValidationIssues([
    { path: "src/App.tsx", content: 'export default function App() { return <main>gsk_abcdefghijklmnop12345678</main>; }' },
  ], [], { requireEntrypoint: true });
  assert.ok(literalIssues.some((issue) => issue.includes("Credential-shaped literal")));
});

test("short SaaS prompts require durable records while marketing prompts stay frontend-only", () => {
  assert.equal(promptRequestsPersistence("Create a SaaS"), true);
  assert.equal(promptRequestsPersistence("Build a SaaS landing page"), false);
  assert.equal(promptRequestsPersistence("Build a Kanban board. Do not persist data or add a database."), false);
  assert.equal(promptRequestsPersistence("Create a SaaS landing page; no database or backend."), false);
  assert.equal(promptRequestsPersistence("Create a SaaS with customer records; no fake data."), true);
  const app = 'export default function App() { return <main>Customers</main>; }';
  const issues = generationValidationIssues([{ path: "src/App.tsx", content: app }], [], { requirePersistence: true });
  assert.ok(issues.some((issue) => issue.includes("no durable database collection")));
  const runtimeOnly = generationValidationIssues([{ path: "src/App.tsx", content: app }], [], {
    requirePersistence: true,
    existingSources: [{
      path: "src/components/ui/button.tsx",
      content: 'import db from "@/lib/db"; const items = db.collection("items");',
    }],
  });
  assert.ok(runtimeOnly.some((issue) => issue.includes("no durable database collection")));
  const durable = generationValidationIssues([
    { path: "src/App.tsx", content: 'import db from "@/lib/db"; const customers = db.collection("customers"); export default function App() { return <main>Customers</main>; }' },
  ], ["src/lib/db.ts"], { requirePersistence: true });
  assert.equal(durable.some((issue) => issue.includes("no durable database collection")), false);
  for (const content of [
    'import store from "@/lib/db"; store.from("customers");',
    'import { db as store } from "@/lib/db"; store.collection("customers");',
    'import { collection as records } from "@/lib/db"; records("customers");',
  ]) {
    const aliasIssues = generationValidationIssues([{ path: "src/lib/customer-data.ts", content }], [], {
      requireEntrypoint: false, requirePersistence: true,
    });
    assert.equal(aliasIssues.some((issue) => issue.includes("no durable database collection")), false, content);
  }
  const relative = generationValidationIssues([
    { path: "src/components/customer-data.ts", content: 'import client from "../lib/db"; client.collection("customers");' },
  ], [], { requireEntrypoint: false, requirePersistence: true });
  assert.equal(relative.some((issue) => issue.includes("no durable database collection")), false);
});

test("unrequested seed modules cannot invent production inventory", () => {
  const issues = generationValidationIssues([
    { path: "src/lib/seed-products.ts", content: 'export const seedProducts = [{ name: "Invented coat", stock: 12 }];' },
  ], [], { requireEntrypoint: false, allowSeedData: false });
  assert.ok(issues.some((issue) => issue.includes("seed-products.ts adds seed or fixture data")));
  const ordinaryComponent = generationValidationIssues([
    { path: "src/components/seed-picker.tsx", content: 'export function SeedPicker() { return <button>Choose a seed</button>; }' },
  ], [], { requireEntrypoint: false, allowSeedData: false });
  assert.equal(ordinaryComponent.some((issue) => issue.includes("adds seed or fixture data")), false);
});

test("generated Vite template compiles Tailwind utilities into its preview CSS", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-tailwind-check-"));
  try {
    writeStarterTemplate(workspace, "tailwind-check");
    fs.writeFileSync(path.join(workspace, "src/app/globals.css"), fixCssImportOrder(":root { --background: white; }\n"));
    fs.writeFileSync(path.join(workspace, "src/App.tsx"),
      'export default function App() { return <main className="grid gap-4 rounded-xl overflow-x-auto">Styled</main>; }');
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    const build = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/vite/bin/vite.js"), "build"], {
      cwd: workspace, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const assets = path.join(workspace, "dist/assets");
    const css = fs.readdirSync(assets).filter((name) => name.endsWith(".css"))
      .map((name) => fs.readFileSync(path.join(assets, name), "utf8")).join("\n");
    assert.match(css, /\.grid\s*\{/);
    assert.match(css, /\.gap-4\s*\{/);
    assert.match(css, /\.overflow-x-auto\s*\{/);
    assert.doesNotMatch(css, /@tailwind\s+utilities/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("new storefront shell compiles with controlled cart and functional search props", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-storefront-check-"));
  try {
    writeStarterTemplate(workspace, "storefront-check");
    fs.writeFileSync(path.join(workspace, "src/App.tsx"), `
      import * as React from "react";
      import { StorefrontShell } from "@/components/layout/storefront-shell";
      import { Button } from "@/components/ui/button";
      import { auth } from "@/lib/auth";
      export default function App() {
        const [cartOpen, setCartOpen] = React.useState(false);
        const [search, setSearch] = React.useState("");
        const [owner, setOwner] = React.useState(false);
        React.useEffect(() => { void auth.getCommerceRole().then((role) => setOwner(role === "owner")); }, []);
        return <StorefrontShell cartOpen={cartOpen} onCartOpenChange={setCartOpen}
          searchValue={search} onSearchChange={setSearch} cartDrawer={<button onClick={() => setCartOpen(false)}>Checkout</button>}>
          <main>Catalog {owner ? <Button asChild><a href="/admin">Manage products</a></Button> : null}</main>
        </StorefrontShell>;
      }
    `);
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    const typecheck = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/typescript/bin/tsc"), "--noEmit"], {
      cwd: workspace, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("starter accepts installed icon components and compact icon buttons", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-icons-check-"));
  try {
    writeStarterTemplate(workspace, "icons-check");
    fs.writeFileSync(path.join(workspace, "src/App.tsx"), `
      import { Home, DollarSign } from "lucide-react";
      import { DashboardShell } from "@/components/layout";
      import { MetricCard, Button, EmptyState } from "@/components/ui";
      export default function App() {
        return <DashboardShell pageTitle="Dashboard" navItems={[{ label: "Home", icon: Home, onClick: () => {} }]}>
          <MetricCard label="Revenue" value="$0" icon={DollarSign} />
          <Button size="icon-sm" aria-label="Open options"><Home /></Button>
          <EmptyState title="No items"><Button>Add first item</Button></EmptyState>
        </DashboardShell>;
      }
    `);
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    const typecheck = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/typescript/bin/tsc"), "--noEmit"], {
      cwd: workspace, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("a rejected AI credential enters a cooldown while a healthy fallback keeps working", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = "synthetic-gemini-cooldown";
  process.env.TELNYX_API_KEY = "synthetic-telnyx-cooldown";
  const urls: string[] = [];
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return url.includes("generativelanguage.googleapis.com")
      ? Response.json({ error: { message: "invalid synthetic credential" } }, { status: 401 })
      : Response.json({ choices: [{ finish_reason: "stop", message: { content: "Working fallback" } }] });
  }) as typeof fetch;
  try {
    const first = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { retryDelayMs: 0 });
    const second = await multiModelRouter.complete([{ role: "user", content: "Build again" }], undefined, { retryDelayMs: 0 });
    assert.equal(first.providerId, "telnyx-glm");
    assert.equal(second.providerId, "telnyx-glm");
    assert.deepEqual(first.failureCategories, ["authentication"]);
    assert.deepEqual(second.failureCategories, ["authentication"]);
    assert.equal(urls.filter((url) => url.includes("generativelanguage.googleapis.com")).length, 1);
    assert.equal(urls.filter((url) => url.includes("api.telnyx.com")).length, 2);
  } finally {
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("generation falls through rejected Gemini and Telnyx accounts to Groq", async () => {
  const previous = Object.fromEntries(["GEMINI_API_KEY", "TELNYX_API_KEY", "GROQ_API_KEY", "GROQ_MODEL"]
    .map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = "synthetic-gemini-three-provider";
  process.env.TELNYX_API_KEY = "synthetic-telnyx-three-provider";
  process.env.GROQ_API_KEY = "synthetic-groq-three-provider";
  process.env.GROQ_MODEL = "gsk_synthetic_not_a_model_123456789";
  const calls: string[] = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("api.groq.com")) {
      const request = JSON.parse(String(init?.body)) as { model: string; reasoning_format?: string };
      assert.equal(request.model, "qwen/qwen3.8-27b");
      assert.equal(request.reasoning_format, "hidden");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Working Groq fallback" } }] });
    }
    return Response.json({ error: { message: "Synthetic provider rejection" } }, { status: 403 });
  }) as typeof fetch;
  try {
    const result = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { retryDelayMs: 0 });
    assert.equal(result.providerId, "groq");
    assert.equal(result.text, "Working Groq fallback");
    assert.deepEqual(result.failureCategories, ["authentication", "authentication"]);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a rate-limited provider remains retryable during cooldown, while invalid credentials do not", async () => {
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  try {
    for (const [status, expectedRetryable] of [[429, true], [401, false]] as const) {
      process.env.TELNYX_API_KEY = `synthetic-telnyx-cooldown-${status}`;
      global.fetch = (async () => Response.json({ error: { message: "Synthetic provider failure" } }, { status })) as typeof fetch;
      await assert.rejects(
        multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { onlyProviderId: "telnyx-glm", retryDelayMs: 0 }),
      );
      await assert.rejects(
        multiModelRouter.complete([{ role: "user", content: "Build again" }], undefined, { onlyProviderId: "telnyx-glm", retryDelayMs: 0 }),
        (error: unknown) => Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === expectedRetryable)
      );
    }
  } finally {
    global.fetch = previousFetch;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("a rate-limited continuation waits for the provider reset and keeps generated text", async () => {
  const previousGroq = process.env.GROQ_API_KEY;
  const previousFetch = global.fetch;
  process.env.GROQ_API_KEY = "synthetic-groq-reset";
  let requests = 0;
  let rateLimitedAt = 0;
  global.fetch = (async () => {
    requests += 1;
    if (requests === 1) return Response.json({ choices: [{ finish_reason: "length", message: { content: "### File: src/App.tsx\n```tsx\nexport default function App() {" } }] });
    if (requests === 2) {
      rateLimitedAt = Date.now();
      return Response.json({ error: { message: "Synthetic token limit" } }, {
        status: 429, headers: { "x-ratelimit-reset-tokens": "0.04s" },
      });
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: " return <main>Ready</main>; }\n```" } }] });
  }) as typeof fetch;
  try {
    const result = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, {
      onlyProviderId: "groq", requestLabel: "code_generation", retryDelayMs: 0, totalTimeoutMs: 5_000,
    });
    assert.equal(requests, 3);
    assert.ok(Date.now() - rateLimitedAt >= 40);
    assert.match(result.text, /<main>Ready<\/main>/);
    assert.ok(result.failureCategories.includes("rate_limit"));
  } finally {
    global.fetch = previousFetch;
    if (previousGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroq;
  }
});

test("reasoning-only length response retries from the original request", async () => {
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousFetch = global.fetch;
  let attempts = 0;
  delete process.env.GEMINI_API_KEY;
  process.env.TELNYX_API_KEY = "synthetic-reasoning-retry";
  global.fetch = (async () => {
    attempts += 1;
    return Response.json(attempts === 1
      ? { choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "thinking" } }] }
      : { choices: [{ finish_reason: "stop", message: { content: "A complete application" } }] });
  }) as typeof fetch;
  try {
    const result = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, {
      onlyProviderId: "telnyx-glm", retryDelayMs: 0,
    });
    assert.equal(result.text, "A complete application");
    assert.equal(attempts, 2);
    assert.ok(result.failureCategories.includes("output_limit"));
  } finally {
    global.fetch = previousFetch;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
  }
});

test("provider error bodies cannot expose configured credentials in errors or logs", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const secret = "synthetic-provider-secret-123456789";
  const output: string[] = [];
  process.env.GEMINI_API_KEY = secret;
  delete process.env.TELNYX_API_KEY;
  global.fetch = (async () => Response.json({ error: { message: `Invalid credential ${secret}` } }, { status: 401 })) as typeof fetch;
  console.log = console.warn = console.error = (...args: unknown[]) => { output.push(args.join(" ")); };
  try {
    await assert.rejects(
      multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { retryDelayMs: 0 }),
      (error: unknown) => error instanceof Error && !error.message.includes(secret)
    );
    assert.equal(output.join("\n").includes(secret), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("long code output continues with bounded context and survives a continuation timeout", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  delete process.env.GEMINI_API_KEY;
  process.env.TELNYX_API_KEY = "synthetic-telnyx-continuation";
  const requestSizes: number[] = [];
  let calls = 0;
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    requestSizes.push(String(init?.body || "").length);
    if (calls === 1) return Response.json({ choices: [{ finish_reason: "length", message: { content: "<section>partial-" } }] });
    if (calls === 2) throw new DOMException("Synthetic timeout", "TimeoutError");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "completed</section>" } }] });
  }) as typeof fetch;
  try {
    const result = await multiModelRouter.complete([
      { role: "system", content: "Long design instructions ".repeat(4_000) },
      { role: "user", content: "Build a full-stack store" },
    ], undefined, { requestLabel: "code_generation", retryDelayMs: 0,
      perProviderTimeoutMs: 2_000, totalTimeoutMs: 8_000 });
    assert.equal(result.text, "<section>partial-completed</section>");
    assert.equal(calls, 3);
    assert.ok(requestSizes[1] < requestSizes[0] / 2);
    assert.ok(requestSizes[2] < requestSizes[0] / 2);
  } finally {
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("multimodal code continuation retains text requirements without repeating image data", async () => {
  const previousGroq = process.env.GROQ_API_KEY;
  const previousFetch = global.fetch;
  process.env.GROQ_API_KEY = "synthetic-groq-multimodal-continuation";
  const bodies: Array<{ messages: Array<{ content: unknown }> }> = [];
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ finish_reason: bodies.length === 1 ? "length" : "stop", message: { content: bodies.length === 1 ? "### File: src/App.tsx\n```tsx\n" : "export default function App() { return <main>Ready</main>; }\n```" } }] });
  }) as typeof fetch;
  try {
    const result = await multiModelRouter.complete([{ role: "user", content: [
      { type: "text", text: "Build a booking app with real forms" },
      { type: "image_url", image_url: { url: "data:image/png;base64,SYNTHETIC_IMAGE_DATA" } },
    ] }], undefined, { onlyProviderId: "groq", requestLabel: "code_generation", retryDelayMs: 0 });
    assert.equal(bodies.length, 2);
    const continuation = JSON.stringify(bodies[1]);
    assert.match(continuation, /Build a booking app with real forms/);
    assert.doesNotMatch(continuation, /SYNTHETIC_IMAGE_DATA/);
    assert.match(result.text, /export default function App/);
  } finally {
    global.fetch = previousFetch;
    if (previousGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroq;
  }
});

test("connector status requires a signed session and never returns credential values", async () => {
  const anonymous = getConnectorStatus(new NextRequest("http://localhost/api/connectors/status"));
  assert.equal(anonymous.status, 401);
  const request = new NextRequest("http://localhost/api/connectors/status", {
    headers: { cookie: `${AUTH_COOKIE}=${createAuthSession("synthetic-user")}` },
  });
  const response = getConnectorStatus(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload.data).sort(), ["firecrawl", "pexels", "supabase"]);
  assert.ok(Object.values(payload.data).every((value) => typeof value === "boolean"));
  const serialized = JSON.stringify(payload);
  for (const credential of [process.env.FIRECRAWL_API_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]) {
    if (credential) assert.equal(serialized.includes(credential), false);
  }
});

test("generated build processes receive no private provider credentials", () => {
  const environment = generatedProcessEnvironment("production");
  assert.equal(environment.NODE_ENV, "production");
  for (const name of ["HOME", "USERPROFILE", "E2B_API_KEY", "FIRECRAWL_API_KEY", "GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TENANT_COOKIE_SECRET"]) {
    assert.equal(environment[name], undefined);
  }
  const issues = generationValidationIssues([
    { path: "package.json", content: '{"scripts":{"postinstall":"echo unsafe"}}' },
    { path: "vite.config.ts", content: 'export default {}' },
  ], [], { requireEntrypoint: false });
  assert.ok(issues.some((issue) => issue.includes("package.json") && issue.includes("runtime-owned")));
  assert.ok(issues.some((issue) => issue.includes("vite.config.ts") && issue.includes("runtime-owned")));
});

test("requested commerce cannot silently omit auth or grant owner controls to every visitor", () => {
  assert.deepEqual(requestedSharedCatalogCollections("Build a community events app with registrations"), ["events"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build an LMS marketplace with courses and instructors"), ["courses"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build a learning dashboard for students"), []);
  assert.deepEqual(requestedSharedCatalogCollections("Build an online learning platform with student enrollment"), ["courses"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build appointment booking with services and availability"), ["services"]);
  assert.deepEqual(requestedSharedCatalogCollections("Build a private meeting calendar"), []);
  assert.equal(promptRequestsCommerce("Build a production Fashion Store with products, inventory, cart and orders"), true);
  assert.equal(promptRequestsCommerce("Build a marketplace analytics dashboard"), false);
  assert.equal(promptRequestsCommerce("Build a SaaS marketplace for vendors and subscriptions"), true);
  assert.equal(promptRequestsCommerce("Build an online store without requiring accounts"), true);
  assert.equal(promptRequestsCommerce("Build a project SaaS. Never store passwords in the browser. Do not invent products, stock, or orders."), false);
  assert.equal(generationValidationIssues([{ path: "src/App.tsx", content: 'import { Button } from "@/components/ui"; export default function App() { return <Button>Continue</Button>; }' }], [], { requireEntrypoint: true })
    .some((issue) => issue.includes("imports missing local module @/components/ui")), false);
  const files = [{ path: "src/hooks/use-store-data.ts", content: 'import db from "@/lib/db"; const isOwner = true; const products = db.collection("products");' }];
  const issues = generationValidationIssues(files, [], {
    requireEntrypoint: false,
    requireAuthentication: true,
    requireCommerceRole: true,
    requirePersistence: true,
  });
  assert.ok(issues.some((issue) => issue.includes("requested authentication has no real identity client")));
  assert.ok(issues.some((issue) => issue.includes("commerce owner controls have no server-verified role")));
  assert.ok(issues.some((issue) => issue.includes("commerce cart has no durable carts collection")));
  assert.ok(issues.some((issue) => issue.includes("hardcodes the owner role")));
  for (const initializer of ["useState(true)", "React.useState<boolean>(true)"]) {
    const stateIssues = generationValidationIssues([
      { path: "src/hooks/use-owner.ts", content: `const [isOwner, setIsOwner] = ${initializer};` },
    ], [], { requireEntrypoint: false, requireCommerceRole: true });
    assert.ok(stateIssues.some((issue) => issue.includes("hardcodes the owner role")), initializer);
  }
  const repaired = generationValidationIssues([{ path: "src/hooks/use-store-data.ts", content: 'import { auth } from "@/lib/auth"; import db from "@/lib/db"; async function load() { const session = await auth.getSession(); const role = await auth.getCommerceRole(); return { session, role, records: await db.collection("products").list(), cart: await db.collection("carts").list() }; }' }], [], {
    requireEntrypoint: false,
    requireAuthentication: true,
    requireCommerceRole: true,
    requirePersistence: true,
  });
  assert.equal(repaired.some((issue) => /authentication|commerce owner|hardcodes the owner/.test(issue)), false);
  const projectRole = generationValidationIssues([{ path: "src/hooks/use-store-data.ts", content: 'import { auth } from "@/lib/auth"; import db from "@/lib/db"; async function load() { const role = await auth.getProjectRole(); return { role, cart: await db.collection("carts").list() }; }' }], [], {
    requireEntrypoint: false,
    requireCommerceRole: true,
  });
  assert.equal(projectRole.some((issue) => issue.includes("commerce owner controls")), false);
});

test("generated code cannot replace the tested dialog primitive with a broken inline version", () => {
  const issues = generationValidationIssues([{ path: "src/components/ui/dialog.tsx", content: "export function Dialog({ children }: any) { return children; }" }], [], { requireEntrypoint: false });
  assert.ok(issues.some((issue) => issue.includes("runtime-owned file must not be generated")));
  assert.ok(generationValidationIssues([{ path: "src/lib/utils.ts", content: "export const cn = (...classes: string[]) => classes.join(' ');" }], [], { requireEntrypoint: false })
    .some((issue) => issue.includes("runtime-owned file must not be generated")));
  assert.equal(generationValidationIssues([{ path: "src/components/store/auth-dialog.tsx", content: "export function AuthDialog() { return null; }" }], [], { requireEntrypoint: false })
    .some((issue) => issue.includes("runtime-owned file")), false);
});
