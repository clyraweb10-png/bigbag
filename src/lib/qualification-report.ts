import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { qualificationFinalStatus } from "./qualification-gates";

type CatalogueProject = { id: number; name: string; category: string };
type Evidence = { projectNumber?: number; testedAt?: string; repairCount?: number; statuses?: { final?: string }; projectId?: string; externalBlocker?: { category?: string; detail?: string } | null };
const withoutUpdateTime = (report: string): string => report.replace(/^(Run: `[^`]+` · Updated: ).*$/m, "$1<ignored>");

/** Create a new run's catalogue atomically; never replace an existing campaign catalogue. */
export function ensureQualificationCatalog(outputDir: string, runId: string, projects: CatalogueProject[]): void {
  const cataloguePath = path.join(outputDir, "catalog.json");
  if (fs.existsSync(cataloguePath)) return;
  const temporary = path.join(outputDir, `.catalog-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ runId, projects }, null, 2)}\n`, { mode: 0o600 });
    try { fs.linkSync(temporary, cataloguePath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

export function writeQualificationReport(outputDir: string, runId: string): { counts: Record<string, number>; reportPath: string } {
  const catalogue = JSON.parse(fs.readFileSync(path.join(outputDir, "catalog.json"), "utf8")) as { projects: CatalogueProject[] };
  const evidence = new Map<number, Evidence>();
  for (const project of catalogue.projects) {
    const file = path.join(outputDir, `project-${String(project.id).padStart(2, "0")}.json`);
    if (!fs.existsSync(file)) continue;
    const result = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (result && typeof result === "object" && !Array.isArray(result) &&
      (result as Evidence).projectNumber === project.id) evidence.set(project.id, result as Evidence);
  }
  const statusOf = (id: number): string => {
    return qualificationFinalStatus(evidence.get(id));
  };
  const counts: Record<string, number> = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, NOT_RUN: 0 };
  for (const project of catalogue.projects) counts[statusOf(project.id)] += 1;
  const attempted = catalogue.projects.length - counts.NOT_RUN;
  const categories = ["FULL_STACK", "DESIGNER", "ECOMMERCE", "CHAOS"].map((category) => {
    const projects = catalogue.projects.filter((project) => project.category === category);
    return `| ${category} | ${projects.filter((project) => statusOf(project.id) !== "NOT_RUN").length}/${projects.length} | ${projects.filter((project) => statusOf(project.id) === "PASS").length} |`;
  });
  const rows = catalogue.projects.map((project) => {
    const result = evidence.get(project.id);
    return `| ${project.id} | ${project.name.replaceAll("|", "\\|")} | ${project.category} | ${statusOf(project.id)} | ${result?.repairCount ?? "—"} | ${result?.testedAt || "—"} |`;
  });
  const reportPath = path.join(outputDir, "qualification-report.md");
  const providerEvidencePath = path.join(outputDir, "provider-health.json");
  const providerEvidence = fs.existsSync(providerEvidencePath)
    ? JSON.parse(fs.readFileSync(providerEvidencePath, "utf8")) as { summary?: string }
    : null;
  const blockerRows = catalogue.projects.flatMap((project) => {
    const result = evidence.get(project.id);
    if (statusOf(project.id) !== "BLOCKED" || !result?.externalBlocker) return [];
    const category = (result.externalBlocker.category || "unknown").replaceAll("|", "\\|");
    const detail = (result.externalBlocker.detail || "Provider did not complete generation")
      .replace(/\s+/g, " ").replaceAll("|", "\\|").slice(0, 300);
    return [`| ${project.id} | ${category} | ${detail} |`];
  });
  const text = [
    "# BigBag qualification report",
    "",
    `Run: \`${runId}\` · Updated: ${new Date().toISOString()}`,
    "",
    catalogue.projects.length > 0 && counts.PASS === catalogue.projects.length ? "**Release gate: complete.**" : "**Release gate: NOT QUALIFIED.**",
    "",
    "The statuses below come from persisted project evidence. A preview, local CRUD probe, or provider response alone does not count as a project PASS.",
    "",
    "| Status | Projects |", "| --- | ---: |",
    `| Catalogue total | ${catalogue.projects.length} |`,
    `| Measured | ${attempted} |`,
    `| PASS | ${counts.PASS} |`, `| FAIL | ${counts.FAIL} |`,
    `| PARTIAL | ${counts.PARTIAL} |`, `| BLOCKED | ${counts.BLOCKED} |`,
    `| NOT RUN | ${counts.NOT_RUN} |`,
    "",
    "| Category | Measured / total | PASS |", "| --- | ---: | ---: |", ...categories,
    "",
    "## Provider access observed in this continuation",
    "",
    providerEvidence?.summary || "No run-specific live provider probe has been saved.",
    "",
    "## External generation blockers", "",
    blockerRows.length ? "| # | Category | Observed error |" : "No catalog project currently has a measured external generation blocker.",
    ...(blockerRows.length ? ["| ---: | --- | --- |", ...blockerRows] : []),
    "",
    "## Project ledger", "",
    "| # | Project | Category | Final | Repairs | Tested at |",
    "| ---: | --- | --- | --- | ---: | --- |", ...rows,
    "",
    "## Scope and history", "",
    "The per-project JSON files, durable qualification history, and archived prior report versions retain detailed gates and earlier attempts. Missing browser, API, role, connector, security, responsive, edit, or CodeRabbit evidence prevents a PASS.",
    "",
  ].join("\n");
  if (fs.existsSync(reportPath)) {
    const old = fs.readFileSync(reportPath, "utf8");
    if (withoutUpdateTime(old) !== withoutUpdateTime(text)) {
      const historyDir = path.join(outputDir, "report-history");
      fs.mkdirSync(historyDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(reportPath, path.join(historyDir, `qualification-report-${Date.now()}-${randomUUID()}.md`));
    }
  }
  const temporary = path.join(outputDir, `.qualification-report-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600 });
    fs.renameSync(temporary, reportPath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return { counts, reportPath };
}
