import assert from "node:assert/strict";
import test from "node:test";
import { e2bSandboxManager } from "../src/lib/local-orchestrator/e2b-sandbox-manager";

test("explicit E2B mode refuses a missing key instead of silently building locally", async () => {
  const previousProvider = process.env.SANDBOX_PROVIDER;
  const previousKey = process.env.E2B_API_KEY;
  process.env.SANDBOX_PROVIDER = "e2b";
  delete process.env.E2B_API_KEY;
  try {
    assert.equal(e2bSandboxManager.isE2BEnabled(), false);
    await assert.rejects(() => e2bSandboxManager.startDevServer("missing-key-fixture"), /E2B_API_KEY is required/);
  } finally {
    if (previousProvider === undefined) delete process.env.SANDBOX_PROVIDER;
    else process.env.SANDBOX_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.E2B_API_KEY;
    else process.env.E2B_API_KEY = previousKey;
  }
});
