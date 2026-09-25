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
import { compactRepairContext, completeSemanticCss, fixCssImportOrder, generationContentForCompactProvider, hasRealGeneratedSource, isWorkspaceSourcePath, postProcessGeneratedFiles, promptRequestsAuthentication, promptRequestsCommerce, promptRequestsPersistence, promptRequestsPrivateFiles, recoverableGeneratedPartialText, repairContextIncludesAffectedFiles, requestedSharedCatalogCollections, workspaceRepairContext } from "../src/lib/local-orchestrator/agent-engine";
import { localProjectStore } from "../src/lib/local-orchestrator/project-store";
import { localFileManager } from "../src/lib/local-orchestrator/file-manager";
import { multiModelRouter, ProviderExhaustedError } from "../src/lib/local-orchestrator/multi-model-router";
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
    const button = fs.readFileSync(path.join(workspace, "src/components/ui/button.tsx"), "utf8");
    assert.match(button, /export function buttonVariants/);
    assert.match(button, /buttonVariants\(\{ variant, size, className \}\)/);
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

test("repair source inventory excludes dependencies, generated output, and configuration", () => {
  assert.equal(isWorkspaceSourcePath("src/App.tsx"), true);
  assert.equal(isWorkspaceSourcePath("src/components/dashboard.tsx"), true);
  assert.equal(isWorkspaceSourcePath("src/data/catalog.json"), true);
  assert.equal(isWorkspaceSourcePath("app/page.tsx"), true);
  assert.equal(isWorkspaceSourcePath("pages/index.tsx"), true);
  assert.equal(isWorkspaceSourcePath("theme.css"), true);
  assert.equal(isWorkspaceSourcePath("custom-view.tsx"), true);
  for (const path of [".env.example", "package-lock.json", "vite.config.ts", "dist/assets/app.js", "build/app.js", "node_modules/lib/index.ts", "src/.vite/cache.ts", "src/coverage/report.json"]) {
    assert.equal(isWorkspaceSourcePath(path), false, path);
  }
});

test("compact follow-up keeps complete relevant source without repeating the design manual", () => {
  const source = "export default function App() { return <main>Working application</main>; }";
  const compact = `### File: src/App.tsx\n\`\`\`tsx\n${source}\n\`\`\`\n\nUser Request: Add search`;
  const base = "Build a working appointment app";
  const full = "[BIGBAG MASTER DESIGN SYSTEM]".repeat(1000) + base;
  assert.equal(generationContentForCompactProvider(base, compact), compact);
  assert.match(generationContentForCompactProvider(base, compact), /Working application/);
  assert.equal(generationContentForCompactProvider(base, null), base);
  assert.ok(generationContentForCompactProvider(base, null).length < full.length / 10);
});

test("an interrupted model response can keep only complete files for normal validation", () => {
  const complete = '### File: src/App.tsx\n```tsx\nexport default function App() { return <main>Ready</main>; }\n```';
  const interrupted = new ProviderExhaustedError("rate_limit", true, `${complete}\n### File: src/extra.ts\n\`\`\`ts\nexport const`, "length", 2);
  assert.equal(recoverableGeneratedPartialText(interrupted), complete);
  assert.equal(recoverableGeneratedPartialText(new ProviderExhaustedError("rate_limit", true, '### File: src/App.tsx\n```tsx\nexport default', "length", 2)), null);
  assert.equal(recoverableGeneratedPartialText(new ProviderExhaustedError("authentication", false, complete, "", 1)), null);
});

test("generated landing-page calls to action cannot point to an inert hash", () => {
  const inert = generationValidationIssues([{
    path: "src/App.tsx",
    content: 'export default function App() { return <main><a href="#">Start Free Trial</a></main>; }',
  }]);
  assert.ok(inert.some((issue) => issue.includes('link to "#" with no click action')));
  const real = generationValidationIssues([{
    path: "src/App.tsx",
    content: 'export default function App() { return <main><a href="/signup">Start Free Trial</a></main>; }',
  }]);
  assert.equal(real.some((issue) => issue.includes('link to "#" with no click action')), false);
});

