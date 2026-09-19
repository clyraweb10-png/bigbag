import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-lifecycle-"));
process.env.TURSO_DATABASE_URL = `file:${path.join(tempRoot, "projects.db")}`;
process.env.NEXT_PUBLIC_APP_URL = "https://builder.example.test";
const testDatabase = createClient({ url: process.env.TURSO_DATABASE_URL });

const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { persistentPreviewUrl } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");
const { extractWebsiteUrl } = require("../src/lib/local-orchestrator/firecrawl-design") as typeof import("../src/lib/local-orchestrator/firecrawl-design");
const {
  createPreviewWriteCapability,
  isPreviewInitiatedRequest,
  verifyPreviewWriteCapability,
} = require("../src/lib/local-orchestrator/tenant-context") as typeof import("../src/lib/local-orchestrator/tenant-context");
const { multiModelRouter } = require("../src/lib/local-orchestrator/multi-model-router") as typeof import("../src/lib/local-orchestrator/multi-model-router");
const { GEMINI_MAX_RETRIES } = require("../src/lib/local-orchestrator/multi-model-router") as typeof import("../src/lib/local-orchestrator/multi-model-router");
const {
  GENERATED_DB_CLIENT_SOURCE,
  LEGACY_GENERATED_DB_CLIENT_SOURCE,
  writeStarterTemplate,
} = require("../src/lib/local-orchestrator/starter-template") as typeof import("../src/lib/local-orchestrator/starter-template");
const { proxy } = require("../src/proxy") as typeof import("../src/proxy");
const { NextRequest } = require("next/server") as typeof import("next/server");
type LocalProjectRecord = import("../src/lib/local-orchestrator/types").LocalProjectRecord;

function record(tenantId: string, projectId = "durable-demo"): LocalProjectRecord {
  const now = new Date().toISOString();
  return {
    projectId,
    tenantId,
    label: "Durable demo",
    description: "Lifecycle test",
    createdAt: now,
    lastModifiedAt: now,
    port: 3001,
    status: "done",
    serverStatus: "Active",
    conversation: [],
  };
}

