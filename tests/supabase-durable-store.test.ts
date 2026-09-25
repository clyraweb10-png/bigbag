const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Pool } = require("pg") as typeof import("pg");

// Prefer an explicit process environment (CI/production-like verification),
// while still supporting the local developer convenience file when present.
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      const name = trimmed.slice(0, idx).trim();
      if (idx !== -1 && process.env[name] === undefined) {
        process.env[name] = trimmed.slice(idx + 1).trim();
      }
    }
  });
}

const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { qualificationProjectId } = require("../src/lib/qualification-run") as typeof import("../src/lib/qualification-run");
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

    // A delayed writer from another worker must not restore stale metadata.
    const newer = { ...record, label: "Newest state", lastModifiedAt: new Date(Date.now() + 1_000).toISOString() };
    await durableProjectStore.saveRecord(newer);
    await durableProjectStore.saveRecord({ ...record, label: "Stale state" });
    assert.equal((await durableProjectStore.loadRecord(projectId, tenant1))?.label, "Newest state");

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

    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(() => durableProjectStore.saveDeployment(record, [
      { path: "index.html", content: Buffer.from("cancelled replacement") },
    ], cancelled.signal));
    const preserved = await durableProjectStore.readDeploymentFile(projectId, "index.html");
    assert.equal(Buffer.from(preserved!.content).toString(), "<!DOCTYPE html><html><body>Supabase App</body></html>");

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

