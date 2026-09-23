import assert from "node:assert/strict";
import test from "node:test";
import { scanGeneratedSourceLine } from "../src/lib/generated-source-security";
import { normalizeQualificationRunId } from "../src/lib/qualification-run";

test("generated-source scanner rejects authentication authority in browser source", () => {
  assert.equal(scanGeneratedSourceLine("src/Auth.tsx", "if (candidate === user.passwordHash) allow();").length, 1);
  assert.equal(scanGeneratedSourceLine("src/Auth.tsx", "localStorage.setItem('auth-token', token);").length, 1);
  assert.equal(scanGeneratedSourceLine("index.html", '<a href="javascript:alert(1)">x</a>').length, 1);
  assert.equal(scanGeneratedSourceLine("src/config.ts", "const key = 'fc-0123456789abcdef0123456789abcdef';").length, 1);
});

test("generated-source scanner permits confirmation and non-authoritative preferences", () => {
  assert.deepEqual(scanGeneratedSourceLine("src/Auth.tsx", "if (confirm !== password) showMismatch();"), []);
  assert.deepEqual(scanGeneratedSourceLine("src/App.tsx", "localStorage.setItem(FILTER_KEY_PREFIX + session.user.id, filter);"), []);
  assert.deepEqual(scanGeneratedSourceLine("server/config.ts", "const url = process.env.DATABASE_URL;"), []);
  assert.deepEqual(scanGeneratedSourceLine("src/App.tsx", "const label = 'fc-product-card';"), []);
});

test("qualification run ids are normalized consistently", () => {
  assert.equal(normalizeQualificationRunId(" Campaign_2026 / Batch 6 "), "campaign-2026-batch-6");
  assert.equal(normalizeQualificationRunId("---"), "");
  assert.equal(normalizeQualificationRunId("A".repeat(140)).length, 120);
});