test("source and deployment survive sandbox loss while the preview URL stays stable", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const project = record(tenantId);
  const workspace = path.join(tempRoot, "workspace");
  fs.mkdirSync(path.join(workspace, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "app", "page.tsx"), "export default () => <main>v1</main>;");
  fs.writeFileSync(path.join(workspace, "package.json"), '{"scripts":{"build":"vite build"}}');

  await durableProjectStore.saveSource(project, workspace);
  project.deployment = { status: "success", createdAt: new Date().toISOString(), versionId: "build-v1" };
  project.productionProjectUrl = persistentPreviewUrl(project.projectId);
  await durableProjectStore.saveDeployment(project, [
    { path: "index.html", content: Buffer.from("<main>deployed-v1</main>") },
    { path: "assets/app.js", content: Buffer.from("console.log('v1')") },
  ]);

  const stableUrl = persistentPreviewUrl(project.projectId);
  fs.rmSync(workspace, { recursive: true, force: true });
  const restoredCount = await durableProjectStore.restoreSource(project.projectId, tenantId, workspace);
  assert.equal(restoredCount, 2);
  assert.match(fs.readFileSync(path.join(workspace, "src", "app", "page.tsx"), "utf8"), /v1/);

  // A failed staged restore must leave the current workspace and ignored runtime
  // directories untouched. These contradictory paths force a staging write error.
  fs.mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "node_modules", "sentinel"), "keep");
  fs.symlinkSync(tempRoot, path.join(workspace, "untrusted-link"));
  fs.writeFileSync(path.join(workspace, "src", "app", "page.tsx"), "local-workspace-remains");
  await testDatabase.batch([
    {
      sql: `INSERT INTO builder_project_files
        (project_id, tenant_id, kind, path, content, updated_at) VALUES (?, ?, 'source', ?, ?, ?)`,
      args: [project.projectId, tenantId, "collision", Buffer.from("file"), new Date().toISOString()],
    },
    {
      sql: `INSERT INTO builder_project_files
        (project_id, tenant_id, kind, path, content, updated_at) VALUES (?, ?, 'source', ?, ?, ?)`,
      args: [project.projectId, tenantId, "collision/child.txt", Buffer.from("child"), new Date().toISOString()],
    },
  ], "write");
  await assert.rejects(() => durableProjectStore.restoreSource(project.projectId, tenantId, workspace));
  assert.equal(fs.readFileSync(path.join(workspace, "src", "app", "page.tsx"), "utf8"), "local-workspace-remains");
  assert.equal(fs.readFileSync(path.join(workspace, "node_modules", "sentinel"), "utf8"), "keep");
  assert.equal(fs.lstatSync(path.join(workspace, "untrusted-link")).isSymbolicLink(), true);
  await testDatabase.execute({
    sql: "DELETE FROM builder_project_files WHERE project_id = ? AND kind = 'source' AND path LIKE 'collision%'",
    args: [project.projectId],
  });
  assert.equal(await durableProjectStore.restoreSource(project.projectId, tenantId, workspace), 2);
  assert.equal(fs.readFileSync(path.join(workspace, "node_modules", "sentinel"), "utf8"), "keep");
  assert.equal(fs.existsSync(path.join(workspace, "untrusted-link")), false);

  const artifact = await durableProjectStore.readDeploymentFile(project.projectId, "index.html");
  assert.equal(Buffer.from(artifact!.content).toString("utf8"), "<main>deployed-v1</main>");

  fs.mkdirSync(path.join(workspace, "public", "uploads"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "public", "uploads", "logo.txt"), "durable-upload");
  await durableProjectStore.saveSource(project, workspace);
  const upload = await durableProjectStore.readPublicSourceFile(project.projectId, "public/uploads/logo.txt");
  assert.equal(Buffer.from(upload!.content).toString("utf8"), "durable-upload");

  // Simulate a later edit after the original E2B id is gone. The build version
  // changes, but routing remains the same project-specific Render URL.
  project.sandboxId = undefined;
  project.deployment.versionId = "build-v2";
  await durableProjectStore.saveDeployment(project, [
    { path: "index.html", content: Buffer.from("<main>deployed-v2</main>") },
  ]);
  assert.equal(persistentPreviewUrl(project.projectId), stableUrl);
  const updated = await durableProjectStore.readDeploymentFile(project.projectId, "index.html");
  assert.equal(Buffer.from(updated!.content).toString("utf8"), "<main>deployed-v2</main>");
});

test("tenant ownership prevents reads, overwrites, and deletes across users", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const attacker = "22222222-2222-4222-8222-222222222222";
  const projectId = "isolation-demo";
  const ownerRecord = record(owner, projectId);
  await durableProjectStore.saveDeployment(ownerRecord, [
    { path: "index.html", content: Buffer.from("owner deployment") },
  ]);

  assert.equal(await durableProjectStore.loadRecord(projectId, attacker), null);
  await assert.rejects(() => durableProjectStore.saveRecord(record(attacker, projectId)), /another tenant/);
  await assert.rejects(
    () => durableProjectStore.saveDeployment(record(attacker, projectId), [
      { path: "index.html", content: Buffer.from("attacker replacement") },
    ]),
    /another tenant/
  );
  const ownerDeployment = await durableProjectStore.readDeploymentFile(projectId, "index.html");
  assert.equal(Buffer.from(ownerDeployment!.content).toString("utf8"), "owner deployment");
  assert.equal(await durableProjectStore.remove(projectId, attacker), false);
  assert.ok(await durableProjectStore.loadRecord(projectId, owner));
  assert.equal(await durableProjectStore.remove(projectId, owner), true);
});

test("website URL detection is explicit and strips chat punctuation", () => {
  assert.equal(
    extractWebsiteUrl("Recreate this layout: https://example.com/products?view=grid, but use original copy."),
    "https://example.com/products?view=grid"
  );
  assert.equal(extractWebsiteUrl("Build a portfolio without a reference URL"), null);
  assert.equal(extractWebsiteUrl("use javascript:alert(1)"), null);
});

