const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// Load .env.local for Supabase connection
const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
envFile.split("\n").forEach((line) => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("#")) {
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
});

const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
type LocalProjectRecord = import("../src/lib/local-orchestrator/types").LocalProjectRecord;

function mockRecord(tenantId: string, projectId: string): LocalProjectRecord {
  const now = new Date().toISOString();
  return {
    projectId,
    tenantId,
    label: "Supabase Integration Test",
    description: "Automated test project",
    createdAt: now,
    lastModifiedAt: now,
    port: 3001,
    status: "done",
    serverStatus: "Active",
    conversation: [],
  };
}

test("Supabase PostgreSQL: durable project record persistence and tenant isolation", async () => {
  const tenant1 = `tenant-sb-${Date.now()}-1`;
  const tenant2 = `tenant-sb-${Date.now()}-2`;
  const projectId = `project-sb-${Date.now()}`;
  const record = mockRecord(tenant1, projectId);

  try {
    // 1. Save record
    await durableProjectStore.saveRecord(record);
    assert.equal(await durableProjectStore.projectIdExists(projectId), true);

    // 2. Load record
    const loaded = await durableProjectStore.loadRecord(projectId, tenant1);
    assert.ok(loaded);
    assert.equal(loaded?.projectId, projectId);
    assert.equal(loaded?.tenantId, tenant1);

    // 3. Reject wrong tenant load and overwrite
    assert.equal(await durableProjectStore.loadRecord(projectId, tenant2), null);
    await assert.rejects(
      () => durableProjectStore.saveRecord(mockRecord(tenant2, projectId)),
      /That project id is already owned by another tenant/
    );

    // 4. List records for tenant
    const records = await durableProjectStore.listRecords(tenant1);
    assert.ok(records.some((r) => r.projectId === projectId));
    assert.equal((await durableProjectStore.listRecords(tenant2)).length, 0);
  } finally {
    await durableProjectStore.remove(projectId, tenant1);
  }
});

test("Supabase PostgreSQL: source and deployment snapshots with binary BYTEA integrity", async () => {
  const tenantId = `tenant-sb-${Date.now()}`;
  const projectId = `project-files-sb-${Date.now()}`;
  const record = mockRecord(tenantId, projectId);

  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-workspace-"));
  const restoreWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-restore-"));

  try {
    // Create source files
    fs.mkdirSync(path.join(tempWorkspace, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, "src", "index.ts"), "export const hello = 'supabase';");
    fs.writeFileSync(path.join(tempWorkspace, "package.json"), '{"name":"sb-test"}');

    // Save source to Supabase
    await durableProjectStore.saveSource(record, tempWorkspace);

    // Save deployment to Supabase
    await durableProjectStore.saveDeployment(record, [
      { path: "index.html", content: Buffer.from("<!DOCTYPE html><html><body>Supabase App</body></html>") },
    ]);

    // Read deployment file
    const deployed = await durableProjectStore.readDeploymentFile(projectId, "index.html");
    assert.ok(deployed);
    assert.equal(Buffer.from(deployed!.content).toString(), "<!DOCTYPE html><html><body>Supabase App</body></html>");

    // Restore source from Supabase
    const restoredCount = await durableProjectStore.restoreSource(projectId, tenantId, restoreWorkspace);
    assert.equal(restoredCount, 2);
    assert.equal(
      fs.readFileSync(path.join(restoreWorkspace, "src", "index.ts"), "utf8"),
      "export const hello = 'supabase';"
    );
  } finally {
    await durableProjectStore.remove(projectId, tenantId);
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(restoreWorkspace, { recursive: true, force: true });
  }
});

test("Supabase PostgreSQL: app records collection querying, pagination, and mutations", async () => {
  const tenantId = `tenant-sb-${Date.now()}`;
  const projectId = `project-records-sb-${Date.now()}`;
  const record = mockRecord(tenantId, projectId);

  try {
    await durableProjectStore.saveRecord(record);

    // Create records
    const item1 = await durableProjectStore.createAppRecord(projectId, "tasks", { title: "Task 1", priority: "high" });
    assert.equal(item1.title, "Task 1");
    assert.ok(item1._id);

    const item2 = await durableProjectStore.createAppRecord(projectId, "tasks", { title: "Task 2", priority: "low" });
    assert.equal(item2.title, "Task 2");

    // List collections
    const collections = await durableProjectStore.listAppCollections(projectId);
    assert.deepEqual(collections, [{ name: "tasks", count: 2 }]);

    // List records with pagination
    const list = await durableProjectStore.listAppRecords(projectId, "tasks", { limit: 1, offset: 0 });
    assert.equal(list.total, 2);
    assert.equal(list.records.length, 1);

    // Update record
    const updated = await durableProjectStore.updateAppRecord(projectId, "tasks", item1._id, { priority: "urgent" });
    assert.equal(updated?.priority, "urgent");

    // Delete record
    const deleted = await durableProjectStore.deleteAppRecord(projectId, "tasks", item1._id);
    assert.equal(deleted, true);
    assert.equal((await durableProjectStore.listAllAppRecords(projectId, "tasks")).length, 1);
  } finally {
    await durableProjectStore.remove(projectId, tenantId);
  }
});
