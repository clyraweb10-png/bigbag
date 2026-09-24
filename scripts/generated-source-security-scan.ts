import fs from "node:fs";
import path from "node:path";
import { scanGeneratedSourceLine, type GeneratedSourceSeverity } from "../src/lib/generated-source-security";
import { normalizeQualificationRunId, qualificationProjectId } from "../src/lib/qualification-run";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

interface Finding {
  projectNumber: number;
  projectId: string;
  file: string;
  line: number;
  finding: string;
  severity: GeneratedSourceSeverity;
}

const runId = normalizeQualificationRunId(process.env.BIGBAG_QUALIFICATION_RUN_ID || "");
if (!runId) throw new Error("BIGBAG_QUALIFICATION_RUN_ID is required");

const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
const outputDir = path.join(workspaceRoot, "output", "bigbag-qualification", runId);
const repositoryRoot = process.cwd();

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", ".next"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile() && (/\.(?:tsx?|jsx?|mjs|cjs|html|json)$/.test(entry.name) || /^\.env(?:\..*)?$/.test(entry.name))) files.push(fullPath);
  }
  return files;
}

function isApplicationSource(relativeFile: string): boolean {
  return /\.(?:tsx?|jsx?|html)$/i.test(relativeFile);
}

const findings: Finding[] = [];
const scannedProjects: Array<{ projectNumber: number; projectId: string; files: number }> = [];
const missingProjects: number[] = [];
const seenProjectIds = new Set<string>();

for (let projectNumber = 1; projectNumber <= 100; projectNumber += 1) {
  const evidencePath = path.join(outputDir, `project-${String(projectNumber).padStart(2, "0")}.json`);
  if (!fs.existsSync(evidencePath)) {
    missingProjects.push(projectNumber);
    continue;
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as { projectId?: string };
  const projectId = String(evidence.projectId || "");
  const expectedProjectId = qualificationProjectId(runId, projectNumber);
  const retrySuffix = projectId.startsWith(`${expectedProjectId}-`)
    ? projectId.slice(expectedProjectId.length + 1)
    : "";
  if (projectId !== expectedProjectId && !/^\d+$/.test(retrySuffix)) {
    missingProjects.push(projectNumber);
    continue;
  }
  if (seenProjectIds.has(projectId)) {
    missingProjects.push(projectNumber);
    continue;
  }
  seenProjectIds.add(projectId);
  const workspacesRoot = path.resolve(repositoryRoot, "workspaces");
  const projectRoot = path.resolve(workspacesRoot, projectId);
  if (!projectRoot.startsWith(`${workspacesRoot}${path.sep}`)) {
    missingProjects.push(projectNumber);
    continue;
  }
  const files = walk(projectRoot);
  if (!files.some((filePath) => isApplicationSource(path.relative(projectRoot, filePath).replaceAll(path.sep, "/")))) {
    missingProjects.push(projectNumber);
    continue;
  }
  scannedProjects.push({ projectNumber, projectId, files: files.length });
  for (const filePath of files) {
    const relativeFile = path.relative(projectRoot, filePath).replaceAll(path.sep, "/");
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const result of scanGeneratedSourceLine(relativeFile, line)) {
        findings.push({
          projectNumber,
          projectId,
          file: relativeFile,
          line: index + 1,
          finding: result.finding,
          severity: result.severity,
        });
      }
    });
  }
}

const report = {
  runId,
  generatedAt: new Date().toISOString(),
  status: missingProjects.length > 0 ? "INCOMPLETE" : findings.length > 0 ? "FAIL" : "PASS",
  projectsExpected: 100,
  projectsScanned: scannedProjects.length,
  missingProjects,
  findings,
  scannedProjects,
  scope: "Static high-confidence generated-source scan; runtime authorization and ownership require separate API/browser tests.",
};

fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, "generated-source-security-scan.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `GENERATED_SECURITY_SCAN status=${report.status} projects=${scannedProjects.length}/100 findings=${findings.length} output=${path.relative(workspaceRoot, reportPath)}\n`
);
if (report.status !== "PASS") process.exitCode = 1;
