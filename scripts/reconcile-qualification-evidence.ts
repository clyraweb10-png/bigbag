import fs from "node:fs";
import path from "node:path";
import type { QualificationEvidence } from "../src/lib/local-orchestrator/durable-project-store";
import { normalizeQualificationRunId } from "../src/lib/qualification-run";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");

const runId = normalizeQualificationRunId(process.env.BIGBAG_QUALIFICATION_RUN_ID || "");
if (!runId) throw new Error("BIGBAG_QUALIFICATION_RUN_ID is required");
const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
const outputDir = path.join(workspaceRoot, "output", "bigbag-qualification", runId);

function mergeFailures(existing: unknown, additions: unknown[]): string[] {
  return [...new Set([
    ...(Array.isArray(existing) ? existing.filter((value): value is string => typeof value === "string") : []),
    ...additions.filter((value): value is string => typeof value === "string" && value.length > 0),
  ])];
}

async function main() {
  const files = fs.readdirSync(outputDir).filter((name) => /^project-\d+\.json$/.test(name)).sort();
  const reconciled = new Map<number, QualificationEvidence & Record<string, any>>();
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    const evidence = JSON.parse(fs.readFileSync(filePath, "utf8")) as QualificationEvidence & Record<string, any>;
    const statuses = evidence.statuses as Record<string, any>;
    const repairMessages = Array.isArray(evidence.buildRepairMessages) ? evidence.buildRepairMessages : [];
    const original = evidence.evidenceReconciliation?.original || {
      firstAttemptResult: evidence.firstAttemptResult,
      connectorStatus: evidence.connector?.status,
      finalStatus: evidence.statuses?.final,
      editFirstAttemptResult: evidence.edit?.firstAttemptResult,
    };
    if (repairMessages.length > 0) {
      evidence.firstAttemptResult = "FAIL";
      evidence.firstAttemptFailures = mergeFailures(evidence.firstAttemptFailures, repairMessages);
    }
    if (evidence.edit && /repaired|repair attempt|failed/i.test(evidence.edit.terminal?.message || "")) {
      evidence.edit.firstAttemptResult = "FAIL";
      evidence.edit.firstAttemptFailures = mergeFailures(
        evidence.edit.firstAttemptFailures,
        [evidence.edit.terminal?.message]
      );
    }
    if (evidence.category !== "DESIGNER" && evidence.connector?.status === "PASS") {
      evidence.connector.status = "PARTIAL";
      evidence.connector.detail = "Platform PostgreSQL CRUD passed; generated-app workflow participation was not browser-verified";
      statuses.connector = "PARTIAL";
    }
    if (statuses.connector !== "PASS") statuses.final = "FAIL";
    if (statuses.connector !== "PASS" && evidence.finalGates && typeof evidence.finalGates === "object") {
      evidence.finalGates.connector = false;
    }
    evidence.evidenceReconciliation = {
      reconciledAt: new Date().toISOString(),
      original,
      reason: "Preserve repair-bearing first attempts as failures and do not promote an infrastructure-only database probe to a generated-app connector PASS.",
    };
    fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await durableProjectStore.saveQualificationEvidence(runId, evidence);
    reconciled.set(evidence.projectNumber, evidence);
  }
  for (const batchFile of fs.readdirSync(outputDir).filter((name) => /^batch-\d+\.json$/.test(name))) {
    const batchPath = path.join(outputDir, batchFile);
    const batchEvidence = JSON.parse(fs.readFileSync(batchPath, "utf8")) as Record<string, any>;
    if (Array.isArray(batchEvidence.results)) {
      batchEvidence.results = batchEvidence.results.map((result: { projectNumber?: number }) =>
        result.projectNumber ? reconciled.get(result.projectNumber) || result : result
      );
      batchEvidence.evidenceReconciledAt = new Date().toISOString();
      fs.writeFileSync(batchPath, `${JSON.stringify(batchEvidence, null, 2)}\n`);
    }
  }
  process.stdout.write(`Reconciled ${files.length} qualification records for ${runId}\n`);
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
