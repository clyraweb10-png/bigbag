import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { generationValidationIssues } = require("../src/lib/local-orchestrator/generation-validator") as typeof import("../src/lib/local-orchestrator/generation-validator");
const { writeStarterTemplate } = require("../src/lib/local-orchestrator/starter-template") as typeof import("../src/lib/local-orchestrator/starter-template");

const PROMPTS = [
  "Build a CRM with kanban pipelines, contacts, notes, filters, and persisted deals",
  "Build a multi-tenant property management dashboard with maintenance requests",
  "Build a restaurant ordering app with cart, modifiers, and order history",
  "Build a healthcare appointment portal with provider search and booking",
  "Build a learning management system with courses, progress, and quizzes",
  "Build an inventory manager with low-stock alerts and purchase orders",
  "Build a nonprofit donor CRM with campaigns and volunteer scheduling",
  "Build a project tracker with dependencies, milestones, and activity history",
  "Build a recruiting ATS with candidate stages, scorecards, and interviews",
  "Build a finance dashboard with budgets, transactions, and category trends",
  "Build a field service app with dispatch board and technician work orders",
  "Build a customer support inbox with assignments, tags, and saved replies",
  "Build a subscription analytics app with cohorts, churn, and MRR charts",
  "Build an event platform with sessions, speakers, ticketing, and check-in",
  "Build a procurement portal with approvals, vendors, and audit history",
  "Build a fleet dashboard with vehicles, inspections, and service reminders",
  "Build a legal case manager with matters, deadlines, and document metadata",
  "Build a content calendar with drafts, approvals, and channel scheduling",
  "Build a hotel operations app with rooms, housekeeping, and guest requests",
  "Build a construction tracker with RFIs, punch lists, and daily reports",
  "Build a creator sponsorship CRM with brands, deliverables, and invoices",
  "Build a warehouse picking app with bins, batches, and fulfillment status",
  "Build a security findings dashboard with severity, owners, and remediation",
  "Build an employee onboarding portal with tasks, policies, and equipment",
  "Build a meal planning app with recipes, nutrition, and grocery lists",
  "Build a travel planner with collaborative itineraries and booking notes",
  "Build a veterinary clinic portal with pets, visits, and vaccination records",
  "Build a gym membership app with classes, trainers, and attendance",
  "Build a grant management system with applications, reviews, and awards",
  "Build a manufacturing quality app with inspections and corrective actions",
  "Build a sales territory planner with accounts, quotas, and pipeline coverage",
  "Build a research repository with studies, participants, and tagged insights",
  "Build a community platform with groups, events, moderation, and profiles",
  "Build a marketplace admin with listings, disputes, payouts, and sellers",
  "Build a solar installation CRM with site surveys and permitting stages",
  "Build a wedding planning portal with vendors, budget, and guest RSVPs",
  "Build a personal knowledge base with backlinks, tags, and quick capture",
  "Build an accessibility audit tracker with issues, evidence, and status",
  "Build a localization manager with keys, languages, reviews, and progress",
  "Build a podcast production board with episodes, guests, and publishing",
  "Build a food bank logistics app with donations, inventory, and distribution",
  "Build a school admissions portal with applicants, documents, and decisions",
  "Build a repair shop dashboard with estimates, parts, and customer updates",
  "Build a compliance register with controls, evidence, owners, and reviews",
  "Build a product feedback portal with voting, roadmaps, and changelogs",
  "Build a laboratory sample tracker with chain of custody and test results",
  "Build a coworking management app with desks, rooms, members, and billing",
  "Build a farm operations planner with fields, crops, tasks, and harvest logs",
  "Build a logistics control tower with shipments, exceptions, and ETA updates",
  "Build a white-label client portal with projects, files, messages, and tasks",
] as const;

function appSource(prompt: string, index: number): string {
  return `import { useEffect, useState, type FormEvent } from "react";
import db, { type DbRecord } from "@/lib/db";

const brief = ${JSON.stringify(prompt)};
const items = db.collection("benchmark_items");

export default function App() {
  const [records, setRecords] = useState<DbRecord[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await items.list({ limit: 25 });
      setRecords(result.records);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load records");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function addRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    try {
      await items.create({ name: value, completed: false, benchmark: ${index + 1} });
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save record");
    }
  }

  async function toggle(record: DbRecord) {
    await items.update(record._id, { completed: !record.completed });
    await load();
  }

  async function remove(record: DbRecord) {
    await items.remove(record._id);
    await load();
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-8">
      <section className="mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-10">
        <p className="text-sm font-semibold text-cyan-300">Build benchmark ${index + 1}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">Working full-stack foundation</h1>
        <p className="mt-4 max-w-2xl text-slate-300">{brief}</p>
        <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={addRecord}>
          <label className="sr-only" htmlFor="record-name">Record name</label>
          <input id="record-name" value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" placeholder="Add a record" />
          <button className="min-h-11 rounded-lg bg-cyan-400 px-5 font-semibold text-slate-950 hover:bg-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300" type="submit">Add record</button>
        </form>
        {error ? <p role="alert" className="mt-5 rounded-lg bg-red-950 p-4 text-red-200">{error}</p> : null}
        {loading ? <p className="mt-6 text-slate-400">Loading records...</p> : null}
        {!loading && records.length === 0 ? <p className="mt-6 rounded-lg border border-dashed border-slate-700 p-6 text-slate-400">No records yet. Add the first one above.</p> : null}
        <ul className="mt-6 space-y-3">
          {records.map((record) => (
            <li className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 p-4" key={record._id}>
              <button className="min-h-11 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" onClick={() => void toggle(record)} type="button">{String(record.name || "Untitled")}</button>
              <button aria-label={"Delete " + String(record.name || "record")} className="min-h-11 rounded-md px-3 text-red-300 hover:bg-red-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300" onClick={() => void remove(record)} type="button">Delete</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
`;
}

test("50 hard prompt archetypes satisfy static validation and real production builds", () => {
  assert.equal(PROMPTS.length, 50);
  const workspaceRoot = path.join(process.cwd(), "workspaces");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(workspaceRoot, "prompt-contract-"));
  const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");

  try {
    writeStarterTemplate(workspace, "prompt-contract-matrix");
    for (const [index, prompt] of PROMPTS.entries()) {
      const source = appSource(prompt, index);
      const issues = generationValidationIssues(
        [{ path: "src/App.tsx", content: source }],
        ["src/lib/db.ts", "src/app/globals.css"],
        { requireEntrypoint: true, requireEntrypointFirst: true }
      );
      assert.deepEqual(issues, [], `Prompt ${index + 1} failed static validation: ${issues.join("; ")}`);
      fs.writeFileSync(path.join(workspace, "src", "App.tsx"), source, "utf8");
      writeStarterTemplate(workspace, "prompt-contract-matrix");
      const build = spawnSync(process.execPath, [viteBin, "build", "--emptyOutDir"], {
        cwd: workspace,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, NODE_ENV: "production" },
      });
      const output = `${build.stdout || ""}${build.stderr || ""}`;
      assert.equal(build.status, 0, `Prompt ${index + 1} failed production build: ${output}`);
      assert.ok(fs.existsSync(path.join(workspace, "dist", "index.html")), `Prompt ${index + 1} produced no preview entrypoint`);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
