import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeQualificationEvidenceFile } from "../src/lib/qualification-evidence-file";

test("a completed qualification replaces current evidence and archives the previous result", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-qualification-evidence-"));
  try {
    const current = writeQualificationEvidenceFile(dir, 21, { final: "FAIL", attempt: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(current, "utf8")), { final: "FAIL", attempt: 1 });
    assert.equal(fs.existsSync(path.join(dir, "attempts")), false);
    writeQualificationEvidenceFile(dir, 21, { final: "PARTIAL", attempt: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(current, "utf8")), { final: "PARTIAL", attempt: 2 });
    const archives = fs.readdirSync(path.join(dir, "attempts"));
    assert.equal(archives.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "attempts", archives[0]), "utf8")), { final: "FAIL", attempt: 1 });
    assert.throws(() => writeQualificationEvidenceFile(dir, 21, undefined), /result object/);
    assert.throws(() => writeQualificationEvidenceFile(dir, 21, { toJSON: () => "incomplete" }), /serialize to a result object/);
    assert.throws(() => writeQualificationEvidenceFile(dir, 21, { toJSON: () => [] }), /serialize to a result object/);
    assert.deepEqual(JSON.parse(fs.readFileSync(current, "utf8")), { final: "PARTIAL", attempt: 2 });
    assert.equal(fs.readdirSync(path.join(dir, "attempts")).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
