import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const { localAgentEngine } = require("../src/lib/local-orchestrator/agent-engine") as typeof import("../src/lib/local-orchestrator/agent-engine");
const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { generationValidationIssues } = require("../src/lib/local-orchestrator/generation-validator") as typeof import("../src/lib/local-orchestrator/generation-validator");
const { localProjectStore, persistentPreviewPath } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");

type Status = "PASS" | "PARTIAL" | "FAIL" | "BLOCKED";

interface QualificationCase {
  id: number;
  name: string;
  prompt: string;
  edit: string;
  requiresAuth: boolean;
  requiresApi?: boolean;
}

const SECURITY_CONTRACT = `Use real supported authentication and server/database authorization when requested. Never implement password hashing or comparison in browser code, never store credentials or session records in the project CRUD datastore, never use browser storage as the authority for authentication, never expose secrets, and never simulate a connected backend. Enforce ownership outside the browser. Use actual persisted CRUD with loading, empty, validation, unauthorized, not-found, network-failure, and error states. Keep the application single-page unless the requested workflow genuinely requires routes.`;

const CASES: QualificationCase[] = [
  { id: 1, name: "SaaS Project Management", requiresAuth: true, edit: "Make the dashboard header darker without changing behavior.", prompt: `Build a production project-management SaaS with signup, login, logout, persistent sessions, protected routes, organizations, projects, tasks, project CRUD, task CRUD, ownership, and a responsive team dashboard. Use a focused productivity-workstation design with compact navigation, useful tables and calm indigo/ink accents. ${SECURITY_CONTRACT}` },
  { id: 2, name: "CRM", requiresAuth: true, edit: "Add a contact search field that filters the persisted contact list.", prompt: `Build a production CRM with real authentication, contacts, companies, notes, contact CRUD, search, filters, persistence, and backend-enforced user isolation. Use a dense sales-workstation design with a pipeline, table/detail views, legible hierarchy, and responsive navigation. Explicitly support a cross-user denial test. ${SECURITY_CONTRACT}` },
  { id: 3, name: "Invoicing SaaS", requiresAuth: true, edit: "Add an overdue invoice filter without changing totals.", prompt: `Build a production invoicing SaaS with real authentication, customers, invoices, invoice items, exact subtotal/tax/total calculations, statuses, CRUD, and persistence. Use a restrained finance-product design with tabular numerals, print-aware invoice detail, and responsive tables. ${SECURITY_CONTRACT}` },
  { id: 4, name: "Booking Application", requiresAuth: true, edit: "Add a reschedule action that preserves double-booking protection.", prompt: `Build a production booking application with real users, services, availability, booking creation, cancellation, status, persistence, and backend-enforced double-booking protection. Use a calm scheduling design with calendar/date selection, availability slots, confirmation and mobile-first forms. ${SECURITY_CONTRACT}` },
  { id: 5, name: "LMS", requiresAuth: true, edit: "Add course search while preserving enrollment and progress.", prompt: `Build a production LMS with real authentication, courses, lessons, enrollment, progress, protected user data, persistence, and ownership. Use a focused learning design with course navigation, lesson reader, progress cues, and responsive student views. ${SECURITY_CONTRACT}` },
  { id: 6, name: "Job Board", requiresAuth: true, edit: "Add a location filter to the jobs view.", prompt: `Build a production job board with real users, companies, jobs, applications, search, filters, CRUD, persistence, and backend-enforced applicant/company ownership. Use a clear recruiting-product design with job list/detail and application state. ${SECURITY_CONTRACT}` },
  { id: 7, name: "Restaurant Reservation", requiresAuth: true, edit: "Add party-size filtering to availability.", prompt: `Build a production restaurant reservation app with customer accounts, restaurant tables, availability, reservations, cancellation, persistence, and backend conflict handling. Use a hospitality-specific date/time booking experience rather than a generic dashboard. ${SECURITY_CONTRACT}` },
  { id: 8, name: "Inventory Management", requiresAuth: false, edit: "Add a low-stock filter to the inventory table.", prompt: `Build a production inventory manager with products, categories, inventory, stock updates, complete CRUD, a useful dashboard, persisted data, and refresh recovery. Use a warehouse-operations design with dense but mobile-usable tables and clear stock states. ${SECURITY_CONTRACT}` },
  { id: 9, name: "Expense Tracker", requiresAuth: true, edit: "Add a merchant search field without changing monthly totals.", prompt: `Build a production expense tracker with real authentication, expenses, categories, monthly totals calculated from stored records, complete CRUD, filters, persistence, and ownership. Use a precise personal-finance design with responsive charts and transaction tables. ${SECURITY_CONTRACT}` },
  { id: 10, name: "Support Ticket System", requiresAuth: true, edit: "Add an urgent-priority filter for agents.", prompt: `Build a production support system with real users, tickets, comments, statuses, priorities, agent/customer roles, protected data, persistence, and backend role authorization. Use an efficient support-inbox design with queue/detail composition. ${SECURITY_CONTRACT}` },
  { id: 11, name: "Social Community", requiresAuth: true, edit: "Add post search while preserving comments and likes.", prompt: `Build a production social community with real users, profiles, posts, comments, likes, CRUD, authentication, ownership, and persistence. Use a community-specific feed/profile design with honest empty and moderation-aware states. ${SECURITY_CONTRACT}` },
  { id: 12, name: "Event Management", requiresAuth: false, edit: "Add attendee search to event management.", prompt: `Build a production event-management app with events, attendees, registration, cancellation, event CRUD, database persistence, and refresh recovery. Use an event-operations design with schedule, attendee list, and responsive registration flow. ${SECURITY_CONTRACT}` },
  { id: 13, name: "Real Estate", requiresAuth: true, edit: "Add a bedrooms filter to listing search.", prompt: `Build a production real-estate app with listings, agents, search, filters, favorites, inquiries, CRUD, persistence, authentication, and backend ownership. Use a photography-led property search/detail experience with agent contact and responsive filters. ${SECURITY_CONTRACT}` },
  { id: 14, name: "Multi-role HR", requiresAuth: true, edit: "Add a pending-leave filter for HR.", prompt: `Build a production HR application with real admin, HR, and employee roles; employees, departments, leave requests, approvals, protected routes, persistence, and backend role enforcement. Use a sober people-operations design with directory and approval queue. ${SECURITY_CONTRACT}` },
  { id: 15, name: "Document Management", requiresAuth: true, edit: "Add document-name search inside the current folder.", prompt: `Build a production document manager with real authentication, folders, documents, actual uploads, metadata, ownership, deletion, persistence, and protected storage access. Use a file-workspace design with folder tree, list/detail, upload progress and honest failures. ${SECURITY_CONTRACT}` },
  { id: 16, name: "AI Chat Application", requiresAuth: true, requiresApi: true, edit: "Add conversation search without changing message history.", prompt: `Build a production AI chat app with real authentication, conversations, messages, persistent history, refresh recovery, and streaming only when a real server AI boundary is configured. Never fake AI replies. Use a focused conversation workspace with history navigation and message states. ${SECURITY_CONTRACT}` },
  { id: 17, name: "Kanban", requiresAuth: false, edit: "Add card search while preserving drag and drop.", prompt: `Build a production Kanban app with boards, columns, cards, complete CRUD, working drag and drop, persisted moves, and refresh recovery. Use a tactile board design with mobile-accessible move controls in addition to drag. ${SECURITY_CONTRACT}` },
  { id: 18, name: "Ecommerce", requiresAuth: true, requiresApi: true, edit: "Add product search without changing cart state.", prompt: `Build a production ecommerce app with products, details, cart, customers, orders, checkout architecture, database persistence, authentication, and ownership. Do not claim payment success without a real Stripe test connection. Use an image-led commerce design with responsive cart and honest checkout states. ${SECURITY_CONTRACT}` },
  { id: 19, name: "API Integration Dashboard", requiresAuth: true, requiresApi: true, edit: "Add a retry action to the API error state.", prompt: `Build a production authenticated external-API dashboard using a real public API, with a secure server boundary where secrets would be required, real network calls, loading/error/empty/success states, useful data display, and appropriate persistence. Never fabricate responses. Use an operations-dashboard design. ${SECURITY_CONTRACT}` },
  { id: 20, name: "Complex Full-Stack SaaS", requiresAuth: true, requiresApi: true, edit: "Add notification search while preserving every existing feature.", prompt: `Build a production full-stack SaaS combining real authentication, organizations, roles, dashboard, CRUD, database, actual file upload, real API integration, search, filters, notifications, settings, protected routes, ownership, and responsive UI. Use a coherent enterprise-workspace design and no simulated capability. ${SECURITY_CONTRACT}` },
];

