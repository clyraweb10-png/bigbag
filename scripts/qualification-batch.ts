import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeQualificationRunId } from "../src/lib/qualification-run";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const { getGenerationModelDiagnostics, localAgentEngine } = require("../src/lib/local-orchestrator/agent-engine") as typeof import("../src/lib/local-orchestrator/agent-engine");
const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { generationValidationIssues } = require("../src/lib/local-orchestrator/generation-validator") as typeof import("../src/lib/local-orchestrator/generation-validator");
const { localProjectStore, persistentPreviewPath } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");

type Status = "PASS" | "PARTIAL" | "FAIL" | "BLOCKED";
type QualificationCategory = "FULL_STACK" | "DESIGNER" | "ECOMMERCE" | "CHAOS";

interface QualificationCase {
  id: number;
  name: string;
  prompt: string;
  edit: string;
  requiresAuth: boolean;
  requiresApi?: boolean;
  visualReferenceUrl?: string;
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

const additionalFullStack = [
  "Analytics Dashboard", "Customer Portal", "Appointment Scheduling", "Fitness Tracker",
  "Healthcare Appointment Administration", "Travel Booking", "Property Management",
  "Warehouse Operations", "Subscription Management", "Payment Administration", "CMS",
  "Blog Editor", "Knowledge Base", "Help Center", "Recruitment Pipeline", "Sales Pipeline",
  "Collaboration Workspace", "File Document Workflow", "Notification Center", "Audit Log Dashboard",
  "API Key Management", "Webhook Management", "Multi-Tenant Organization Platform",
  "RBAC Administration", "Customer Support Dashboard", "Client Portal",
  "Education Administration", "Marketing Campaign Dashboard", "Product Analytics",
  "Production B2B SaaS",
];

const designerProjects = [
  "Premium SaaS Landing Page", "AI Startup Landing Page", "Developer Platform Landing Page",
  "Fintech Landing Page", "Design Agency Portfolio", "Creative Studio Portfolio",
  "Photographer Portfolio", "Architecture Portfolio", "Fashion Brand Website",
  "Luxury Hotel Website", "Startup Marketing Site", "Personal Portfolio", "Product Launch Page",
  "Typography Editorial Site", "Dark Mode Technology Landing Page",
  "Colorful Consumer Brand Landing Page", "Minimalist Portfolio", "Animated Agency Site",
  "Mobile First Startup Landing Page", "High End Designer Showcase",
];

const ecommerceProjects = [
  "Fashion Store", "Electronics Store", "Furniture Store", "Beauty Store", "Grocery Store",
  "Sneaker Store", "Luxury Fashion Store", "Jewelry Store", "Sports Equipment Store",
  "Home Decor Store", "Pet Store", "Baby Products Store", "Books Store", "Digital Products Store",
  "Subscription Box Store", "Multi-Vendor Marketplace", "Food Delivery Catalog",
  "Restaurant Ordering Store", "B2B Wholesale Store", "Complex Ecommerce Platform",
];

const chaosProjects = [
  "AI Travel Planner Booking Dashboard", "SaaS Marketplace Subscriptions",
  "Social Community Events Payments", "CRM Analytics Webhook Integration",
  "LMS Marketplace Multi-Role Auth", "Restaurant Delivery Loyalty",
  "Real Estate CRM Document Workflow", "Ecommerce AI Assistant Analytics",
  "Project Management Billing Collaboration", "Novel Operations Exchange",
];

additionalFullStack.forEach((name, index) => {
  const id = 21 + index;
  CASES.push({
    id,
    name,
    requiresAuth: true,
    requiresApi: /API|Webhook|Payment|Notification|Analytics|Travel/i.test(name),
    edit: `Add a persisted, keyboard-accessible filter to the ${name.toLowerCase()} primary workflow and preserve all existing data.`,
    prompt: `Build a production ${name} application with real Supabase authentication, protected user data, owner-scoped durable CRUD, validation, loading, empty, not-found, unauthorized, network-failure and recovery states. Include a purposeful responsive desktop and mobile workflow, accessible navigation and forms, and no simulated provider success. ${SECURITY_CONTRACT}`,
  });
});

const visualReferences = [
  "https://stripe.com/", "https://linear.app/", "https://basecamp.com/", "https://www.apple.com/",
  "https://mailchimp.com/",
];

designerProjects.forEach((name, index) => {
  const id = 51 + index;
  CASES.push({
    id,
    name,
    requiresAuth: false,
    visualReferenceUrl: visualReferences[index % visualReferences.length],
    edit: `Refine the ${name.toLowerCase()} mobile navigation and hero typography without changing its information architecture.`,
    prompt: `Create an original ${name} with deliberate typography, a distinctive non-template palette, strong hierarchy, conversion-aware sections, semantic HTML, visible focus states, reduced-motion support, touch targets, and layouts that remain usable from 320px through 1440px. Use the supplied reference only as high-level design inspiration; do not copy code, copy, branding, or proprietary assets. No fake forms or fabricated integrations.`,
  });
});

ecommerceProjects.forEach((name, index) => {
  const id = 71 + index;
  CASES.push({
    id,
    name,
    requiresAuth: true,
    requiresApi: true,
    edit: `Add persisted product search and category filtering to the ${name.toLowerCase()} while preserving cart quantities and order history.`,
    prompt: `Build a production ${name} with real Supabase authentication, owner-scoped customers and orders, durable products and inventory, product detail, variants, pricing, search, filters, sorting, cart quantity updates, honest checkout states, responsive UI, and complete CRUD where appropriate. Never claim payment success without a configured test-mode payment provider. ${SECURITY_CONTRACT}`,
  });
});

chaosProjects.forEach((name, index) => {
  const id = 91 + index;
  CASES.push({
    id,
    name,
    requiresAuth: true,
    requiresApi: true,
    edit: `Add a role-aware saved view to the ${name.toLowerCase()} and verify it survives refresh without weakening authorization.`,
    prompt: `Design and build an original production ${name} combining its domains into one coherent workflow. Use real Supabase authentication, protected owner-scoped durable CRUD, explicit role boundaries, responsive and accessible interaction, useful failure recovery, and honest unavailable states for every unconfigured external service. Do not simulate payments, connectors, AI output, or backend data. ${SECURITY_CONTRACT}`,
  });
});

if (CASES.length !== 100 || new Set(CASES.map((item) => item.id)).size !== 100) {
  throw new Error(`Qualification catalogue must contain exactly 100 unique projects; found ${CASES.length}`);
}

const batch = Number(process.env.BIGBAG_QUALIFICATION_BATCH || "1");
if (!Number.isInteger(batch) || batch < 1 || batch > 10) {
  throw new Error("BIGBAG_QUALIFICATION_BATCH must be an integer from 1 through 10");
}
const requestedProjects = new Set(
  (process.env.BIGBAG_QUALIFICATION_PROJECTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))
);
const selected = CASES.slice((batch - 1) * 10, batch * 10)
  .filter((item) => requestedProjects.size === 0 || requestedProjects.has(item.id));