test("a dashboard cannot hide broken navigation, nested landmarks, or an unnamed filter", () => {
  const issues = generationValidationIssues([{ path: "src/App.tsx", content: `
    import { DashboardShell } from "@/components/layout";
    import { SelectTrigger } from "@/components/ui/select";
    export default function App() {
      const navItems = [{ label: "Properties", href: "#" }];
      return <DashboardShell navItems={navItems}><main><SelectTrigger /></main></DashboardShell>;
    }
  ` }], [], { requireEntrypointFirst: true });
  assert.ok(issues.some((issue) => issue.includes('inert navigation destination href: "#"')));
  assert.ok(issues.some((issue) => issue.includes("nests <main> inside a layout shell")));
  assert.ok(issues.some((issue) => issue.includes("SelectTrigger without an accessible name")));
  assert.ok(generationValidationIssues([{ path: "src/App.tsx", content: 'export default function App(){ return <main><SelectTrigger id="filter" /></main>; }' }])
    .some((issue) => issue.includes("SelectTrigger without an accessible name")));
  assert.equal(generationValidationIssues([{ path: "src/App.tsx", content: 'export default function App(){ return <main><label htmlFor="filter">Filter</label><SelectTrigger id="filter" /></main>; }' }])
    .some((issue) => issue.includes("SelectTrigger without an accessible name")), false);
  const corrected = generationValidationIssues([{ path: "src/App.tsx", content: `
    import { DashboardShell } from "@/components/layout";
    import { SelectTrigger } from "@/components/ui/select";
    export default function App() {
      const navItems = [{ label: "Properties", href: "/properties" }];
      return <DashboardShell navItems={navItems}><section><SelectTrigger aria-label="Filter properties" /></section></DashboardShell>;
    }
  ` }], [], { requireEntrypointFirst: true });
  assert.equal(corrected.some((issue) => /inert navigation|nests <main>|SelectTrigger without/.test(issue)), false);
});

test("requested authentication must offer a real account entry and exit", () => {
  const sessionOnly = generationValidationIssues([{ path: "src/App.tsx", content: `
    import { auth } from "@/lib/auth";
    export default function App() { void auth.getSession(); return <main>Dashboard</main>; }
  ` }], [], { requireAuthentication: true });
  assert.ok(sessionOnly.some((issue) => issue.includes("no usable sign-in or sign-up action")));
  assert.ok(sessionOnly.some((issue) => issue.includes("no sign-out action")));
  const complete = generationValidationIssues([{ path: "src/App.tsx", content: `
    import { auth } from "@/lib/auth";
    export default function App() { return <main>
      <button onClick={() => auth.signIn("person@example.test", "test")}>Sign in</button>
      <button onClick={() => auth.signOut()}>Sign out</button>
    </main>; }
  ` }], [], { requireAuthentication: true });
  assert.equal(complete.some((issue) => /no usable sign-in|no sign-out action/.test(issue)), false);
});

test("generated account flows use accessible forms instead of browser prompts", () => {
  const issues = generationValidationIssues([{ path: "src/App.tsx", content: `
export default function App() { const signIn = () => { const email = window.prompt("Enter email"); return email; }; return <main><button onClick={signIn}>Sign in</button></main>; }` }]);
  assert.ok(issues.some((issue) => issue.includes("blocking browser prompt")));
});