test("Supabase PostgreSQL: delayed source and deployment writers cannot replace newer snapshots", async () => {
  const tenantId = `tenant-snapshot-${randomUUID()}`;
  const projectId = `project-snapshot-${randomUUID()}`;
  const older = mockRecord(tenantId, projectId);
  const newer = { ...older, lastModifiedAt: new Date(Date.parse(older.lastModifiedAt) + 1_000).toISOString() };
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sb-snapshot-order-"));
  const restored = fs.mkdtempSync(path.join(os.tmpdir(), "sb-snapshot-restored-"));
  try {
    fs.writeFileSync(path.join(workspace, "index.ts"), "export const version = 'old';");
    await durableProjectStore.saveSource(older, workspace);
    await durableProjectStore.saveDeployment(older, [{ path: "index.html", content: Buffer.from("old") }]);

    fs.writeFileSync(path.join(workspace, "index.ts"), "export const version = 'new';");
    await durableProjectStore.saveSource(newer, workspace);
    await durableProjectStore.saveDeployment(newer, [{ path: "index.html", content: Buffer.from("new") }]);

    fs.writeFileSync(path.join(workspace, "index.ts"), "export const version = 'stale';");
    await assert.rejects(() => durableProjectStore.saveSource(older, workspace), /newer source snapshot/);
    await assert.rejects(
      () => durableProjectStore.saveDeployment(older, [{ path: "index.html", content: Buffer.from("stale") }]),
      /newer deployment snapshot/
    );
    await durableProjectStore.restoreSource(projectId, tenantId, restored);
    assert.equal(fs.readFileSync(path.join(restored, "index.ts"), "utf8"), "export const version = 'new';");
    assert.equal(Buffer.from((await durableProjectStore.readDeploymentFile(projectId, "index.html"))!.content).toString(), "new");
  } finally {
    await durableProjectStore.remove(projectId, tenantId);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(restored, { recursive: true, force: true });
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

test("Supabase PostgreSQL: qualification evidence persists by run and project", async () => {
  const runId = `qualification-test-${Date.now()}`;
  const evidence = {
    projectNumber: 1,
    projectName: "Qualification Persistence",
    category: "FULL_STACK",
    projectId: `qualification-project-${Date.now()}`,
    generationId: `generation-${Date.now()}`,
    statuses: { final: "FAIL", build: "PASS" },
    firstAttemptResult: "FAIL",
    firstAttemptFailures: ["Compiler failure retained for evidence"],
  };
  try {
    await durableProjectStore.saveQualificationEvidence(runId, evidence);
    await durableProjectStore.saveQualificationBenchmark(runId, "cleanup-test", { measuredCapacity: 1 });
    const stored = await durableProjectStore.listQualificationEvidence(runId);
    assert.equal(stored.runId, runId);
    assert.equal(stored.results.length, 1);
    assert.deepEqual(stored.results[0], evidence);
    assert.deepEqual(await durableProjectStore.listQualificationBenchmarks(runId), {
      "cleanup-test": { measuredCapacity: 1 },
    });
  } finally {
    assert.equal(await durableProjectStore.removeQualificationRun(runId), 1);
    assert.deepEqual(await durableProjectStore.listQualificationBenchmarks(runId), {});
  }
});

test("Supabase PostgreSQL: qualification retries retain immutable first-attempt evidence", async () => {
  const runId = `history-test-${randomUUID()}`;
  const firstAttempt = {
    projectNumber: 71,
    projectName: "History retention",
    category: "ECOMMERCE",
    projectId: `qualification-p71-${runId}`,
    generationId: randomUUID(),
    statuses: { final: "FAIL" },
    firstAttemptResult: "FAIL",
    firstAttemptFailures: ["Generated seed records were not requested"],
  };
  const retry = {
    ...firstAttempt,
    projectId: `${firstAttempt.projectId}-1`,
    generationId: randomUUID(),
    statuses: { final: "PARTIAL" },
    priorCampaignAttempts: [{ projectId: firstAttempt.projectId, result: "FAIL" }],
  };
  try {
    await durableProjectStore.saveQualificationEvidence(runId, firstAttempt);
    await durableProjectStore.saveQualificationEvidence(runId, retry);
    const latest = await durableProjectStore.listQualificationEvidence(runId);
    assert.deepEqual(latest.results, [retry]);
    const history = await durableProjectStore.listQualificationAttemptHistory(runId, 71);
    assert.deepEqual(history, [firstAttempt, retry]);
    assert.deepEqual(await durableProjectStore.listQualificationAttemptHistory(runId, 70), []);
  } finally {
    await durableProjectStore.removeQualificationRun(runId);
  }
});

test("Supabase PostgreSQL: concurrent qualification saves retain exactly one snapshot", async () => {
  const runId = `parallel-history-test-${randomUUID()}`;
  const evidence = {
    projectNumber: 71,
    projectName: "Concurrent history retention",
    category: "ECOMMERCE",
    projectId: `qualification-p71-${runId}`,
    generationId: randomUUID(),
    statuses: { final: "FAIL" },
  };
  const retry = {
    ...evidence,
    projectId: `${evidence.projectId}-1`,
    generationId: randomUUID(),
    statuses: { final: "PARTIAL" },
  };
  try {
    await Promise.all([
      durableProjectStore.saveQualificationEvidence(runId, evidence),
      durableProjectStore.saveQualificationEvidence(runId, evidence),
    ]);
    await Promise.all([
      durableProjectStore.saveQualificationEvidence(runId, retry),
      durableProjectStore.saveQualificationEvidence(runId, retry),
    ]);
    assert.deepEqual(await durableProjectStore.listQualificationAttemptHistory(runId, 71), [evidence, retry]);
    assert.deepEqual((await durableProjectStore.listQualificationEvidence(runId)).results, [retry]);
  } finally {
    await durableProjectStore.removeQualificationRun(runId);
  }
});

test("Supabase PostgreSQL: qualification history retains a restored earlier state", async () => {
  const runId = `history-transition-${randomUUID()}`;
  const original = {
    projectNumber: 71,
    projectName: "Transition history",
    category: "ECOMMERCE",
    projectId: `qualification-p71-${runId}`,
    generationId: randomUUID(),
    statuses: { final: "FAIL" },
  };
  const changed = { ...original, statuses: { final: "PARTIAL" } };
  try {
    await durableProjectStore.saveQualificationEvidence(runId, original);
    await durableProjectStore.saveQualificationEvidence(runId, changed);
    await durableProjectStore.saveQualificationEvidence(runId, original);
    assert.deepEqual(await durableProjectStore.listQualificationAttemptHistory(runId, 71), [original, changed, original]);
  } finally {
    await durableProjectStore.removeQualificationRun(runId);
    assert.deepEqual(await durableProjectStore.listQualificationAttemptHistory(runId, 71), []);
  }
});

test("Supabase PostgreSQL: qualification retries discover durable prior attempts", async () => {
  const runId = `attempt-test-${randomUUID()}-r`;
  const prefix = qualificationProjectId(runId, 67);
  const ids = [prefix, `${prefix}-1`, `${prefix}-2`, `${prefix}-3`, `${prefix}-unrelated`];
  const records = ids.map((projectId, index) => mockRecord(`attempt-tenant-${runId}-${index}`, projectId));
  records.forEach((record, index) => {
    record.createdAt = new Date(1_700_000_000_000 + index * 1_000).toISOString();
    record.lastModifiedAt = record.createdAt;
  });
  records[2].qualificationRunId = runId;
  records[4].qualificationRunId = runId;
  const reserved = mockRecord(`reservation-${runId}`, qualificationProjectId(runId, 68));
  reserved.qualificationRunId = runId;
  try {
    for (const record of records) await durableProjectStore.saveRecord(record);
    await durableProjectStore.saveQualificationEvidence(runId, {
      projectNumber: 67,
      projectName: "Retry history",
      category: "DESIGNER",
      projectId: prefix,
      generationId: "prior-generation",
      statuses: { final: "FAIL" },
      priorCampaignAttempts: [{ projectId: ids[3] }],
    });
    const attempts = await durableProjectStore.listQualificationProjectAttempts(runId, 67);
    assert.deepEqual(attempts.map((record) => record.projectId), [ids[0], ids[2], ids[3]]);
    assert.deepEqual(await durableProjectStore.listQualificationProjectAttempts(`${runId}-1`, 67), []);
    assert.deepEqual(await durableProjectStore.listQualificationProjectAttempts(runId, 68), []);
    assert.equal(await durableProjectStore.reserveQualificationProjectId(reserved), true);
    const competing = mockRecord(`other-${runId}`, reserved.projectId);
    competing.qualificationRunId = runId;
    assert.equal(await durableProjectStore.reserveQualificationProjectId(competing), false);
    await assert.rejects(() => durableProjectStore.listQualificationProjectAttempts("invalid/run", 67), /Invalid qualification project identity/);
  } finally {
    await durableProjectStore.remove(reserved.projectId, reserved.tenantId);
    await durableProjectStore.removeQualificationRun(runId);
    for (const record of records) await durableProjectStore.remove(record.projectId, record.tenantId);
  }
});

test("Supabase PostgreSQL: preview auth writes purge expired rows from inactive projects", async () => {
  const suffix = Date.now();
  const activeProjectId = `preview-auth-active-${suffix}`;
  const inactiveProjectId = `preview-auth-inactive-${suffix}`;
  const activeTenantId = `tenant-active-${suffix}`;
  const inactiveTenantId = `tenant-inactive-${suffix}`;
  const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString);
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await durableProjectStore.saveRecord(mockRecord(activeTenantId, activeProjectId));
    await durableProjectStore.saveRecord(mockRecord(inactiveTenantId, inactiveProjectId));
    await durableProjectStore.writePreviewAuthStorage(inactiveProjectId, "guest-old", "session", "sealed-old");
    await pool.query(
      `UPDATE public.builder_preview_auth_storage SET updated_at = $1
       WHERE project_id = $2 AND guest_id = $3 AND storage_key = $4`,
      ["2000-01-01T00:00:00.000Z", inactiveProjectId, "guest-old", "session"]
    );
    await durableProjectStore.writePreviewAuthStorage(activeProjectId, "guest-active", "session", "sealed-active");
    assert.equal(await durableProjectStore.readPreviewAuthStorage(inactiveProjectId, "guest-old", "session"), null);
    assert.equal(await durableProjectStore.readPreviewAuthStorage(activeProjectId, "guest-active", "session"), "sealed-active");
  } finally {
    await pool.end();
    await durableProjectStore.remove(activeProjectId, activeTenantId).catch(() => undefined);
    await durableProjectStore.remove(inactiveProjectId, inactiveTenantId).catch(() => undefined);
  }
});
