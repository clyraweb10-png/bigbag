import { createHash } from "node:crypto";

export function normalizeQualificationRunId(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .toLowerCase();
}

export function qualificationProjectId(runId: string, projectNumber: number): string {
  if (!/^[a-z0-9-]{1,120}$/.test(runId) || !Number.isInteger(projectNumber) || projectNumber < 1 || projectNumber > 100) {
    throw new Error("Invalid qualification project identity");
  }
  const projectId = `qualification-p${String(projectNumber).padStart(2, "0")}-${runId}`;
  if (projectId.length <= 110) return projectId;
  return `${projectId.slice(0, 45)}-${createHash("sha256").update(runId).digest("hex")}`;
}
