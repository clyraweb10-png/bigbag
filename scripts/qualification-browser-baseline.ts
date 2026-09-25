import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeQualificationRunId } from "../src/lib/qualification-run";
import type { QualificationEvidence } from "../src/lib/local-orchestrator/durable-project-store";
import { generatedProcessEnvironment } from "../src/lib/local-orchestrator/process-env";

// Keep application provider credentials out of browser helper processes.
const browserEnvironment: NodeJS.ProcessEnv = { ...generatedProcessEnvironment("production") };
for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "NODE_USE_SYSTEM_CA"] as const) {
  if (process.env[name]) browserEnvironment[name] = process.env[name];
}
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const runId = normalizeQualificationRunId(process.env.BIGBAG_QUALIFICATION_RUN_ID || "");
if (!runId) throw new Error("BIGBAG_QUALIFICATION_RUN_ID is required");
const outputRoot = process.env.WORKSPACE_ROOT || process.cwd();
const evidenceDir = path.join(outputRoot, "output", "bigbag-qualification", runId);
const screenshotDir = path.join(evidenceDir, "screenshots");
fs.mkdirSync(screenshotDir, { recursive: true });
const baseUrl = (process.env.BIGBAG_QUALIFICATION_PREVIEW_BASE || "http://localhost:3000").replace(/\/$/, "");
const requested = new Set((process.env.BIGBAG_QUALIFICATION_PROJECTS || "").split(",")
  .map((value) => Number.parseInt(value.trim(), 10)).filter(Number.isInteger));
const refreshEvidence = process.env.BIGBAG_QUALIFICATION_REFRESH_BROWSER === "true";

