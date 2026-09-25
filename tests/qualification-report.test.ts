import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureQualificationCatalog, writeQualificationReport } from "../src/lib/qualification-report";

test("a new run receives a catalogue while existing campaign evidence remains untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-catalog-"));
  try {
    const projects = [{ id: 1, name: "Synthetic app", category: "FULL_STACK" }];
    ensureQualificationCatalog(dir, "new-run", projects);
    const cataloguePath = path.join(dir, "catalog.json");
    const original = fs.readFileSync(cataloguePath, "utf8");
    assert.deepEqual(JSON.parse(original), { runId: "new-run", projects });
    ensureQualificationCatalog(dir, "different-run", []);
    assert.equal(fs.readFileSync(cataloguePath, "utf8"), original);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("report counts only persisted terminal evidence and archives its previous version", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-report-"));
  try {
    fs.writeFileSync(path.join(dir, "catalog.json"), JSON.stringify({ projects: [
      { id: 1, name: "App", category: "FULL_STACK" },
      { id: 2, name: "Site", category: "DESIGNER" },
    ] }));
    fs.writeFileSync(path.join(dir, "qualification-report.md"), "Historical report\n");
    fs.writeFileSync(path.join(dir, "project-01.json"), JSON.stringify({ projectNumber: 1, statuses: { final: "FAIL" }, repairCount: 2 }));
    const report = writeQualificationReport(dir, "synthetic");
    assert.deepEqual(report.counts, { PASS: 0, FAIL: 1, PARTIAL: 0, BLOCKED: 0, NOT_RUN: 1 });
    const content = fs.readFileSync(report.reportPath, "utf8");
    assert.match(content, /\| 1 \| App \| FULL_STACK \| FAIL \| 2 \|/);
    assert.match(content, /\| 2 \| Site \| DESIGNER \| NOT_RUN \|/);
    const history = fs.readdirSync(path.join(dir, "report-history"));
    assert.equal(history.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, "report-history", history[0]), "utf8"), "Historical report\n");
    writeQualificationReport(dir, "synthetic");
    assert.equal(fs.readdirSync(path.join(dir, "report-history")).length, 1,
      "a timestamp-only refresh must not create another historical report");
    fs.writeFileSync(path.join(dir, "project-02.json"), JSON.stringify({ projectNumber: 2, statuses: { final: "BLOCKED" },
      externalBlocker: { category: "rate_limit", detail: "AI request failed (rate_limit). HTTP 429." } }));
    const blocked = writeQualificationReport(dir, "synthetic");
    assert.equal(blocked.counts.BLOCKED, 1);
    assert.match(fs.readFileSync(blocked.reportPath, "utf8"), /\| 2 \| rate_limit \| AI request failed \(rate_limit\)\. HTTP 429\. \|/);
    fs.writeFileSync(path.join(dir, "project-02.json"), "null\n");
    const invalid = writeQualificationReport(dir, "synthetic");
    assert.equal(invalid.counts.NOT_RUN, 1);
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-empty-report-"));
    try {
      fs.writeFileSync(path.join(emptyDir, "catalog.json"), JSON.stringify({ projects: [] }));
      const empty = writeQualificationReport(emptyDir, "synthetic-empty");
      assert.match(fs.readFileSync(empty.reportPath, "utf8"), /Release gate: NOT QUALIFIED/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