test("starter semantic colors keep body copy and primary actions above AA contrast", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-contrast-"));
  try {
    writeStarterTemplate(workspace, "contrast-check");
    const css = fs.readFileSync(path.join(workspace, "src/app/globals.css"), "utf8");
    const root = css.match(/:root\s*\{([^}]+)\}/)?.[1] || "";
    const color = (name: string): number[] => {
      const match = root.match(new RegExp(`--${name}:\\s*hsl\\((\\d+)\\s+(\\d+)%\\s+(\\d+)%\\)`));
      assert.ok(match, `missing ${name}`);
      const h = Number(match[1]) / 360; const s = Number(match[2]) / 100; const l = Number(match[3]) / 100;
      if (!s) return [l, l, l];
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      return [h + 1 / 3, h, h - 1 / 3].map((part) => {
        let t = part;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      });
    };
    const luminance = (rgb: number[]) => rgb.map((channel) => channel <= 0.04045
      ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (left: number[], right: number[]) => {
      const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const primary = color("primary");
    const background = color("background");
    const hover = primary.map((channel, index) => channel * 0.9 + background[index] * 0.1);
    assert.ok(contrast(color("primary-foreground"), primary) >= 4.5);
    assert.ok(contrast(color("primary-foreground"), hover) >= 4.5);
    assert.ok(contrast(color("muted-foreground"), background) >= 4.5);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("initial generated pages need a semantic main landmark or supplied layout shell", () => {
  const missing = generationValidationIssues([{
    path: "src/App.tsx", content: 'export default function App() { return <div>Content</div>; }',
  }], [], { requireEntrypointFirst: true });
  assert.ok(missing.some((issue) => issue.includes("no main landmark")));
  const nested = generationValidationIssues([
    { path: "src/App.tsx", content: 'import { Page } from "./Page"; export default function App() { return <Page />; }' },
    { path: "src/Page.tsx", content: 'export function Page() { return <main>Content</main>; }' },
  ], [], { requireEntrypointFirst: true });
  assert.equal(nested.some((issue) => issue.includes("no main landmark")), false);
  const storefront = generationValidationIssues([{
    path: "src/App.tsx", content: 'import { StorefrontShell } from "@/components/layout"; export default function App() { return <StorefrontShell>Catalog</StorefrontShell>; }',
  }], [], { requireEntrypointFirst: true });
  assert.ok(storefront.some((issue) => issue.includes("no main landmark")));
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

test("managed auth and list contract mistakes are rejected before preview", () => {
  const issues = generationValidationIssues([{ path: "src/App.tsx", content: `import auth from "@/lib/auth";
import db from "@/lib/db";
async function load() { await auth.signInWithProvider("google"); return db.collection("items").list({ filter: { title: "a" } }); }
export default function App() { return <main>Ready</main>; }` }], [], { requireEntrypoint: true });
  assert.ok(issues.some((issue) => issue.includes("default auth client")));
  assert.ok(issues.some((issue) => issue.includes("unsupported auth.signInWithProvider")));
  assert.ok(issues.some((issue) => issue.includes("unsupported filter")));
  const optionsIssues = generationValidationIssues([{ path: "src/App.tsx", content: `import db from "@/lib/db";
async function load() { return db.collection("appointments").list({ limit: 20, where: { ownerId: "a" }, orderBy: "start" }); }
export default function App() { return <main>Ready</main>; }` }]);
  assert.ok(optionsIssues.some((issue) => issue.includes("unsupported where, orderBy option(s)")));
  const aliasIssues = generationValidationIssues([{ path: "src/App.tsx", content: `import db from "@/lib/db";
const appointments = db.collection("appointments"); const saved = appointments;
async function load() { await saved.list({ where: { ownerId: "a" } }); return calendar.list({ where: "today" }); }
export default function App() { return <main>Ready</main>; }` }]);
  assert.ok(aliasIssues.some((issue) => issue.includes("unsupported where option(s)")));
  const unrelatedList = generationValidationIssues([{ path: "src/App.tsx", content: `import db from "@/lib/db";
const appointments = db.collection("appointments");
async function load() { await appointments.list({ limit: 20 }); return calendar.list({ where: "today" }); }
export default function App() { return <main>Ready</main>; }` }]);
  assert.equal(unrelatedList.some((issue) => issue.includes("unsupported where option(s)")), false);
  const callbackIssues = generationValidationIssues([{ path: "src/App.tsx", content: `import { auth } from "@/lib/auth";
auth.onAuthStateChange((value) => setSession(value.session));
export default function App() { return <main>Ready</main>; }` }]);
  assert.ok(callbackIssues.some((issue) => issue.includes("one-argument auth.onAuthStateChange callback")));
});

test("generated UI imports must use exported primitives rather than invented namespace members", () => {
  const issues = generationValidationIssues([{ path: "src/App.tsx", content: `import * as Button from "@/components/ui/button";
export default function App() { return <main><Button.Primary>Save</Button.Primary></main>; }` }]);
  assert.ok(issues.some((issue) => issue.includes("as a UI namespace")));
  const named = generationValidationIssues([{ path: "src/App.tsx", content: `import { Button } from "@/components/ui/button";
export default function App() { return <main><Button variant="primary">Save</Button></main>; }` }]);
  assert.equal(named.some((issue) => issue.includes("as a UI namespace")), false);
});

test("compact repair includes a complete medium-sized failing file", () => {
  const file = { path: "src/App.tsx", content: "const value = 1;\n".repeat(900) + "export default function App() { return <main>Ready</main>; }" };
  const context = compactRepairContext([file], ["src/App.tsx(1,1): example compiler error"]);
  assert.equal(repairContextIncludesAffectedFiles([file], ["src/App.tsx(1,1): example compiler error"], context), true);
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

test("GLM repair context retains a complete large failing source file", () => {
  const source = "const item = 1;\n".repeat(5_000) + "export default function App() { return <main>Ready</main>; }";
  const issues = ["syntax error in src/App.tsx: Declaration or statement expected"];
  const context = validationRepairContext([{ path: "src/App.tsx", content: source }], issues, 200_000);
  assert.ok(context.includes(source));
  assert.equal(repairContextIncludesAffectedFiles([{ path: "src/App.tsx", content: source }], issues, context), true);
  const projectId = `large-context-${randomUUID().slice(0, 8)}`;
  localProjectStore.create({ projectId, tenantId: `tenant-${projectId}`, description: "Large repair source" });
  try {
    localFileManager.writeContent(projectId, "src/App.tsx", source, "utf8");
    const buildContext = workspaceRepairContext(projectId, "src/App.tsx(1,1): syntax error");
    assert.match(buildContext, /^### File: src\/App\.tsx/m);
    assert.ok(buildContext.includes(source));
  } finally {
    localProjectStore.remove(projectId);
  }
});

test("router skips a provider when complete repair source cannot fit", async () => {
  const previousAbove = process.env.ABOVE_API_KEY;
  const previousFetch = global.fetch;
  process.env.ABOVE_API_KEY = "synthetic-above-context-skip";
  let requests = 0;
  global.fetch = (async () => { requests += 1; throw new Error("Provider should not be called"); }) as typeof fetch;
  try {
    await assert.rejects(multiModelRouter.complete([{ role: "user", content: "Repair" }], undefined, {
      onlyProviderId: "above-glm53", providerMessageTransform: () => null,
    }), (error: unknown) => Boolean(error && typeof error === "object" && "category" in error && error.category === "context_limit"));
    assert.equal(requests, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousAbove === undefined) delete process.env.ABOVE_API_KEY;
    else process.env.ABOVE_API_KEY = previousAbove;
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

test("generated raw-hex utility colors become working CSS tokens without changing the palette", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-color-token-check-"));
  try {
    writeStarterTemplate(workspace, "color-token-check");
    const cssPath = "src/app/globals.css";
    const files = [{ path: "src/App.tsx", content: 'export default function App() { return <main className="bg-[#ABC] text-[#ffffff]">Styled</main>; }' }];
    const existingCss = fs.readFileSync(path.join(workspace, cssPath), "utf8");
    postProcessGeneratedFiles(files, [{ path: cssPath, content: existingCss }]);
    const app = files.find((file) => file.path === "src/App.tsx")!;
    const css = files.find((file) => file.path === cssPath)!;
    assert.match(app.content, /bg-\[var\(--bb-generated-abc\)\]/);
    assert.match(app.content, /text-\[var\(--bb-generated-ffffff\)\]/);
    assert.match(css.content, /--bb-generated-abc: #abc;/);
    assert.match(css.content, /--bb-generated-ffffff: #ffffff;/);
    assert.equal(generationValidationIssues(files, [], { requireEntrypoint: false }).some((issue) => issue.includes("raw hex color")), false);
    for (const file of files) fs.writeFileSync(path.join(workspace, file.path), file.content);
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    const build = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/vite/bin/vite.js"), "build"], {
      cwd: workspace, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const builtCss = fs.readdirSync(path.join(workspace, "dist/assets")).filter((name) => name.endsWith(".css"))
      .map((name) => fs.readFileSync(path.join(workspace, "dist/assets", name), "utf8")).join("\n");
    assert.match(builtCss, /--bb-generated-abc:\s*#abc/);
    assert.match(builtCss, /--bb-generated-ffffff:\s*#(?:fff|ffffff)/);
    assert.match(builtCss, /background-color:var\(--bb-generated-abc\)/);
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

test("dashboard navigation accepts a generated name field without losing its accessible label", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-nav-name-check-"));
  try {
    writeStarterTemplate(workspace, "nav-name-check");
    const shell = fs.readFileSync(path.join(workspace, "src/components/layout/dashboard-shell.tsx"), "utf8");
    assert.match(shell, /item\.label \?\? item\.name/);
    fs.writeFileSync(path.join(workspace, "src/App.tsx"), `
      import { DashboardShell } from "@/components/layout";
      export default function App() {
        return <DashboardShell navItems={[{ name: "Overview", href: "/" }]}>
          <main><h1>Overview</h1></main>
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

test("marketing shell accepts a page title and only renders connected account actions", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-marketing-shell-check-"));
  try {
    writeStarterTemplate(workspace, "marketing-shell-check");
    const shell = fs.readFileSync(path.join(workspace, "src/components/layout/marketing-shell.tsx"), "utf8");
    assert.match(shell, /\(signInHref \|\| onSignInClick\) && <Button/);
    assert.match(shell, /\(ctaHref \|\| onCtaClick\) && <Button/);
    fs.writeFileSync(path.join(workspace, "src/App.tsx"), `
      import { MarketingShell } from "@/components/layout";
      export default function App() {
        return <MarketingShell brand="Example" pageTitle="Example app" ctaHref="/signup">
          <h1>Build your project</h1>
        </MarketingShell>;
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

async function withSyntheticGlm53<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.ABOVE_API_KEY;
  const previousFetch = global.fetch;
  process.env.ABOVE_API_KEY = key;
  try { return await run(); }
  finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.ABOVE_API_KEY;
    else process.env.ABOVE_API_KEY = previous;
  }
}

test("generation uses only the configured GLM 5.3 Flash model even with legacy AI keys", async () => {
  await withSyntheticGlm53("synthetic-above-only-model", async () => {
    const keys = ["GEMINI_API_KEY", "TELNYX_API_KEY", "GLM_API_KEY", "GROQ_API_KEY"] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) process.env[key] = `synthetic-${key}`;
    const calls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, "glm-5.3-flash-modal");
      assert.equal(payload.max_tokens, 8_192);
      assert.equal(payload.reasoning_effort, "low");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Working GLM source" } }] });
    }) as typeof fetch;
    try {
      assert.deepEqual(multiModelRouter.getProviders().map((provider) => provider.id), ["above-glm53"]);
      const result = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { requestLabel: "code_generation" });
      assert.equal(result.providerId, "above-glm53");
      assert.equal(result.text, "Working GLM source");
      assert.deepEqual(calls, ["https://api.above.dev/v1/chat/completions"]);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
});

test("an invalid GLM credential enters cooldown without switching models", async () => {
  await withSyntheticGlm53("synthetic-above-auth-cooldown", async () => {
    let calls = 0;
    global.fetch = (async () => { calls++; return Response.json({ error: { message: "invalid credential" } }, { status: 401 }); }) as typeof fetch;
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { retryDelayMs: 0 }),
        (error: Error & { category?: string }) => error.name === "ProviderExhaustedError" && error.category === "authentication");
    }
    assert.equal(calls, 1);
  });
});

test("a GLM rate limit remains retryable during cooldown", async () => {
  await withSyntheticGlm53("synthetic-above-rate-limit", async () => {
    let calls = 0;
    global.fetch = (async () => { calls++; return Response.json({ error: { message: "quota reset" } }, { status: 429, headers: { "retry-after": "90" } }); }) as typeof fetch;
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { retryDelayMs: 0 }),
        (error: Error & { category?: string; retryable?: boolean }) => error.name === "ProviderExhaustedError" && error.category === "rate_limit" && error.retryable === true);
    }
    assert.equal(calls, 1);
  });
});

test("a transient GLM transport failure does not block the next generation", async () => {
  await withSyntheticGlm53("synthetic-above-transient-timeout", async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls += 1;
      if (calls <= 3) throw new DOMException("Synthetic timeout", "TimeoutError");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Recovered source" } }] });
    }) as typeof fetch;
    await assert.rejects(multiModelRouter.complete([{ role: "user", content: "First build" }], undefined, { retryDelayMs: 0 }),
      (error: Error & { category?: string }) => error.name === "ProviderExhaustedError" && error.category === "network_timeout");
    const result = await multiModelRouter.complete([{ role: "user", content: "Second build" }], undefined, { retryDelayMs: 0 });
    assert.equal(result.text, "Recovered source");
    assert.equal(calls, 4);
  });
});

test("token-limited GLM output continues in compact context", async () => {
  await withSyntheticGlm53("synthetic-above-continuation", async () => {
    const bodies: Array<{ messages: Array<{ content: unknown }> }> = [];
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ finish_reason: bodies.length === 1 ? "length" : "stop", message: {
        content: bodies.length === 1 ? "### File: src/App.tsx\n```tsx\n" : "export default function App() { return <main>Ready</main>; }\n```",
      } }] });
    }) as typeof fetch;
    const result = await multiModelRouter.complete([{ role: "user", content: [
      { type: "text", text: "Build a booking app with real forms" },
      { type: "image_url", image_url: { url: "data:image/png;base64,SYNTHETIC_IMAGE_DATA" } },
    ] }], undefined, { requestLabel: "code_generation", retryDelayMs: 0 });
    assert.equal(bodies.length, 2);
    const continuation = JSON.stringify(bodies[1]);
    assert.match(continuation, /Build a booking app with real forms/);
    assert.doesNotMatch(continuation, /SYNTHETIC_IMAGE_DATA/);
    assert.match(result.text, /export default function App/);
  });
});

test("GLM provider errors cannot expose configured credentials", async () => {
  const secret = "synthetic-above-secret-123456789";
  await withSyntheticGlm53(secret, async () => {
    global.fetch = (async () => Response.json({ error: { message: `Invalid key ${secret}` } }, { status: 401 })) as typeof fetch;
    await assert.rejects(multiModelRouter.complete([{ role: "user", content: "Build" }], undefined, { retryDelayMs: 0 }),
      (error: Error) => error.name === "ProviderExhaustedError" && !error.message.includes(secret));
  });
});

test("streamed GLM code output waits for a terminal event before reporting success", async () => {
  await withSyntheticGlm53("synthetic-above-stream", async () => {
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(JSON.parse(String(init?.body)).stream, true);
      const events = [
        'data: {"choices":[{"delta":{"content":"### File: src/App.tsx\\n"}}]}',
        'data: {"choices":[{"delta":{"content":"```tsx\\nexport default function App() { return <main>Ready</main>; }\\n```"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join("\n\n") + "\n\n";
      return new Response(events, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    for (const requestLabel of ["code_generation", "code_repair"]) {
      const result = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined,
        { requestLabel, retryDelayMs: 0 });
      assert.match(result.text, /<main>Ready<\/main>/);
      assert.equal(result.finishReason, "stop");
    }
  });
});

test("a broken GLM stream resumes its partial files without a false success", async () => {
  await withSyntheticGlm53("synthetic-above-broken-stream", async () => {
    let requests = 0;
    global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests += 1;
      if (requests === 1) {
        let sent = false;
        return new Response(new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"### File: src/App.tsx\\n```tsx\\n"}}]}\n\n'));
            } else controller.error(new DOMException("Synthetic stream timeout", "TimeoutError"));
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      assert.match(body.messages.at(-1)?.content || "", /src\/App\.tsx/);
      return Response.json({ choices: [{ finish_reason: "stop", message: {
        content: "export default function App() { return <main>Recovered</main>; }\n```",
      } }] });
    }) as typeof fetch;
    const result = await multiModelRouter.complete([{ role: "user", content: "Build" }], undefined,
      { requestLabel: "code_generation", retryDelayMs: 0 });
    assert.equal(requests, 2);
    assert.match(result.text, /<main>Recovered<\/main>/);
    assert.deepEqual(result.failureCategories, ["network_timeout"]);
  });
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
  for (const name of ["HOME", "USERPROFILE", "E2B_API_KEY", "FIRECRAWL_API_KEY", "ABOVE_API_KEY", "GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TENANT_COOKIE_SECRET"]) {
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
  const repaired = generationValidationIssues([{ path: "src/hooks/use-store-data.ts", content: 'import { auth } from "@/lib/auth"; import db from "@/lib/db"; async function load() { const session = await auth.getSession(); const role = await auth.getCommerceRole(); return { session, role, records: await db.collection("products").list(), cart: await db.collection("carts").list() }; } async function signIn(email: string, password: string) { await auth.signIn(email, password); } async function signOut() { await auth.signOut(); }' }], [], {
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
