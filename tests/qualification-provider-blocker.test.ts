import assert from "node:assert/strict";
import test from "node:test";
import { qualificationProviderBlocker } from "../src/lib/qualification-provider-blocker";

test("provider failure with no generated source is blocked while source defects remain failures", () => {
  const providerFailure = "Generation stopped after automatic corrections. Blocking error: AI request failed (rate_limit). HTTP 429 (rate_limit). No preview is marked ready.";
  assert.equal(qualificationProviderBlocker(providerFailure, false), "rate_limit");
  assert.equal(qualificationProviderBlocker(providerFailure, true), null);
  assert.equal(qualificationProviderBlocker("The AI generation was incomplete: missing owner authorization", false), null);
});