function browser(...args: string[]): string {
  const result = spawnSync("coderabbit-agent-browser", args, {
    cwd: process.cwd(), env: browserEnvironment, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Shared browser ${args[0]} failed with exit ${result.status ?? "timeout"}`);
  return result.stdout.trim();
}

function pageMetrics(): { bodyChars: number; width: number; scrollWidth: number; controls: number; unlabeledButtons: number; h1Count: number; visibleErrorHeading: string | null } {
  const result = browser("eval", `(() => {
    const buttons = [...document.querySelectorAll('button')];
    const visibleErrorHeading = [...document.querySelectorAll('h1, h2, h3, [role="alert"]')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.textContent?.trim() || '')
      .find((value) => /^(?:something went wrong|could not (?:load|reach)|failed to (?:load|fetch)|application error|.{1,80}\b(?:is|are) unavailable)$/i.test(value)) || null;
    return {
      bodyChars: document.body?.innerText?.trim().length || 0,
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      controls: document.querySelectorAll('button, a[href], input, select, textarea').length,
      h1Count: [...document.querySelectorAll('h1')].filter((heading) => heading.getClientRects().length > 0).length,
      unlabeledButtons: buttons.filter((button) => !button.textContent?.trim() &&
        !button.getAttribute('aria-label') && !button.getAttribute('title')).length,
      visibleErrorHeading,
    };
  })()`);
  return JSON.parse(result) as ReturnType<typeof pageMetrics>;
}

async function main(): Promise<void> {
  const evidenceFiles = fs.readdirSync(evidenceDir).filter((name) => /^project-\d+\.json$/.test(name)).sort();
  for (const filename of evidenceFiles) {
    const evidencePath = path.join(evidenceDir, filename);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as QualificationEvidence & {
      statuses: Record<string, string>;
      screenshotCaptured?: boolean;
      browserBaseline?: unknown;
      browserBaselineOriginalFinal?: string;
    };
    const number = Number(evidence.projectNumber);
    if ((requested.size && !requested.has(number)) || evidence.statuses?.preview !== "PASS" || (evidence.browserBaseline && !refreshEvidence)) continue;
    const projectId = String(evidence.projectId || "");
    if (!/^[a-z0-9-]{1,120}$/.test(projectId)) continue;
    if (!evidence.browserBaselineOriginalFinal) {
      const previousIssues = (evidence.browserBaseline as { issues?: unknown[] } | undefined)?.issues;
      const nonBrowserStatuses = ["generation", "build", "runtime", "preview", "database", "authentication", "connector", "security", "edit"];
      const hasOtherFailure = nonBrowserStatuses.some((key) => evidence.statuses[key] === "FAIL");
      const hasOtherBlocker = nonBrowserStatuses.some((key) => evidence.statuses[key] === "BLOCKED");
      evidence.browserBaselineOriginalFinal = previousIssues?.length && evidence.statuses.final === "FAIL" && !hasOtherFailure
        ? hasOtherBlocker ? "BLOCKED" : "PARTIAL"
        : evidence.statuses.final;
    }
    try {
      browser("errors", "--clear");
      browser("set", "viewport", "1440", "900");
      browser("open", `${baseUrl}/api/preview/${encodeURIComponent(projectId)}/`);
      browser("wait", "3000");
      const desktop = pageMetrics();
      const pageErrors = browser("errors");
      const audit = JSON.parse(browser("a11y", "--json")) as {
        success?: boolean;
        data?: { counts?: { passes?: number; violations?: number }; violations?: Array<{ id: string; impact: string; nodeCount: number }> };
      };
      if (!audit.success || !audit.data) throw new Error("Accessibility audit did not return results");
      const accessibilityViolations = audit.data.violations || [];
      const desktopFile = path.join(screenshotDir, `project-${String(number).padStart(2, "0")}-desktop.png`);
      browser("screenshot", desktopFile);
      browser("set", "viewport", "320", "720");
      browser("wait", "350");
      const mobile = pageMetrics();
      const mobileErrors = browser("errors");
      const mobileFile = path.join(screenshotDir, `project-${String(number).padStart(2, "0")}-mobile.png`);
      browser("screenshot", mobileFile);
      const issues = [
        ...(desktop.bodyChars < 40 ? ["Desktop rendered fewer than 40 visible characters"] : []),
        ...(mobile.bodyChars < 40 ? ["Mobile rendered fewer than 40 visible characters"] : []),
        ...(mobile.scrollWidth > mobile.width + 2 ? [`Mobile page overflow: ${mobile.scrollWidth}px at ${mobile.width}px`] : []),
        ...(desktop.h1Count !== 1 ? [`Desktop has ${desktop.h1Count} visible level-one headings`] : []),
        ...(mobile.h1Count !== 1 ? [`Mobile has ${mobile.h1Count} visible level-one headings`] : []),
        ...(desktop.visibleErrorHeading ? [`Desktop shows an error state: ${desktop.visibleErrorHeading}`] : []),
        ...(mobile.visibleErrorHeading && mobile.visibleErrorHeading !== desktop.visibleErrorHeading
          ? [`Mobile shows an error state: ${mobile.visibleErrorHeading}`] : []),
        ...(desktop.unlabeledButtons + mobile.unlabeledButtons > 0 ? ["Visible buttons are missing accessible names"] : []),
        ...(pageErrors || mobileErrors ? ["Browser reported a runtime exception"] : []),
        ...accessibilityViolations.map((violation) => `Accessibility: ${violation.id} (${violation.impact}, ${violation.nodeCount} nodes)`),
      ];
      evidence.browserBaseline = { testedAt: new Date().toISOString(), desktop, mobile, issues };
      evidence.accessibilityAudit = { counts: audit.data.counts, violations: accessibilityViolations };
      evidence.screenshotCaptured = true;
      evidence.statuses.responsive = mobile.scrollWidth <= mobile.width + 2 ? "PASS" : "FAIL";
      evidence.statuses.accessibility = accessibilityViolations.length || desktop.unlabeledButtons + mobile.unlabeledButtons > 0 ? "FAIL" : "PARTIAL";
      evidence.statuses.frontend = issues.length ? "FAIL" : "PARTIAL";
      evidence.statuses.uiUx = issues.length ? "FAIL" : "PARTIAL";
      evidence.statuses.final = issues.length ? "FAIL" : evidence.browserBaselineOriginalFinal;
      await durableProjectStore.saveQualificationEvidence(runId, evidence);
      fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      process.stdout.write(`BROWSER_BASELINE project=${number} result=${issues.length ? "FAIL" : "PARTIAL"} issues=${issues.length}\n`);
    } catch (error) {
      process.stdout.write(`BROWSER_BASELINE project=${number} result=BLOCKED reason=${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; })
  .finally(() => durableProjectStore.closeConnections());
