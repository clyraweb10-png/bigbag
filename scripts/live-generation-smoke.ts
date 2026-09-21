import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const { localAgentEngine } = require("../src/lib/local-orchestrator/agent-engine") as typeof import("../src/lib/local-orchestrator/agent-engine");
const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { localProjectStore, persistentPreviewPath } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");

const prompt = process.env.BIGBAG_SMOKE_PROMPT?.trim() ||
  "Build a polished full-stack client operations CRM with a responsive sidebar, kanban pipeline, searchable contacts, an add-contact form, deal values, activity notes, loading and error states, and real persisted create, update, and delete behavior. Use a distinctive navy and cyan visual system with excellent mobile behavior.";
const requestedProjectId = `live-smoke-${Date.now().toString(36)}`;
const tenantId = randomUUID();
const keepProject = process.env.KEEP_SMOKE_PROJECT === "1";

async function waitForCompletion(projectId: string): Promise<void> {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const record = localProjectStore.getRecord(projectId);
    const terminalMessage = [...(record?.conversation || [])]
      .reverse()
      .find((message) => message.messageType === "finished" || message.messageType === "error");
    if (record?.status === "done" && terminalMessage) {
      if (terminalMessage.messageType === "error") throw new Error(terminalMessage.message);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Live generation did not finish within 12 minutes");
}

async function main(): Promise<void> {
  const project = localProjectStore.create({
    projectId: requestedProjectId,
    tenantId,
    label: "Live generation smoke test",
    description: prompt,
  });
  const projectId = project.projectId;

  try {
    await localAgentEngine.runPrompt(projectId, prompt);
    await waitForCompletion(projectId);

    const record = localProjectStore.getRecord(projectId);
    assert.equal(record?.deployment?.status, "success", "Live generation did not produce a successful deployment");
    const index = await durableProjectStore.readDeploymentFile(projectId, "index.html");
    assert.ok(index, "Persistent preview index.html is missing");
    const html = Buffer.from(index.content).toString("utf8");
    assert.match(html, /<div id="root"><\/div>/, "Persistent preview has no React root");
    assert.match(html, /assets\//, "Persistent preview has no compiled asset reference");
    process.stdout.write(`LIVE_GENERATION_PASS project=${projectId} preview=${persistentPreviewPath(projectId)}\n`);
  } finally {
    if (!keepProject) {
      localProjectStore.remove(projectId);
      await durableProjectStore.remove(projectId, tenantId);
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`LIVE_GENERATION_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
