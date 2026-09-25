import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Replace the current evidence only after a complete new result exists. */
export function writeQualificationEvidenceFile(outputDir: string, projectNumber: number, evidence: unknown): string {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("Qualification evidence must be a result object");
  }
  const serialized = JSON.stringify(evidence, null, 2);
  if (typeof serialized !== "string") throw new TypeError("Qualification evidence cannot be serialized");
  const result = JSON.parse(serialized) as unknown;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("Qualification evidence must serialize to a result object");
  }
  const stem = `project-${String(projectNumber).padStart(2, "0")}`;
  const evidencePath = path.join(outputDir, `${stem}.json`);
  const temporary = path.join(outputDir, `.${stem}-${randomUUID()}.tmp`);
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    fs.writeFileSync(temporary, `${serialized}\n`, { mode: 0o600 });
    if (fs.existsSync(evidencePath)) {
      const archiveDir = path.join(outputDir, "attempts");
      fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(evidencePath, path.join(archiveDir, `${stem}-${Date.now()}-${randomUUID()}.json`));
    }
    fs.renameSync(temporary, evidencePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return evidencePath;
}
