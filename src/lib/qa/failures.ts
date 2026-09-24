/**
 * BigBag QA Failure Taxonomy — Part 5 Capstone
 *
 * Shared types for the design-qa, responsive-qa, accessibility-qa,
 * interaction-qa, data-state-qa, and production-readiness checks.
 * These extend the existing generation-validator string-issue list
 * with structured severity, category, and verification metadata.
 */

// ── Categories ──────────────────────────────────────────────────────────────

export type FailureCategory =
  | "BUILD_ERROR"
  | "TYPE_ERROR"
  | "RUNTIME_ERROR"
  | "RESPONSIVE_ERROR"
  | "ACCESSIBILITY_ERROR"
  | "DESIGN_SYSTEM_ERROR"
  | "COMPONENT_USAGE_ERROR"
  | "INTERACTION_ERROR"
  | "DATA_STATE_ERROR"
  | "MEDIA_ERROR"
  | "PERFORMANCE_WARNING";

// ── Severity ─────────────────────────────────────────────────────────────────

/**
 * BLOCKER  — Must be fixed before preview is declared successful.
 *            Includes: build failure, broken primary nav/CTA, runtime crash,
 *            obvious a11y blocker, placeholder content on finished preview.
 * HIGH     — Broken secondary flow, WCAG AA contrast failure on body text,
 *            mobile layout failure on a primary page, broken filter/sort/pagination.
 * MEDIUM   — Design-system inconsistency, missing polish on secondary page,
 *            suboptimal mobile pattern that still functions.
 * LOW      — Minor cosmetic inconsistencies, subjective polish preferences.
 *            LOW issues are recorded and reported; they never block delivery.
 */
export type Severity = "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";

// ── Verification status ───────────────────────────────────────────────────────

export type VerificationStatus =
  | "auto-fixed-and-retested"    // Fixed by the self-correction loop; build + retest confirmed clean
  | "fixed-manually"             // Fixed by a targeted manual edit outside the loop
  | "open-non-blocking"          // Detected but below blocking threshold; recorded for user review
  | "blocked-needs-user-decision"; // Cannot be auto-fixed without a product decision from the user

// ── Issue report ──────────────────────────────────────────────────────────────

export interface IssueReport {
  /** Unique identifier for deduplication and retesting */
  id: string;
  severity: Severity;
  category: FailureCategory;
  /** Affected file path, component name, or route (relative to project root) */
  location: string;
  /** Concrete, specific description of the problem */
  description: string;
  /** Actionable fix recommendation */
  recommendedFix: string;
  verificationStatus: VerificationStatus;
}

// ── QA report summary ─────────────────────────────────────────────────────────

export interface QAReport {
  /** ISO timestamp of when the QA run completed */
  completedAt: string;
  /** Generation attempt number (1-based) */
  attempt: number;
  issues: IssueReport[];
  /** True only when no BLOCKER or HIGH issues remain unresolved */
  productionReady: boolean;
}

// ── Severity helpers ──────────────────────────────────────────────────────────

export function isBlocking(issue: IssueReport): boolean {
  return issue.severity === "BLOCKER" && issue.verificationStatus !== "auto-fixed-and-retested";
}

export function unresolvedBlockers(report: QAReport): IssueReport[] {
  return report.issues.filter(isBlocking);
}

export function issueSummary(report: QAReport): string {
  const counts: Record<Severity, number> = { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const issue of report.issues) counts[issue.severity]++;
  return (
    `QA ${report.productionReady ? "PASSED" : "FAILED"} — ` +
    `BLOCKER:${counts.BLOCKER} HIGH:${counts.HIGH} MEDIUM:${counts.MEDIUM} LOW:${counts.LOW}`
  );
}