test("preview-originated browser requests cannot reach builder APIs", () => {
  const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as never;
  assert.equal(
    isPreviewInitiatedRequest(request({ referer: "https://builder.example.test/api/preview/demo/" })),
    true
  );
  assert.equal(
    isPreviewInitiatedRequest(request({ referer: "https://builder.example.test/project/demo" })),
    false
  );
  assert.equal(isPreviewInitiatedRequest(request({ origin: "null", "sec-fetch-site": "cross-site" })), true);
  assert.equal(isPreviewInitiatedRequest(request({ "sec-fetch-site": "same-origin" })), false);
  assert.equal(isPreviewInitiatedRequest(request({})), false);
});

test("proxy query parameters cannot grant preview document privileges", async () => {
  const publicPreview = await proxy(new NextRequest("https://builder.example.test/api/preview/demo/"));
  const editorPreview = await proxy(new NextRequest("https://builder.example.test/api/preview/demo/?editor=1"));
  const platform = await proxy(new NextRequest("https://builder.example.test/project/demo"));

  assert.equal(publicPreview.headers.get("content-security-policy"), null);
  assert.equal(editorPreview.headers.get("content-security-policy"), null);
  assert.equal(platform.headers.get("content-security-policy"), "frame-ancestors *");
});

test("Gemini is first and GLM-5.3-Flash is the fallback", () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.TELNYX_API_KEY = "test-telnyx";
  try {
    assert.deepEqual(multiModelRouter.getProviders().map((provider) => provider.id), [
      "gemini-flash",
      "telnyx-glm",
    ]);
    assert.equal(multiModelRouter.getProviders()[0].maxRetries, 5);
    assert.equal(GEMINI_MAX_RETRIES, 5);
  } finally {
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("generated apps use a browser-safe durable data client", async () => {
  assert.match(GENERATED_DB_CLIENT_SOURCE, /\/__bigbag\/data\//);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /X-BigBag-Capability/);
  assert.doesNotMatch(GENERATED_DB_CLIENT_SOURCE, /@libsql|node:|process\.env|process\.cwd|from ["'](?:fs|path)["']/);

  const tenantId = "11111111-1111-4111-8111-111111111111";
  const projectId = `data-${randomUUID()}`;
  const project = record(tenantId, projectId);
  try {
    await durableProjectStore.saveRecord(project);
    const created = await durableProjectStore.createAppRecord(projectId, "tasks", {
      title: "Ship a working preview",
      done: false,
    });
    assert.equal(created.title, "Ship a working preview");
    assert.equal(typeof created._id, "string");

    await Promise.all(Array.from({ length: 105 }, (_, index) =>
      durableProjectStore.createAppRecord(projectId, "tasks", { title: `Task ${index}` })
    ));
    const listed = await durableProjectStore.listAppRecords(projectId, "tasks", { limit: 100 });
    assert.equal(listed.total, 106);
    assert.equal(listed.records.length, 100);
    assert.equal((await durableProjectStore.listAllAppRecords(projectId, "tasks")).length, 106);
    assert.equal((await durableProjectStore.getAppRecord(projectId, "tasks", created._id))?._id, created._id);

    const updated = await durableProjectStore.updateAppRecord(projectId, "tasks", created._id, {
      done: true,
      _id: "cannot-overwrite-system-fields",
    });
    assert.equal(updated?.done, true);
    assert.equal(updated?._id, created._id);

    const collections = await durableProjectStore.listAppCollections(projectId);
    assert.deepEqual(collections, [{ name: "tasks", count: 106 }]);
    assert.equal(await durableProjectStore.deleteAppRecord(projectId, "tasks", created._id), true);
    assert.equal((await durableProjectStore.listAppRecords(projectId, "tasks")).total, 105);
  } finally {
    assert.equal(await durableProjectStore.remove(projectId, tenantId), true);
  }
});

test("preview write capabilities are project-scoped, signed, and expiring", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const issuedAt = 1_000_000;
  const capability = createPreviewWriteCapability("capability-demo", tenantId, issuedAt);
  assert.equal(verifyPreviewWriteCapability(capability, "capability-demo", issuedAt), tenantId);
  assert.equal(verifyPreviewWriteCapability(capability, "another-project", issuedAt), null);
  assert.equal(verifyPreviewWriteCapability(`${capability}x`, "capability-demo", issuedAt), null);
  assert.equal(
    verifyPreviewWriteCapability(capability, "capability-demo", issuedAt + 15 * 60_000 + 1_000),
    null
  );
});

test("restored workspaces preserve package mode and customized database clients", () => {
  const workspace = path.join(tempRoot, "custom-restored-workspace");
  const customDbClient = `import { createClient } from "@libsql/client";\nexport const customized = true;\n`;
  fs.mkdirSync(path.join(workspace, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
    name: "custom-restored-workspace",
    type: "commonjs",
  }));
  fs.writeFileSync(path.join(workspace, "src", "lib", "db.ts"), customDbClient);
  fs.writeFileSync(
    path.join(workspace, "vite.config.ts"),
    `import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from "vite";
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: [".e2b.app"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
`
  );

  writeStarterTemplate(workspace, "custom-restored-workspace");

  const restoredPackage = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
  assert.equal(restoredPackage.type, "commonjs");
  assert.equal(restoredPackage.dependencies["@libsql/client"], "^0.18.0");
  assert.equal(fs.readFileSync(path.join(workspace, "src", "lib", "db.ts"), "utf8"), customDbClient);
  const viteConfig = fs.readFileSync(path.join(workspace, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(viteConfig, /pathToFileURL, fileURLToPath/);
  assert.doesNotMatch(viteConfig, /\b__dirname\b/);

  const incompleteWorkspace = path.join(tempRoot, "incomplete-vite-migration");
  const incompleteViteConfig = `import path from "node:path";\nexport default { resolve: { alias: { "@": path.resolve(__dirname, "./src") } } };\n`;
  fs.mkdirSync(path.join(incompleteWorkspace, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(incompleteWorkspace, "package.json"), JSON.stringify({
    name: "incomplete-vite-migration",
  }));
  fs.writeFileSync(path.join(incompleteWorkspace, "vite.config.ts"), incompleteViteConfig);
  writeStarterTemplate(incompleteWorkspace, "incomplete-vite-migration");
  assert.equal(
    fs.readFileSync(path.join(incompleteWorkspace, "vite.config.ts"), "utf8"),
    incompleteViteConfig
  );
});

test("legacy database clients remain only for server-exclusive consumers", () => {
  const browserWorkspace = path.join(tempRoot, "legacy-db-browser-consumer");
  fs.mkdirSync(path.join(browserWorkspace, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(browserWorkspace, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(browserWorkspace, "src", "server"), { recursive: true });
  fs.writeFileSync(path.join(browserWorkspace, "package.json"), JSON.stringify({
    name: "legacy-db-browser-consumer",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(path.join(browserWorkspace, "src", "lib", "db.ts"), LEGACY_GENERATED_DB_CLIENT_SOURCE);
  fs.writeFileSync(
    path.join(browserWorkspace, "src", "server", "bridge.ts"),
    `import db from "@/lib/db";\nexport const forwardedDatabaseClient = db;\n`
  );
  fs.writeFileSync(
    path.join(browserWorkspace, "src", "app", "page.tsx"),
    `export { forwardedDatabaseClient } from "@/server/bridge";\nconst queue = { batch: () => "ok" };\nexport const unrelatedBatch = queue.batch();\n`
  );

  writeStarterTemplate(browserWorkspace, "legacy-db-browser-consumer");
  assert.equal(
    fs.readFileSync(path.join(browserWorkspace, "src", "lib", "db.ts"), "utf8"),
    GENERATED_DB_CLIENT_SOURCE
  );
  const browserPackage = JSON.parse(fs.readFileSync(path.join(browserWorkspace, "package.json"), "utf8"));
  assert.equal(browserPackage.dependencies["@libsql/client"], undefined);

  const incompatibleWorkspace = path.join(tempRoot, "legacy-db-browser-sql");
  fs.mkdirSync(path.join(incompatibleWorkspace, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(incompatibleWorkspace, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(incompatibleWorkspace, "src", "server"), { recursive: true });
  fs.writeFileSync(path.join(incompatibleWorkspace, "package.json"), JSON.stringify({
    name: "legacy-db-browser-sql",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(
    path.join(incompatibleWorkspace, "src", "lib", "db.ts"),
    LEGACY_GENERATED_DB_CLIENT_SOURCE
  );
  fs.writeFileSync(
    path.join(incompatibleWorkspace, "src", "server", "bridge.ts"),
    `import { default as database } from "@/lib/db";\nexport const forwardedDatabase = database;\n`
  );
  fs.writeFileSync(
    path.join(incompatibleWorkspace, "src", "app", "page.tsx"),
    `import { forwardedDatabase } from "@/server/bridge";\nexport const load = () => forwardedDatabase.execute("SELECT 1");\n`
  );
  assert.throws(
    () => writeStarterTemplate(incompatibleWorkspace, "legacy-db-browser-sql"),
    /Migrate those calls to db\.collection\(\)/
  );
  assert.equal(
    fs.readFileSync(path.join(incompatibleWorkspace, "src", "lib", "db.ts"), "utf8"),
    LEGACY_GENERATED_DB_CLIENT_SOURCE
  );

  const serverWorkspace = path.join(tempRoot, "legacy-db-server-consumer");
  fs.mkdirSync(path.join(serverWorkspace, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(serverWorkspace, "src", "app", "api", "records"), { recursive: true });
  fs.writeFileSync(path.join(serverWorkspace, "package.json"), JSON.stringify({
    name: "legacy-db-server-consumer",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(path.join(serverWorkspace, "src", "lib", "db.ts"), LEGACY_GENERATED_DB_CLIENT_SOURCE);
  fs.writeFileSync(
    path.join(serverWorkspace, "src", "lib", "repository.ts"),
    `import db from "@/lib/db";\nexport const serverDatabaseClient = db;\n`
  );
  fs.writeFileSync(
    path.join(serverWorkspace, "src", "app", "api", "records", "route.ts"),
    `export { serverDatabaseClient } from "@/lib/repository";\n`
  );

  writeStarterTemplate(serverWorkspace, "legacy-db-server-consumer");
  assert.equal(
    fs.readFileSync(path.join(serverWorkspace, "src", "lib", "db.ts"), "utf8"),
    LEGACY_GENERATED_DB_CLIENT_SOURCE
  );
  const serverPackage = JSON.parse(fs.readFileSync(path.join(serverWorkspace, "package.json"), "utf8"));
  assert.equal(serverPackage.dependencies["@libsql/client"], "^0.14.0");

  const unusedWorkspace = path.join(tempRoot, "unused-legacy-db");
  fs.mkdirSync(path.join(unusedWorkspace, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(unusedWorkspace, "package.json"), JSON.stringify({
    name: "unused-legacy-db",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(path.join(unusedWorkspace, "src", "lib", "db.ts"), LEGACY_GENERATED_DB_CLIENT_SOURCE);
  fs.mkdirSync(path.join(unusedWorkspace, "src", "server"), { recursive: true });
  fs.writeFileSync(
    path.join(unusedWorkspace, "src", "server", "direct-libsql.ts"),
    `import { createClient } from "@libsql/client";\nexport const createDirectClient = createClient;\n`
  );

  writeStarterTemplate(unusedWorkspace, "unused-legacy-db");
  assert.equal(
    fs.readFileSync(path.join(unusedWorkspace, "src", "lib", "db.ts"), "utf8"),
    GENERATED_DB_CLIENT_SOURCE
  );
  const unusedPackage = JSON.parse(fs.readFileSync(path.join(unusedWorkspace, "package.json"), "utf8"));
  assert.equal(unusedPackage.dependencies["@libsql/client"], "^0.14.0");
});

test.after(async () => {
  await durableProjectStore.remove("durable-demo", "11111111-1111-4111-8111-111111111111");
  assert.equal(await durableProjectStore.readDeploymentFile("durable-demo", "index.html"), null);
  testDatabase.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