if (selected.length === 0) throw new Error("No projects were selected inside the requested batch");
const concurrency = Math.min(2, Math.max(1, Number.parseInt(process.env.BIGBAG_QUALIFICATION_CONCURRENCY || "1", 10) || 1));
const runId = normalizeQualificationRunId(process.env.BIGBAG_QUALIFICATION_RUN_ID || Date.now().toString(36));
if (!runId) throw new Error("BIGBAG_QUALIFICATION_RUN_ID must contain letters or numbers");
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

function categoryFor(id: number): QualificationCategory {
  if (id <= 50) return "FULL_STACK";
  if (id <= 70) return "DESIGNER";
  if (id <= 90) return "ECOMMERCE";
  return "CHAOS";
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

async function runPrompt(
  projectId: string,
  prompt: string,
  visualReferenceUrl?: string
): Promise<{ generationId: string; terminal: { status: Status; message: string } }> {
  await localAgentEngine.runPrompt(projectId, prompt, { displayPrompt: prompt, visualReferenceUrl });
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
  const priorCampaignAttempts = localProjectStore.findRecordsByProjectIdPrefix(requestedProjectId)
    .filter((record) => {
      if (record.projectId === requestedProjectId) return true;
      const suffix = record.projectId.slice(requestedProjectId.length + 1);
      return record.projectId.startsWith(`${requestedProjectId}-`) && /^\d+$/.test(suffix);
    })
    .map((record) => {
    const terminal = [...record.conversation].reverse().find((message) =>
      message.messageType === "finished" || message.messageType === "error"
    );
    const result = terminal?.generationEvent?.type === "generation_cancelled"
      ? "CANCELLED"
      : terminal?.messageType === "error"
        ? "FAIL"
        : terminal
          ? "PASS"
          : "BLOCKED";
    return {
      projectId: record.projectId,
      generationId: record.activeGenerationId || null,
      result,
      terminalMessage: terminal?.message || "Previous attempt did not persist a terminal event",
    };
    });
  const priorCampaignAttempt = priorCampaignAttempts.at(-1) || null;
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
    initial = await runPrompt(projectId, item.prompt, item.visualReferenceUrl);
  } catch (error) {
    initial = { generationId: localProjectStore.getRecord(projectId)?.activeGenerationId || "missing", terminal: { status: "FAIL", message: error instanceof Error ? error.message : String(error) } };
  }

  const recordAfterInitial = localProjectStore.getRecord(projectId);
  const initialModelDiagnostics = getGenerationModelDiagnostics(projectId, initial.generationId);
  const initialConversationLength = recordAfterInitial?.conversation.length || 0;
  const events = (recordAfterInitial?.conversation || []).flatMap((message) => message.generationEvent ? [message.generationEvent] : []);
  const initialLifecycleFailures = (recordAfterInitial?.conversation || [])
    .filter((message) => /failed|repair|correcting generated files/i.test(message.message))
    .map((message) => message.message);
  const initialProviderFailures = (initialModelDiagnostics?.failureCategories || [])
    .map((category) => `AI provider attempt failed: ${category}`);
  const priorAttemptFailures = priorCampaignAttempts
    .filter((attempt) => attempt.result !== "PASS")
    .map((attempt) => `Previous campaign attempt ${attempt.projectId} ${attempt.result.toLowerCase()}: ${attempt.terminalMessage}`);
  const firstAttemptFailures = [...priorAttemptFailures, ...initialProviderFailures, ...initialLifecycleFailures];
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

  const recordAfterEdit = localProjectStore.getRecord(projectId);
  const editModelDiagnostics = edit ? getGenerationModelDiagnostics(projectId, edit.generationId) : null;
  const editMessages = (recordAfterEdit?.conversation || []).slice(initialConversationLength);
  const editLifecycleFailures = editMessages
    .filter((message) => /failed|repair|correcting generated files/i.test(message.message))
    .map((message) => message.message);
  const editProviderFailures = (editModelDiagnostics?.failureCategories || [])
    .map((category) => `AI provider attempt failed: ${category}`);
  const editFirstAttemptFailures = [...editProviderFailures, ...editLifecycleFailures];
  const editEvents = edit
    ? (recordAfterEdit?.conversation || []).flatMap((message) =>
        message.generationEvent && message.generationEvent.generationId === edit.generationId
          ? [message.generationEvent]
          : []
      )
    : [];
  const editLifecyclePassed = Boolean(edit &&
    edit.generationId !== initial.generationId &&
    editEvents.some((event) => event.type === "file_updated") &&
    editEvents.some((event) => event.type === "build_completed" && event.status === "completed") &&
    editEvents.some((event) => event.type === "preview_ready" && event.status === "completed") &&
    editEvents.some((event) => event.type === "generation_completed" && event.status === "completed"));
  const category = categoryFor(item.id);
  const connectorName = category === "DESIGNER" ? "Firecrawl visual reference" : "Supabase PostgreSQL";
  const connector: Status = category === "DESIGNER"
    ? events.some((event) => event.type === "crawl_asset_received") ? "PASS" : "FAIL"
    : database.status === "PASS" ? "PARTIAL" : "FAIL";

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
  const finalGates = {
    generation: initial.terminal.status === "PASS",
    build: build === "PASS",
    runtime: runtime === "PASS",
    authentication: !item.requiresAuth || auth !== "FAIL",
    editLifecycle: editLifecyclePassed,
    connector: connector === "PASS",
    qualificationPersistence: true,
  };
  const final: Status = Object.values(finalGates).every(Boolean) ? "PARTIAL" : "FAIL";
  const evidence = {
    projectNumber: item.id,
    projectName: item.name,
    category,
    prompt: item.prompt,
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
      connector,
      api: item.requiresApi ? "BLOCKED" as Status : "PARTIAL" as Status,
      persistence: database.status === "PASS" ? "PARTIAL" as Status : "FAIL" as Status,
      edit: !edit
        ? "BLOCKED" as Status
        : editLifecyclePassed
          ? "PASS" as Status
          : edit.terminal.status === "BLOCKED"
            ? "BLOCKED" as Status
            : "FAIL" as Status,
      responsive: "BLOCKED" as Status,
      security: securityFindings.length === 0 && (!item.requiresAuth || hasRealAuthProvider) ? "PARTIAL" as Status : "FAIL" as Status,
      final,
    },
    initialTerminal: initial.terminal,
    priorCampaignAttempt,
    priorCampaignAttempts,
    modelDiagnostics: initialModelDiagnostics,
    finalGates,
    firstAttemptResult: firstAttemptFailures.length > 0 ? "FAIL" as Status : initial.terminal.status,
    firstAttemptFailures,
    edit: edit ? {
      generationId: edit.generationId,
      terminal: edit.terminal,
      firstAttemptResult: editFirstAttemptFailures.length > 0 ? "FAIL" as Status : edit.terminal.status,
      firstAttemptFailures: editFirstAttemptFailures,
      modelDiagnostics: editModelDiagnostics,
    } : null,
    editEventTypes: editEvents.map((event) => `${event.type}:${event.status}`),
    connector: {
      name: connectorName,
      status: connector,
      detail: category === "DESIGNER"
        ? "Explicit visual-reference crawl must be present in the generation event stream"
        : "Platform PostgreSQL CRUD passed; generated-app workflow participation still requires browser evidence",
    },
    deployment: recordAfterInitial?.deployment || null,
    eventTypes: events.map((event) => `${event.type}:${event.status}`),
    buildRepairMessages: initialLifecycleFailures,
    sourceFiles: files.map((file) => file.path).sort(),
    securityFindings,
    realAuthProviderDetected: hasRealAuthProvider,
    databaseProbe: database,
    qualificationPersistence: { status: "PASS" as Status, error: null as string | null },
  };
  const evidencePath = path.join(outputDir, `project-${String(item.id).padStart(2, "0")}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  try {
    await durableProjectStore.saveQualificationEvidence(runId, evidence);
  } catch (error) {
    evidence.finalGates.qualificationPersistence = false;
    evidence.statuses.final = "FAIL";
    evidence.qualificationPersistence = {
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.stdout.write(`QUALIFICATION_END project=${item.id} result=${evidence.statuses.final} generation=${initial.terminal.status} build=${build} auth=${auth} security=${evidence.statuses.security}\n`);
  return evidence;
}

async function main() {
  if (process.env.BIGBAG_QUALIFICATION_LIST_ONLY === "true") {
    const manifest = CASES.map((item) => ({
      ...item,
      category: categoryFor(item.id),
    }));
    fs.writeFileSync(path.join(outputDir, "catalog.json"), `${JSON.stringify({ runId, projects: manifest }, null, 2)}\n`);
    process.stdout.write(`QUALIFICATION_CATALOG_COMPLETE projects=${manifest.length} output=${path.relative(workspaceRoot, outputDir)}\n`);
    return;
  }
  const results = [];
  for (let index = 0; index < selected.length; index += concurrency) {
    const group = selected.slice(index, index + concurrency);
    for (const item of group) {
      const evidencePath = path.join(outputDir, `project-${String(item.id).padStart(2, "0")}.json`);
      if (fs.existsSync(evidencePath)) {
        const archiveDir = path.join(outputDir, "attempts");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(
          evidencePath,
          path.join(archiveDir, `project-${String(item.id).padStart(2, "0")}-${Date.now()}-${randomUUID()}.json`)
        );
      }
    }
    const settled = await Promise.allSettled(group.map(qualify));
    settled.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        const item = group[resultIndex];
        process.exitCode = 1;
        process.stderr.write(`QUALIFICATION_PROJECT_FAILED project=${item.id} error=${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
      }
    });
  }
  const batchResults = CASES.slice((batch - 1) * 10, batch * 10).flatMap((item) => {
    const evidencePath = path.join(outputDir, `project-${String(item.id).padStart(2, "0")}.json`);
    return fs.existsSync(evidencePath) ? [JSON.parse(fs.readFileSync(evidencePath, "utf8"))] : [];
  });
  fs.writeFileSync(path.join(outputDir, `batch-${batch}.json`), `${JSON.stringify({ runId, batch, results: batchResults }, null, 2)}\n`);
  process.stdout.write(`QUALIFICATION_BATCH_COMPLETE batch=${batch} output=${path.relative(workspaceRoot, outputDir)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`QUALIFICATION_BATCH_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
