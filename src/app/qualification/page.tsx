import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AUTH_COOKIE, isQualificationOperator, verifyAuthSession } from "@/lib/auth-session";
import { durableProjectStore, type QualificationEvidence } from "@/lib/local-orchestrator/durable-project-store";
import { QUALIFICATION_PROJECTS } from "@/lib/qualification-projects";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const tone: Record<string, string> = {
  PASS: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  FAIL: "border-red-500/35 bg-red-500/10 text-red-300",
  BLOCKED: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  PARTIAL: "border-sky-500/35 bg-sky-500/10 text-sky-200",
  RUNNING: "border-violet-500/35 bg-violet-500/10 text-violet-200",
  REPAIRING: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  RETESTING: "border-violet-500/35 bg-violet-500/10 text-violet-200",
  REPAIRED: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  "NOT APPLICABLE": "border-white/10 bg-white/[0.03] text-zinc-400",
  NOT_RUN: "border-white/10 bg-white/[0.03] text-zinc-400",
};

function Pill({ value }: { value: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${tone[value] || tone.NOT_RUN}`}>{value.replace("_", " ")}</span>;
}

function valueAt(evidence: QualificationEvidence | undefined, key: string): string {
  const statuses = evidence?.statuses as Record<string, unknown> | undefined;
  return typeof statuses?.[key] === "string" ? String(statuses[key]) : "NOT_RUN";
}

export default async function QualificationPage() {
  const cookieStore = await cookies();
  const session = verifyAuthSession(cookieStore.get(AUTH_COOKIE)?.value);
  if (!session || !isQualificationOperator(session)) notFound();

  let runId: string | null = null;
  let results: QualificationEvidence[] = [];
  let benchmarks: Record<string, Record<string, unknown>> = {};
  let storageError: string | null = null;
  try {
    ({ runId, results } = await durableProjectStore.listQualificationEvidence());
    if (runId) benchmarks = await durableProjectStore.listQualificationBenchmarks(runId);
  } catch (error) {
    storageError = error instanceof Error ? error.message : "Qualification storage is unavailable";
  }
  const byNumber = new Map(results.map((result) => [result.projectNumber, result]));
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, PARTIAL: 0, NOT_RUN: 0 };
  let repaired = 0;
  let running = 0;
  let repairing = 0;
  let retesting = 0;
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
  const durations = results.map((result) => result.generationDurationMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const totalRepairs = results.reduce((sum, result) => sum + numeric(result.repairCount), 0);
  const metricCount = (field: string, status: string) => results.filter((result) => valueAt(result, field) === status).length;
  const securityFindings = results.reduce((sum, result) => sum + (Array.isArray(result.securityFindings) ? result.securityFindings.length : 0), 0);
  const reviewedProjects = results.filter((result) => typeof result.codeRabbitFindingCount === "number");
  const codeRabbitFindings = reviewedProjects.reduce((sum, result) => sum + numeric(result.codeRabbitFindingCount), 0);
  for (const project of QUALIFICATION_PROJECTS) {
    const evidence = byNumber.get(project.projectNumber);
    const status = valueAt(evidence, "final");
    if (status === "RUNNING") { running += 1; continue; }
    if (status === "REPAIRING") { repairing += 1; continue; }
    if (status === "RETESTING") { retesting += 1; continue; }
    const countKey = status in counts ? status as keyof typeof counts : "NOT_RUN";
    counts[countKey] += 1;
    if (numeric(evidence?.repairCount) > 0 && status === "PASS") repaired += 1;
  }

  return (
    <main className="min-h-screen bg-[#111113] px-4 py-8 text-zinc-100 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-[1500px] space-y-7">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-violet-300">BigBag internal qualification</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">100-project production evidence</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">Only persisted test evidence is counted. A successful build is not promoted to PASS when auth, connector, responsive, accessibility, security, edit, or review evidence is incomplete.</p>
          </div>
          <div className="text-xs text-zinc-400">Run: <span className="font-mono text-zinc-200">{runId || "none"}</span></div>
        </header>

        {storageError && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">Persistent evidence unavailable: {storageError}</div>}

        <section aria-label="Campaign totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-10">
          {[["TOTAL", 100], ["RUNNING", running], ["REPAIRING", repairing], ["PASS", counts.PASS], ["FAIL", counts.FAIL], ["BLOCKED", counts.BLOCKED], ["PARTIAL", counts.PARTIAL], ["REPAIRED", repaired], ["RETESTING", retesting], ["NOT RUN", counts.NOT_RUN]].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="text-xs text-zinc-400">{label}</div><div data-tabular className="mt-1 text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </section>

        <section aria-label="Measured campaign metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
          {[
            ["AVG GENERATION", durations.length ? `${Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 1000)}s` : "NOT RUN"],
            ["AVG REPAIRS", results.length ? (totalRepairs / results.length).toFixed(1) : "NOT RUN"],
            ["BUILD FAILURES", metricCount("build", "FAIL")],
            ["RUNTIME FAILURES", metricCount("runtime", "FAIL")],
            ["CONNECTOR FAILURES", metricCount("connector", "FAIL")],
            ["SECURITY FINDINGS", securityFindings],
            ["CODERABBIT FINDINGS", reviewedProjects.length ? codeRabbitFindings : "NOT RUN"],
          ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="text-xs text-zinc-400">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[["FULL STACK", 1, 50], ["DESIGNER / FRONTEND", 51, 70], ["ECOMMERCE", 71, 90], ["RANDOM / CHAOS", 91, 100]].map(([label, first, last]) => {
            const completed = results.filter((result) => result.projectNumber >= Number(first) && result.projectNumber <= Number(last)).length;
            const passed = results.filter((result) => result.projectNumber >= Number(first) && result.projectNumber <= Number(last) && valueAt(result, "final") === "PASS").length;
            return <div key={String(label)} className="rounded-xl border border-white/10 bg-[#19191c] p-4"><div className="text-xs font-medium text-zinc-300">{label}</div><div className="mt-2 text-xl font-semibold">{passed}/{Number(last) - Number(first) + 1} passed</div><div className="mt-1 text-xs text-zinc-400">{completed} evidenced</div></div>;
          })}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {QUALIFICATION_PROJECTS.map((project) => {
            const evidence = byNumber.get(project.projectNumber);
            const finalStatus = valueAt(evidence, "final");
            const failures = Array.isArray(evidence?.firstAttemptFailures) ? evidence.firstAttemptFailures as string[] : [];
            const eventTypes = Array.isArray(evidence?.eventTypes) ? evidence.eventTypes as string[] : [];
            const sourceFiles = Array.isArray(evidence?.sourceFiles) ? evidence.sourceFiles as string[] : [];
            const manualChecks = Array.isArray(evidence?.manualChecks)
              ? evidence.manualChecks.filter((check): check is { name: string; result: string; detail: string } =>
                  Boolean(check && typeof check === "object" &&
                    typeof (check as Record<string, unknown>).name === "string" &&
                    typeof (check as Record<string, unknown>).result === "string" &&
                    typeof (check as Record<string, unknown>).detail === "string"))
              : [];
            const prompt = typeof evidence?.prompt === "string" ? evidence.prompt : null;
            const modelDiagnostics = evidence?.modelDiagnostics as Record<string, unknown> | undefined;
            const edit = evidence?.edit as Record<string, unknown> | undefined;
            return (
              <details key={project.projectNumber} className="group rounded-2xl border border-white/10 bg-[#19191c] p-4 open:border-violet-400/30">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] text-zinc-400">PROJECT {String(project.projectNumber).padStart(2, "0")}</div><h2 className="mt-1 text-sm font-semibold">{project.name}</h2><div className="mt-1 text-[10px] text-zinc-400">{project.category.replace("_", " ")}</div></div><Pill value={finalStatus} /></div>
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-zinc-400">
                    {[["Generation", "generation"], ["Build", "build"], ["Runtime", "runtime"], ["Preview", "preview"], ["Frontend", "frontend"], ["Backend", "backend"], ["Auth", "authentication"], ["Database", "database"], ["CRUD", "crud"], ["Connector", "connector"], ["Responsive", "responsive"], ["UI/UX", "uiUx"], ["Accessibility", "accessibility"], ["Security", "security"], ["Edit", "edit"], ["CodeRabbit", "codeRabbit"]].map(([label, key]) => <div key={key} className="flex justify-between gap-2"><span>{label}</span><span className="font-mono">{valueAt(evidence, key)}</span></div>)}
                  </div>
                </summary>
                <div className="mt-4 space-y-3 border-t border-white/10 pt-4 text-xs text-zinc-400">
                  {evidence ? <>
                    <div><span className="text-zinc-400">Project ID:</span> <span className="break-all font-mono text-zinc-200">{evidence.projectId}</span></div>
                    <div><span className="text-zinc-400">Generation ID:</span> <span className="break-all font-mono text-zinc-200">{evidence.generationId}</span></div>
                    <div><span className="text-zinc-400">Tested:</span> <span className="text-zinc-200">{typeof evidence.testedAt === "string" ? evidence.testedAt : "Not recorded"}</span></div>
                    <div><span className="text-zinc-400">Repair attempts:</span> <span className="text-zinc-200">{numeric(evidence.repairCount)}</span></div>
                    {typeof evidence.generationDurationMs === "number" && <div><span className="text-zinc-400">Generation time:</span> <span className="text-zinc-200">{Math.round(evidence.generationDurationMs / 1000)}s</span></div>}
                    {modelDiagnostics && <div><span className="text-zinc-400">Actual model:</span> <span className="font-mono text-zinc-200">{String(modelDiagnostics.providerId || "unknown")} / {String(modelDiagnostics.model || "unknown")}</span> <span className="text-zinc-400">({String(modelDiagnostics.attempts || 0)} request attempts)</span></div>}
                    {typeof edit?.generationId === "string" && <div><span className="text-zinc-400">Edit generation ID:</span> <span className="break-all font-mono text-zinc-200">{edit.generationId}</span></div>}
                    <div><span className="text-zinc-400">First attempt:</span> <Pill value={String(evidence.firstAttemptResult || "NOT_RUN")} /></div>
                    {prompt && <div><div className="mb-1 text-zinc-400">Prompt</div><p className="max-h-32 overflow-y-auto rounded-lg bg-black/20 p-3 leading-relaxed text-zinc-200">{prompt}</p></div>}
                    {failures.length > 0 && <div><div className="mb-1 text-red-300">Recorded first-attempt failures</div><ul className="list-disc space-y-1 pl-4">{failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul></div>}
                    {manualChecks.length > 0 && <div><div className="mb-1 text-zinc-400">Functional checks</div><ul className="space-y-2">{manualChecks.map((check, index) => <li key={`${check.name}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-2"><div className="flex items-center gap-2"><Pill value={check.result} /><span className="font-medium text-zinc-200">{check.name}</span></div><p className="mt-1">{check.detail}</p></li>)}</ul></div>}
                    {eventTypes.length > 0 && <div><div className="mb-1 text-zinc-400">Generation timeline</div><ol className="max-h-36 list-decimal space-y-1 overflow-y-auto pl-5 font-mono text-[10px] text-zinc-200">{eventTypes.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)}</ol></div>}
                    {sourceFiles.length > 0 && <div><div className="mb-1 text-zinc-400">Generated files ({sourceFiles.length})</div><div className="max-h-32 overflow-y-auto rounded-lg bg-black/20 p-3 font-mono text-[10px] text-zinc-200">{sourceFiles.map((file) => <div key={file}>{file}</div>)}</div></div>}
                    <a className="inline-flex rounded-lg border border-white/10 px-3 py-2 text-zinc-200 hover:bg-white/5" href={`/api/preview/${encodeURIComponent(evidence.projectId)}/`}>Open persisted preview</a>
                    {evidence.screenshotCaptured === true && runId && <a className="ml-2 inline-flex rounded-lg border border-white/10 px-3 py-2 text-zinc-200 hover:bg-white/5" href={`/api/qualification/screenshot/${encodeURIComponent(runId)}/${project.projectNumber}`} target="_blank" rel="noopener noreferrer">Verified screenshot</a>}
                    {typeof evidence.screenshotUrl === "string" && /^https:\/\//.test(evidence.screenshotUrl) && <a className="ml-2 inline-flex rounded-lg border border-white/10 px-3 py-2 text-zinc-200 hover:bg-white/5" href={evidence.screenshotUrl} target="_blank" rel="noopener noreferrer">External screenshot</a>}
                  </> : <p>No lifecycle evidence has been recorded for this project.</p>}
                </div>
              </details>
            );
          })}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#19191c] p-5">
          <h2 className="font-semibold">Connector evidence</h2>
          <p className="mt-1 text-sm text-zinc-400">Statuses below come from saved project runs. A configured credential alone does not count as a healthy connection.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(["PASS", "FAIL", "BLOCKED"] as const).map((status) => <div key={status} className="rounded-xl border border-white/10 p-4"><Pill value={status} /><div className="mt-2 text-2xl font-semibold">{metricCount("connector", status)}</div><div className="text-xs text-zinc-400">project connector checks</div></div>)}
          </div>
          {results.length === 0 && <p className="mt-4 text-sm text-zinc-400">No connector operations have been qualified in this campaign.</p>}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5"><h2 className="font-semibold">AI / performance benchmark</h2><div className="mt-3"><Pill value="NOT_RUN" /></div><p className="mt-3 text-sm text-zinc-400">No complete persisted evidence is available yet. This panel cannot report PASS.</p></div>
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-5">
            <h2 className="font-semibold">1M-user capacity benchmark</h2>
            {benchmarks["database-1m"] ? <>
              <div className="mt-3"><Pill value="PARTIAL" /></div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-zinc-400">Measured logical rows</dt><dd className="mt-1 text-xl font-semibold">{Number(benchmarks["database-1m"].measuredCapacity || 0).toLocaleString()}</dd></div><div><dt className="text-zinc-400">Scope</dt><dd className="mt-1 text-zinc-200">PostgreSQL data model only</dd></div></dl>
              <p className="mt-4 text-sm text-zinc-400">Synthetic temporary-table evidence exists, but API, auth, queue, connector, preview, connection-saturation, database CPU, and cache behavior remain unqualified. This is not a one-million-concurrent-user PASS.</p>
            </> : <><div className="mt-3"><Pill value="NOT_RUN" /></div><p className="mt-3 text-sm text-zinc-400">No persisted capacity evidence is available yet. This panel cannot report PASS.</p></>}
          </div>
        </section>
      </div>
    </main>
  );
}