const batch = Number(process.env.BIGBAG_QUALIFICATION_BATCH || "1");
if (![1, 2, 3, 4].includes(batch)) throw new Error("BIGBAG_QUALIFICATION_BATCH must be 1, 2, 3, or 4");
const requestedProjects = new Set(
  (process.env.BIGBAG_QUALIFICATION_PROJECTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))
);
const selected = CASES.slice((batch - 1) * 5, batch * 5)
  .filter((item) => requestedProjects.size === 0 || requestedProjects.has(item.id));
if (selected.length === 0) throw new Error("No projects were selected inside the requested batch");
const runId = (process.env.BIGBAG_QUALIFICATION_RUN_ID || Date.now().toString(36)).replace(/[^a-z0-9-]/gi, "-");
const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
const outputDir = path.join(workspaceRoot, "output", "bigbag-qualification", runId);
fs.mkdirSync(outputDir, { recursive: true });

function sourceFiles(projectId: string): Array<{ path: string; content: string }> {
  const root = localProjectStore.getWorkspaceDir(projectId);
  const files: Array<{ path: string; content: string }> = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(?:tsx?|jsx?|css|json)$/.test(entry.name)) {
        files.push({ path: path.relative(root, full).replaceAll(path.sep, "/"), content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

async function waitForGeneration(projectId: string, generationId: string): Promise<{ status: Status; message: string }> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const record = localProjectStore.getRecord(projectId);
    const terminal = [...(record?.conversation || [])].reverse().find((message) =>
      (message.messageType === "finished" || message.messageType === "error") &&
      message.generationEvent?.generationId === generationId
    );
    if (record?.status === "done" && terminal) {
      return { status: terminal.messageType === "error" ? "FAIL" : "PASS", message: terminal.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { status: "BLOCKED", message: "Generation did not reach a terminal state within 15 minutes" };
}

async function runPrompt(projectId: string, prompt: string): Promise<{ generationId: string; terminal: { status: Status; message: string } }> {
  await localAgentEngine.runPrompt(projectId, prompt, { displayPrompt: prompt });
  const generationId = localProjectStore.getRecord(projectId)?.activeGenerationId;
  if (!generationId) throw new Error("Generation started without a persisted generation id");
  return { generationId, terminal: await waitForGeneration(projectId, generationId) };
}

async function databaseProbe(projectId: string): Promise<{ status: Status; detail: string }> {
  const collection = "qualification_probe";
  try {
    const created = await durableProjectStore.createAppRecord(projectId, collection, { value: "created" });
    const read = await durableProjectStore.getAppRecord(projectId, collection, created._id);
    const updated = await durableProjectStore.updateAppRecord(projectId, collection, created._id, { value: "updated" });
    const deleted = await durableProjectStore.deleteAppRecord(projectId, collection, created._id);
    const afterDelete = await durableProjectStore.getAppRecord(projectId, collection, created._id);
    const passed = read?.value === "created" && updated?.value === "updated" && deleted && afterDelete === null;
    return { status: passed ? "PASS" : "FAIL", detail: passed ? "CREATE/READ/UPDATE/DELETE verified in durable PostgreSQL" : "Durable CRUD returned inconsistent values" };
  } catch (error) {
    return { status: "FAIL", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function qualify(item: QualificationCase) {
  const requestedProjectId = `qualification-p${String(item.id).padStart(2, "0")}-${runId}`.slice(0, 120);
  const tenantId = randomUUID();
  const projectId = localProjectStore.create({
    projectId: requestedProjectId,
    tenantId,
    label: `Qualification ${String(item.id).padStart(2, "0")} - ${item.name}`,
    description: item.prompt,
  }).projectId;
  process.stdout.write(`QUALIFICATION_START project=${item.id} id=${projectId}\n`);

  let initial: { generationId: string; terminal: { status: Status; message: string } };
  try {
    initial = await runPrompt(projectId, item.prompt);
  } catch (error) {
    initial = { generationId: localProjectStore.getRecord(projectId)?.activeGenerationId || "missing", terminal: { status: "FAIL", message: error instanceof Error ? error.message : String(error) } };
  }

  const recordAfterInitial = localProjectStore.getRecord(projectId);
  const events = (recordAfterInitial?.conversation || []).flatMap((message) => message.generationEvent ? [message.generationEvent] : []);
  const files = sourceFiles(projectId);
  const modelOwnedFiles = files.filter((file) => !["src/lib/db.ts", "src/lib/auth.ts", "src/main.tsx"].includes(file.path));
  const securityFindings = generationValidationIssues(modelOwnedFiles, files.map((file) => file.path), { requireEntrypoint: false })
    .filter((issue) => /password|authentication|authorization|browser storage|server-only secret|service role/i.test(issue));
  const hasRealAuthProvider = modelOwnedFiles.some((file) => /from\s+["']@\/lib\/auth["']|firebase\/auth|@auth0\//.test(file.content));
  const deploymentIndex = await durableProjectStore.readDeploymentFile(projectId, "index.html").catch(() => null);
  const database = await databaseProbe(projectId);

  let edit: { generationId: string; terminal: { status: Status; message: string } } | null = null;
  if (initial.terminal.status === "PASS") {
    try {
      edit = await runPrompt(projectId, item.edit);
    } catch (error) {
      edit = { generationId: localProjectStore.getRecord(projectId)?.activeGenerationId || "missing", terminal: { status: "FAIL", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  const auth: Status = !item.requiresAuth
    ? "PARTIAL"
    : securityFindings.length > 0
      ? "FAIL"
      : hasRealAuthProvider
        ? "PARTIAL"
        : "FAIL";
  const buildVerified = recordAfterInitial?.deployment?.status === "success" && events.some((event) =>
    (event.type === "build_completed" || event.type === "validation_completed") && event.status === "completed"
  );
  const build: Status = buildVerified ? "PASS" : initial.terminal.status === "BLOCKED" ? "BLOCKED" : "FAIL";
  const runtime: Status = deploymentIndex && events.some((event) => event.type === "preview_ready" && event.status === "completed") ? "PASS" : "FAIL";
  const final: Status = initial.terminal.status === "PASS" && build === "PASS" && runtime === "PASS" && (!item.requiresAuth || auth !== "FAIL") && edit?.terminal.status === "PASS" ? "PARTIAL" : "FAIL";
  const evidence = {
    projectNumber: item.id,
    projectName: item.name,
    projectId,
    generationId: initial.generationId,
    route: persistentPreviewPath(projectId),
    statuses: {
      generation: initial.terminal.status,
      planning: "PARTIAL" as Status,
      codeGeneration: initial.terminal.status,
      files: files.length > 0 ? "PASS" as Status : "FAIL" as Status,
      dependencies: "PARTIAL" as Status,
      typescript: build,
      build,
      runtime,
      preview: runtime,
      database: database.status,
      authentication: auth,
      crud: database.status === "PASS" ? "PARTIAL" as Status : "FAIL" as Status,
      api: item.requiresApi ? "BLOCKED" as Status : "PARTIAL" as Status,
      persistence: database.status === "PASS" ? "PARTIAL" as Status : "FAIL" as Status,
      edit: edit?.terminal.status || "BLOCKED",
      responsive: "BLOCKED" as Status,
      security: securityFindings.length === 0 && (!item.requiresAuth || hasRealAuthProvider) ? "PARTIAL" as Status : "FAIL" as Status,
      final,
    },
    initialTerminal: initial.terminal,
    edit: edit ? { generationId: edit.generationId, terminal: edit.terminal } : null,
    deployment: recordAfterInitial?.deployment || null,
    eventTypes: events.map((event) => `${event.type}:${event.status}`),
    buildRepairMessages: (recordAfterInitial?.conversation || []).filter((message) => /failed|repair|correcting/i.test(message.message)).map((message) => message.message),
    sourceFiles: files.map((file) => file.path).sort(),
    securityFindings,
    realAuthProviderDetected: hasRealAuthProvider,
    databaseProbe: database,
  };
  fs.writeFileSync(path.join(outputDir, `project-${String(item.id).padStart(2, "0")}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`QUALIFICATION_END project=${item.id} result=${final} generation=${initial.terminal.status} build=${build} auth=${auth} security=${evidence.statuses.security}\n`);
  return evidence;
}

async function main() {
  const results = [];
  for (const item of selected) results.push(await qualify(item));
  fs.writeFileSync(path.join(outputDir, `batch-${batch}.json`), `${JSON.stringify({ runId, batch, results }, null, 2)}\n`);
  process.stdout.write(`QUALIFICATION_BATCH_COMPLETE batch=${batch} output=${path.relative(workspaceRoot, outputDir)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`QUALIFICATION_BATCH_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
