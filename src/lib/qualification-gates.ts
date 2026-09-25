const terminal = new Set(["PASS", "FAIL", "PARTIAL", "BLOCKED"]);
const commonPassStatuses = [
  "generation", "codeGeneration", "files", "dependencies", "typescript", "build",
  "runtime", "preview", "frontend", "connector", "edit", "responsive", "uiUx",
  "accessibility", "security", "codeRabbit",
] as const;
const fullStackPassStatuses = ["backend", "database", "authentication", "crud", "api", "persistence"] as const;
const requiredFinalGates = [
  "generation", "build", "runtime", "authentication", "editLifecycle", "connector",
  "qualificationPersistence",
] as const;

/** A persisted label alone is never sufficient evidence for a campaign PASS. */
export function qualificationFinalStatus(evidence: unknown): string {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return "NOT_RUN";
  const result = evidence as Record<string, unknown>;
  const statuses = result.statuses;
  if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return "NOT_RUN";
  const values = statuses as Record<string, unknown>;
  const final = values.final;
  if (typeof final !== "string" || !terminal.has(final)) return "NOT_RUN";
  if (final !== "PASS") return final;
  const gates = result.finalGates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return "NOT_RUN";
  const gateValues = gates as Record<string, unknown>;
  if (requiredFinalGates.some((gate) => gateValues[gate] !== true) ||
    Object.values(gateValues).some((value) => value !== true)) return "NOT_RUN";
  const requiredStatuses = result.category === "DESIGNER"
    ? commonPassStatuses
    : [...commonPassStatuses, ...fullStackPassStatuses];
  return requiredStatuses.every((status) => values[status] === "PASS") ? "PASS" : "NOT_RUN";
}
