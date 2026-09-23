import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client as PgClient } from "pg";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-lifecycle-"));
process.env.NEXT_PUBLIC_APP_URL = "https://builder.example.test";
const testDatabase = new PgClient({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const { persistentPreviewUrl, localProjectStore } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");
const { extractFirecrawlImageUrls, extractWebsiteUrl } = require("../src/lib/local-orchestrator/firecrawl-design") as typeof import("../src/lib/local-orchestrator/firecrawl-design");
const { parseReferenceDesignSpecification, runReferenceAnalysis } = require("../src/lib/local-orchestrator/reference-analysis") as typeof import("../src/lib/local-orchestrator/reference-analysis");
const { approvedBuildInstruction, classifyIntent } = require("../src/lib/local-orchestrator/intent-router") as typeof import("../src/lib/local-orchestrator/intent-router");
const { normalizePlannerText, parsePlannerOutput } = require("../src/lib/local-orchestrator/planner-output") as typeof import("../src/lib/local-orchestrator/planner-output");
const { EMPTY_PROJECT_CONTEXT, mergeProjectContext, parseOnboardingOutput, projectContextForPrompt, questionAlreadyAnswered } = require("../src/lib/local-orchestrator/onboarding-context") as typeof import("../src/lib/local-orchestrator/onboarding-context");
const { CHAT_PROMPT, PLANNER_PROMPT, REFINE_PROMPT, plannerPromptForIntent } = require("../src/lib/local-orchestrator/planner-prompts") as typeof import("../src/lib/local-orchestrator/planner-prompts");
const {
  consumePreviewGuestMutationBudget,
  createPreviewWriteCapability,
  isPreviewInitiatedRequest,
  openPreviewAuthStorage,
  sealPreviewAuthStorage,
  verifyPreviewWriteCapability,
} = require("../src/lib/local-orchestrator/tenant-context") as typeof import("../src/lib/local-orchestrator/tenant-context");
const {
  appendContinuationChunk,
  GEMINI_MAX_RETRIES,
  multiModelRouter,
  publicModelName,
} = require("../src/lib/local-orchestrator/multi-model-router") as typeof import("../src/lib/local-orchestrator/multi-model-router");
const { generatedSourcesRequireEndUserAuth, hasRealGeneratedSource, isSourceBuildFailure, isBuildResourceFailure, localAgentEngine, mergeGeneratedActions, postProcessGeneratedFiles, stripGeneratedApplyRules } = require("../src/lib/local-orchestrator/agent-engine") as typeof import("../src/lib/local-orchestrator/agent-engine");
const {
  GENERATED_AUTH_BRIDGE_SOURCE,
  GENERATED_AUTH_CLIENT_SOURCE,
  GENERATED_DB_CLIENT_SOURCE,
  LEGACY_GENERATED_DB_CLIENT_SOURCE,
  legacyStarterLayoutSource,
  legacyStarterPageSource,
  writeStarterTemplate,
} = require("../src/lib/local-orchestrator/starter-template") as typeof import("../src/lib/local-orchestrator/starter-template");
const { generationValidationIssues } = require("../src/lib/local-orchestrator/generation-validator") as typeof import("../src/lib/local-orchestrator/generation-validator");
const { GENERATED_RUNTIME_CHECK_SCRIPT } = require("../src/lib/local-orchestrator/runtime-validator") as typeof import("../src/lib/local-orchestrator/runtime-validator");
const { buildPexelsSearchPlan, resolvePexelsImagery } = require("../src/lib/local-orchestrator/pexels-imagery") as typeof import("../src/lib/local-orchestrator/pexels-imagery");
const { proxy } = require("../src/proxy") as typeof import("../src/proxy");
const { isProtectedPagePath, safeAuthReturnPath } = require("../src/lib/auth-redirect") as typeof import("../src/lib/auth-redirect");
const { createAuthSession, isCloudOperator, verifyAuthSession } = require("../src/lib/auth-session") as typeof import("../src/lib/auth-session");
const { NextRequest } = require("next/server") as typeof import("next/server");
type LocalProjectRecord = import("../src/lib/local-orchestrator/types").LocalProjectRecord;

function record(tenantId: string, projectId = "durable-demo"): LocalProjectRecord {
  const now = new Date().toISOString();
  return {
    projectId,
    tenantId,
    label: "Durable demo",
    description: "Lifecycle test",
    createdAt: now,
    lastModifiedAt: now,
    port: 3001,
    status: "done",
    serverStatus: "Active",
    conversation: [],
  };
}

test("source and deployment survive sandbox loss while the preview URL stays stable", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const project = record(tenantId);
  const workspace = path.join(tempRoot, "workspace");
  fs.mkdirSync(path.join(workspace, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "app", "page.tsx"), "export default () => <main>v1</main>;");
  fs.writeFileSync(path.join(workspace, "package.json"), '{"scripts":{"build":"vite build"}}');

  await durableProjectStore.saveSource(project, workspace);
  project.deployment = { status: "success", createdAt: new Date().toISOString(), versionId: "build-v1" };
  project.productionProjectUrl = persistentPreviewUrl(project.projectId);
  await durableProjectStore.saveDeployment(project, [
    { path: "index.html", content: Buffer.from("<main>deployed-v1</main>") },
    { path: "assets/app.js", content: Buffer.from("console.log('v1')") },
  ]);

  const stableUrl = persistentPreviewUrl(project.projectId);
  fs.rmSync(workspace, { recursive: true, force: true });
  const restoredCount = await durableProjectStore.restoreSource(project.projectId, tenantId, workspace);
  assert.equal(restoredCount, 2);
  assert.match(fs.readFileSync(path.join(workspace, "src", "app", "page.tsx"), "utf8"), /v1/);

  // A failed staged restore must leave the current workspace and ignored runtime
  // directories untouched. These contradictory paths force a staging write error.
  fs.mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "node_modules", "sentinel"), "keep");
  let hasSymlink = false;
  try {
    fs.symlinkSync(tempRoot, path.join(workspace, "untrusted-link"));
    hasSymlink = true;
  } catch {
    // Windows non-elevated environments disallow symlink creation
  }
  fs.writeFileSync(path.join(workspace, "src", "app", "page.tsx"), "local-workspace-remains");
  await testDatabase.connect().catch(() => {});
  await testDatabase.query(
    `INSERT INTO builder_project_files (project_id, tenant_id, kind, path, content, updated_at)
     VALUES ($1, $2, 'source', $3, $4, $5)`,
    [project.projectId, tenantId, "collision", Buffer.from("file"), new Date().toISOString()]
  );
  await testDatabase.query(
    `INSERT INTO builder_project_files (project_id, tenant_id, kind, path, content, updated_at)
     VALUES ($1, $2, 'source', $3, $4, $5)`,
    [project.projectId, tenantId, "collision/child.txt", Buffer.from("child"), new Date().toISOString()]
  );
  await assert.rejects(() => durableProjectStore.restoreSource(project.projectId, tenantId, workspace));
  assert.equal(fs.readFileSync(path.join(workspace, "src", "app", "page.tsx"), "utf8"), "local-workspace-remains");
  assert.equal(fs.readFileSync(path.join(workspace, "node_modules", "sentinel"), "utf8"), "keep");
  if (hasSymlink) {
    assert.equal(fs.lstatSync(path.join(workspace, "untrusted-link")).isSymbolicLink(), true);
  }
  await testDatabase.query(
    "DELETE FROM builder_project_files WHERE project_id = $1 AND kind = 'source' AND path LIKE 'collision%'",
    [project.projectId]
  );
  assert.equal(await durableProjectStore.restoreSource(project.projectId, tenantId, workspace), 2);
  assert.equal(fs.readFileSync(path.join(workspace, "node_modules", "sentinel"), "utf8"), "keep");
  if (hasSymlink) {
    assert.equal(fs.existsSync(path.join(workspace, "untrusted-link")), false);
  }

  const artifact = await durableProjectStore.readDeploymentFile(project.projectId, "index.html");
  assert.equal(Buffer.from(artifact!.content).toString("utf8"), "<main>deployed-v1</main>");

  fs.mkdirSync(path.join(workspace, "public", "uploads"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "public", "uploads", "logo.txt"), "durable-upload");
  await durableProjectStore.saveSource(project, workspace);
  const upload = await durableProjectStore.readPublicSourceFile(project.projectId, "public/uploads/logo.txt");
  assert.equal(Buffer.from(upload!.content).toString("utf8"), "durable-upload");

  // Simulate a later edit after the original E2B id is gone. The build version
  // changes, but routing remains the same project-specific Render URL.
  project.sandboxId = undefined;
  project.deployment.versionId = "build-v2";
  await durableProjectStore.saveDeployment(project, [
    { path: "index.html", content: Buffer.from("<main>deployed-v2</main>") },
  ]);
  assert.equal(persistentPreviewUrl(project.projectId), stableUrl);
  const updated = await durableProjectStore.readDeploymentFile(project.projectId, "index.html");
  assert.equal(Buffer.from(updated!.content).toString("utf8"), "<main>deployed-v2</main>");
});

test("tenant ownership prevents reads, overwrites, and deletes across users", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const attacker = "22222222-2222-4222-8222-222222222222";
  const projectId = "isolation-demo";
  const ownerRecord = record(owner, projectId);
  await durableProjectStore.saveDeployment(ownerRecord, [
    { path: "index.html", content: Buffer.from("owner deployment") },
  ]);

  assert.equal(await durableProjectStore.loadRecord(projectId, attacker), null);
  await assert.rejects(() => durableProjectStore.saveRecord(record(attacker, projectId)), /another tenant/);
  await assert.rejects(
    () => durableProjectStore.saveDeployment(record(attacker, projectId), [
      { path: "index.html", content: Buffer.from("attacker replacement") },
    ]),
    /another tenant/
  );
  const ownerDeployment = await durableProjectStore.readDeploymentFile(projectId, "index.html");
  assert.equal(Buffer.from(ownerDeployment!.content).toString("utf8"), "owner deployment");
  assert.equal(await durableProjectStore.remove(projectId, attacker), false);
  assert.ok(await durableProjectStore.loadRecord(projectId, owner));
  assert.equal(await durableProjectStore.remove(projectId, owner), true);
});

test("website URL detection is explicit and strips chat punctuation", () => {
  assert.equal(
    extractWebsiteUrl("Recreate this layout: https://example.com/products?view=grid, but use original copy."),
    "https://example.com/products?view=grid"
  );
  assert.equal(extractWebsiteUrl("Build a portfolio without a reference URL"), null);
  assert.equal(extractWebsiteUrl("use javascript:alert(1)"), null);
});

test("Firecrawl visual assets are real HTTPS results, deduplicated, and screenshot-first", () => {
  assert.deepEqual(
    extractFirecrawlImageUrls(
      [
        "https://assets.example.test/hero.webp",
        { src: "https://assets.example.test/logo.svg" },
        { url: "javascript:alert(1)" },
        "https://assets.example.test/hero.webp",
      ],
      { url: "https://crawl.example.test/page.png" }
    ),
    [
      "https://crawl.example.test/page.png",
      "https://assets.example.test/hero.webp",
      "https://assets.example.test/logo.svg",
    ]
  );
});

test("intent routing keeps conversation separate from planning and code edits", () => {
  assert.equal(classifyIntent("hi", "idle"), "chat");
  assert.equal(classifyIntent("Hi, build me a responsive CRM app", "idle"), "plan");
  assert.equal(classifyIntent("Can you build me a responsive CRM app?", "idle"), "plan");
  assert.equal(classifyIntent("How can I build a responsive CRM app?", "idle"), "chat");
  assert.equal(classifyIntent("Could you explain how to create a private database for each user? I am asking for an explanation, not asking you to create or edit a project.", "idle"), "chat");
  assert.equal(classifyIntent("Could you explain how I can fix the header?", "active"), "chat");
  assert.equal(classifyIntent("Can you fix the header overlap?", "active"), "direct_edit");
  assert.equal(classifyIntent("proceed", "idle"), "chat");
  assert.equal(classifyIntent("portfolio website", "idle"), "plan");
  assert.equal(classifyIntent("recreate https://example.com", "idle"), "plan");
  assert.equal(classifyIntent("recreate it from this reference", "idle"), "plan");
  assert.equal(classifyIntent("do not build it", "awaiting_confirmation"), "update_plan");
  assert.equal(classifyIntent("should we proceed?", "awaiting_confirmation"), "chat");
  assert.equal(classifyIntent("Proceed!", "awaiting_confirmation"), "confirm_build");
  assert.equal(classifyIntent("thanks", "awaiting_confirmation"), "chat");
  assert.equal(classifyIntent("add a pricing page", "awaiting_confirmation"), "update_plan");
  assert.equal(classifyIntent("proceed", "awaiting_confirmation"), "confirm_build");
  assert.equal(classifyIntent("hello", "active"), "chat");
  assert.equal(classifyIntent("I like the direction", "active"), "chat");
  assert.equal(classifyIntent("change the navbar color", "active"), "direct_edit");
  assert.equal(classifyIntent("Adjust the TeamForge dashboard heading to a larger bold size and use a darker background behind it. Preserve all existing behavior.", "active"), "direct_edit");
  assert.equal(classifyIntent("Could you please explain how to adjust the dashboard heading?", "active"), "chat");
  assert.equal(classifyIntent("Can I adjust the dashboard heading myself?", "active"), "chat");
  assert.equal(classifyIntent("the header should be blue", "active"), "direct_edit");
  assert.equal(classifyIntent("I don't like the navbar", "active"), "direct_edit");
  assert.equal(classifyIntent("how can I change the navbar?", "active"), "chat");
  assert.match(approvedBuildInstruction([
    { author: "user", message: "Build a calm travel planner" },
    { author: "agent", message: "## Implementation Plan\n\n**Project:** Wayfinder" },
  ], "proceed"), /Build a calm travel planner[\s\S]*Wayfinder/);
  assert.match(approvedBuildInstruction([
    { author: "user", message: "Build a calm travel planner" },
    { author: "agent", message: "## Implementation Plan\n\n**Project:** Wayfinder v1" },
    { author: "user", message: "Make it work offline too" },
    { author: "agent", message: "## Implementation Plan\n\n**Project:** Wayfinder v2" },
  ], "proceed"), /1\. Build a calm travel planner[\s\S]*2\. Make it work offline too[\s\S]*Wayfinder v2/);
  assert.equal(approvedBuildInstruction([
    { author: "user", message: "Build a calm travel planner" },
    { author: "agent", message: "I can help with that." },
    { author: "user", message: "Make it work offline too" },
  ], "proceed"), "Build a calm travel planner\n\nMake it work offline too");
});

test("a cancelled generation rejects late worker events but keeps ordinary chat persistent", () => {
  const created = localProjectStore.create({
    tenantId: randomUUID(), projectId: `cancel-chat-${randomUUID().slice(0, 8)}`, description: "Cancellation regression",
  });
  const id = created.projectId;
  const at = new Date().toISOString();
  const cancelled = {
    author: "agent" as const, message: "Generation stopped", messageType: "finished" as const,
    createdAt: at, generationEvent: { type: "generation_cancelled" as const, status: "cancelled" as const },
  };
  try {
    localProjectStore.update(id, { status: "done", cancellationRequestedAt: at, conversation: [cancelled] });
    const late = {
      author: "agent" as const, message: "Preview ready", messageType: "building" as const,
      createdAt: at, generationEvent: { type: "preview_ready" as const, status: "completed" as const },
    };
    localProjectStore.update(id, { status: "done", conversation: [cancelled, late], previewUrl: "/should-not-exist" });
    assert.equal(localProjectStore.getRecord(id)?.conversation.length, 1);
    assert.equal(localProjectStore.getRecord(id)?.previewUrl, undefined);
    const chat = { author: "user" as const, message: "What is Supabase?", messageType: "regular" as const, createdAt: at };
    localProjectStore.update(id, { conversation: [cancelled, chat] });
    assert.equal(localProjectStore.getRecord(id)?.conversation.at(-1)?.message, chat.message);
  } finally {
    localProjectStore.remove(id);
  }
});

test("Stop aborts the active provider request and remains terminal", async () => {
  const originalComplete = multiModelRouter.complete;
  const originalGetProviders = multiModelRouter.getProviders;
  const tenantId = randomUUID();
  const created = localProjectStore.create({
    tenantId,
    projectId: `cancel-live-${randomUUID().slice(0, 8)}`,
    description: "Cancellation provider-abort regression",
  });
  const id = created.projectId;
  let providerAborted = false;

  (multiModelRouter as any).getProviders = () => [{
    id: "telnyx-glm",
    name: "Cancellation test provider",
    model: "zai-org/GLM-5.3-Flash",
  }];
  (multiModelRouter as any).complete = async (
    _messages: unknown,
    _status: unknown,
    options: { signal?: AbortSignal } = {}
  ) => new Promise((_resolve, reject) => {
    const abort = () => {
      providerAborted = true;
      reject(options.signal?.reason || new Error("aborted"));
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });

  try {
    await localAgentEngine.runPrompt(id, "Build an authenticated task app");
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      !localProjectStore.getRecord(id)?.conversation.some((message) =>
        message.generationEvent?.type === "file_generation_started"
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const generationId = localProjectStore.getRecord(id)?.activeGenerationId;
    assert.ok(generationId, "generation did not become active");
    assert.equal(await localAgentEngine.cancelPrompt(id, generationId), true);
    assert.equal(providerAborted, true, "provider request was not aborted");

    await new Promise((resolve) => setTimeout(resolve, 50));
    const record = localProjectStore.getRecord(id);
    const events = record?.conversation.flatMap((message) => message.generationEvent || []) || [];
    assert.equal(record?.status, "done");
    assert.equal(events.filter((event) => event.type === "generation_cancelled").length, 1);
    assert.equal(events.some((event) => event.type === "generation_completed"), false);
    assert.equal(events.some((event) => event.type === "preview_ready"), false);
    assert.equal(await localAgentEngine.cancelPrompt(id, generationId), false);
  } finally {
    (multiModelRouter as any).complete = originalComplete;
    (multiModelRouter as any).getProviders = originalGetProviders;
    localProjectStore.remove(id);
    await durableProjectStore.remove(id, tenantId).catch(() => undefined);
  }
});

test("planner output keeps generated suggestions separate from visible chat", () => {
  const raw = `A concise response.\n\n<!-- next-prompts\n["Make it calmer", "Add mobile navigation", "Use editorial typography", "Show a pricing view", "Add keyboard shortcuts", "Refine the color palette", "Plan the empty state", "Improve the onboarding", "Add a search flow", "Define the data model"]\n-->`;
  const output = parsePlannerOutput(raw);
  assert.equal(output.text, "A concise response.");
  assert.equal(output.suggestions.length, 10);
  assert.equal(output.suggestions[0], "Make it calmer");
  assert.deepEqual(parsePlannerOutput("Visible only"), { text: "Visible only", suggestions: [] });
  assert.equal(plannerPromptForIntent("chat"), CHAT_PROMPT);
  assert.equal(plannerPromptForIntent("plan"), PLANNER_PROMPT);
  assert.equal(plannerPromptForIntent("update_plan"), REFINE_PROMPT);
  assert.equal(plannerPromptForIntent("confirm_build"), null);
  assert.notEqual(PLANNER_PROMPT, CHAT_PROMPT);
  assert.notEqual(REFINE_PROMPT, CHAT_PROMPT);
  assert.match(PLANNER_PROMPT, /## Implementation Plan/);
  assert.match(REFINE_PROMPT, /complete replacement plan/i);
  assert.equal(normalizePlannerText("chat", "A concise response."), "A concise response.");
  assert.equal(
    normalizePlannerText("plan", "### Frontend\nBuild the responsive shell."),
    "## Implementation Plan\n\n### Frontend\nBuild the responsive shell.\n\nReady to build?"
  );
  assert.equal(
    normalizePlannerText("update_plan", "## Implementation Plan\n\nUpdated.\n\nReady to build?"),
    "## Implementation Plan\n\nUpdated.\n\nReady to build?"
  );
});

test("onboarding preserves known facts and accepts model-supplied palette directions", () => {
  const current = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
    projectType: "web-app",
    projectName: "TaskFlow",
    projectDescription: "A project management SaaS for small teams",
  });
  const analysis = parseOnboardingOutput(JSON.stringify({
    context: {
      projectType: "website",
      projectName: "Invented replacement",
      colourDirection: null,
    },
    nextQuestion: {
      kind: "colour_direction",
      title: "Which colour family feels right for TaskFlow?",
      description: "Choose a focused product direction.",
      placeholder: "Describe another direction",
      optional: false,
      requestProjectName: false,
      paletteChoices: [{
        id: "clear-focus",
        label: "Clear focus",
        description: "Calm product surfaces with a confident action colour",
        colours: ["#0F172A", "#F8FAFC", "#4F46E5"],
      }],
    },
  }), current);

  assert.equal(analysis.context.projectType, "web-app");
  assert.equal(analysis.context.projectName, "TaskFlow");
  assert.equal(analysis.nextQuestion?.title, "Which colour family feels right for your brand?");
  assert.equal(analysis.nextQuestion?.paletteChoices[0].colours[2], "#4F46E5");
  assert.match(projectContextForPrompt("Build TaskFlow", analysis.context), /Project name: TaskFlow/);
});

test("onboarding never repeats a skipped question and rejects unsafe swatch values", () => {
  const current = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
    skippedQuestions: ["colour_direction"],
  });
  const analysis = parseOnboardingOutput(JSON.stringify({
    context: {},
    nextQuestion: {
      kind: "colour_direction",
      title: "Which colour family feels right?",
      description: "Choose one",
      placeholder: "Custom",
      optional: true,
      requestProjectName: false,
      paletteChoices: [{
        id: "unsafe",
        label: "Unsafe",
        description: "Should not render",
        colours: ["url(javascript:alert(1))", "#FFFFFF", "#000000"],
      }],
    },
  }), current);
  assert.equal(analysis.nextQuestion, null);
});

test("onboarding identifies questions already answered by structured context", () => {
  const context = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
    projectType: "web-app",
    projectName: "TaskFlow",
    projectDescription: "A project manager for design teams",
    colourDirection: "Dark navy and electric violet",
    referenceUrl: "https://example.com/reference",
  });
  assert.equal(questionAlreadyAnswered(context, "project_type"), true);
  assert.equal(questionAlreadyAnswered(context, "project_details"), true);
  assert.equal(questionAlreadyAnswered(context, "colour_direction"), true);
  assert.equal(questionAlreadyAnswered(context, "reference_url"), true);
  const repeated = parseOnboardingOutput(JSON.stringify({
    context: {},
    nextQuestion: {
      kind: "project_type",
      title: "What kind of project?",
      description: "Choose one",
      placeholder: "Custom",
      optional: false,
      requestProjectName: false,
      paletteChoices: [],
    },
  }), context);
  assert.equal(repeated.nextQuestion, null);

  const selected = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
    paletteSelection: {
      id: "focus",
      label: "Focused blue",
      description: "Clear product surfaces",
      colours: ["#0F172A", "#F8FAFC", "#4F46E5"],
    },
  });
  assert.match(projectContextForPrompt("Build it", selected), /#0F172A, #F8FAFC, #4F46E5/);

  const incompleteCustom = mergeProjectContext(EMPTY_PROJECT_CONTEXT, { projectType: "custom" });
  assert.equal(questionAlreadyAnswered(incompleteCustom, "project_type"), false);
  const standard = mergeProjectContext(EMPTY_PROJECT_CONTEXT, {
    projectType: "website",
    customProjectType: "Desktop game",
  });
  assert.equal(standard.customProjectType, null);
});

test("generated Tailwind CSS cannot break previews with unsupported apply utilities", () => {
  const css = '@import "tailwindcss";\nbody {\n  @apply bg-background text-foreground;\n  margin: 0;\n}\n';
  assert.equal(stripGeneratedApplyRules(css), '@import "tailwindcss";\nbody {\n\n  margin: 0;\n}\n');
  assert.equal(stripGeneratedApplyRules('body { @apply bg-background; color: black; }'), 'body {  color: black; }');
  assert.equal(stripGeneratedApplyRules('.button { @apply rounded border px-4; }'), '.button { @apply rounded border px-4; }');
});

test("only proven source compilation failures can trigger model-based repair", () => {
  assert.equal(isSourceBuildFailure(new Error("Generated app failed to compile: unexpected token")), true);
  assert.equal(isBuildResourceFailure(new Error("Generated app failed to compile: Killed\nexit status 137")), true);
  assert.equal(isSourceBuildFailure(new Error("Generated app failed to compile: Killed\nexit status 137")), true);
  assert.equal(isSourceBuildFailure(new Error("Dependency installation failed: network timeout")), false);
  assert.equal(isSourceBuildFailure(new Error("Preview server did not become ready")), false);
  assert.equal(isSourceBuildFailure(new Error("Project persistence is temporarily unavailable")), false);
});

test("runtime-owned model output is discarded without poisoning a valid page", () => {
  const files = [
    {
      path: "src/app/layout.tsx",
      content: "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
    },
    {
      path: "src/app/page.tsx",
      content: "export default function Page() { return <main>Complete app</main>; }",
    },
    {
      path: "index.html",
      content: "<div id=\"root\"></div>",
    },
    {
      path: "src/app/layout.jsx",
      content: "export default function Layout({ children }) { return children; }",
    },
    {
      path: "src/lib/db.ts",
      content: "export { db } from '@invented/database-client';",
    },
  ];

  postProcessGeneratedFiles(files);

  assert.deepEqual(files.map((file) => file.path), ["src/app/page.tsx"]);
  assert.deepEqual(generationValidationIssues(files), []);
  assert.deepEqual(generationValidationIssues([{
    path: "src/App.tsx",
    content: 'import db from "@/lib/db"; export default function App() { void db; return <main>Complete app</main>; }',
  }], ["src/lib/db.ts"]), []);
});

test("fresh runtime scaffolding is not misclassified as a follow-up project", () => {
  assert.equal(hasRealGeneratedSource([
    { path: "index.html", content: '<div id="root"></div>' },
    { path: "src/main.tsx", content: "// @bigbag-runtime-entry\ncreateRoot(root).render(<App />);" },
    { path: "src/components/ui/button.tsx", content: "export function Button() { return <button />; }" },
  ]), false);
  assert.equal(hasRealGeneratedSource([
    { path: "src/App.tsx", content: "export default function App() { return <main>Built</main>; }" },
  ]), true);
  for (const entrypoint of ["src/app.tsx", "src/App.js", "app/page.tsx", "pages/index.tsx", "src/app/page.js"]) {
    assert.equal(hasRealGeneratedSource([
      { path: entrypoint, content: "export default function App() { return <main>Built</main>; }" },
    ]), true, `${entrypoint} must count as generated source`);
  }
});

test("generation retries keep only the latest file or deletion action per path", () => {
  const firstRetry = mergeGeneratedActions(
    [
      { path: "src/App.tsx", content: "old app" },
      { path: "src/components/Legacy.tsx", content: "legacy" },
    ],
    [],
    [{ path: "src/App.tsx", content: "new app" }],
    ["src/components/Legacy.tsx", "src/components/Recreated.tsx"]
  );
  assert.deepEqual(firstRetry.files, [{ path: "src/App.tsx", content: "new app" }]);
  assert.deepEqual([...firstRetry.deletions].sort(), [
    "src/components/Legacy.tsx",
    "src/components/Recreated.tsx",
  ]);

  const secondRetry = mergeGeneratedActions(
    firstRetry.files,
    firstRetry.deletions,
    [{ path: "src/components/Recreated.tsx", content: "export function Recreated() { return null; }" }],
    []
  );
  assert.deepEqual(secondRetry.files, [
    { path: "src/App.tsx", content: "new app" },
    {
      path: "src/components/Recreated.tsx",
      content: "export function Recreated() { return null; }",
    },
  ]);
  assert.deepEqual([...secondRetry.deletions], ["src/components/Legacy.tsx"]);

  const reorderedRetry = mergeGeneratedActions(
    [
      { path: "src/App.tsx", content: "old app" },
      { path: "src/components/Table.tsx", content: "old table" },
    ],
    [],
    [
      { path: "src/components/Table.tsx", content: "fixed table" },
      { path: "src/App.tsx", content: "fixed app" },
    ],
    []
  );
  assert.equal(reorderedRetry.files[0].path, "src/App.tsx");
});

test("React browser entrypoints retain or recover the createRoot import", () => {
  const files = [
    {
      path: "src/main.tsx",
      content: `import App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);`,
    },
    {
      path: "src/components/NestedRoot.tsx",
      content: `import { createRoot } from "react-dom/client";\nexport default function NestedRoot(){ return <main>One tree</main>; }`,
    },
  ];

  postProcessGeneratedFiles(files);

  assert.match(files[0].content, /import \{ createRoot \} from ["']react-dom\/client["']/);
  assert.match(files[0].content, /createRoot\(document\.getElementById/);
  assert.doesNotMatch(files[1].content, /react-dom\/client/);
});

test("post-processing places the application entrypoint before secondary files", () => {
  const files = [
    { path: "src/components/Card.tsx", content: `export function Card(){ return <div>Card</div>; }` },
    { path: "src/App.tsx", content: `export default function App(){ return <main>Ready</main>; }` },
  ];
  postProcessGeneratedFiles(files);
  assert.equal(files[0].path, "src/App.tsx");
  assert.equal(generationValidationIssues(files, [], { requireEntrypointFirst: true }).some((issue) => issue.includes("first generated")), false);

  const duplicateEntrypoints = [
    { path: "src/app/page.tsx", content: `export default function Page(){ return <main>Page</main>; }` },
    { path: "src/App.tsx", content: `export default function App(){ return <main>App</main>; }` },
  ];
  postProcessGeneratedFiles(duplicateEntrypoints);
  assert.deepEqual(duplicateEntrypoints.map((file) => file.path), ["src/App.tsx"]);
});

test("generated typographic punctuation is normalized before source validation", () => {
  const files = [{
    path: "src/App.tsx",
    content: `export default function App(){ return <main>“Ready” — loading…</main>; }`,
  }];
  postProcessGeneratedFiles(files);
  assert.match(files[0].content, />Ready - loading\.\.\.<\/main>/);
  assert.equal(generationValidationIssues(files).some((issue) => issue.includes("forbidden Unicode")), false);
});

test("generated apps must use the injected auth client contract", () => {
  const incompatible = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth";
export default async function App(){
  const { data } = await auth.getSession();
  const { error } = await auth.signIn("person@example.test", "not-a-secret");
  return <main>{data?.session?.user.email}{error?.message}</main>;
}`,
  }]);
  assert.ok(incompatible.some((issue) => issue.includes("destructures auth.getSession")));
  assert.ok(incompatible.some((issue) => issue.includes("destructures error from auth.signIn")));
  const aliasedError = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth"; export async function login(){ const { error: signInError } = await auth.signIn("person@example.test", "not-a-secret"); return signInError; }`,
  }]);
  assert.ok(aliasedError.some((issue) => issue.includes("destructures error from auth.signIn")));

  const compatible = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth";
export default async function App(){
  const current = await auth.getSession();
  try { await auth.signIn("person@example.test", "not-a-secret"); } catch (error) { void error; }
  return <main>{current?.user.email}</main>;
}`,
  }]);
  assert.equal(compatible.some((issue) => issue.includes("BigBag auth")), false);
});

test("starter runtime removes the hardcoded page and mounts generated source", () => {
  const workspace = path.join(tempRoot, `runtime-entry-${randomUUID()}`);
  writeStarterTemplate(workspace, "runtime-entry-test");

  assert.equal(fs.existsSync(path.join(workspace, "src/app/page.tsx")), false);
  assert.equal(fs.existsSync(path.join(workspace, "src/app/layout.tsx")), false);
  const initialMain = fs.readFileSync(path.join(workspace, "src/main.tsx"), "utf8");
  assert.match(initialMain, /import \{ createRoot \} from "react-dom\/client"/);
  assert.match(initialMain, /createRoot\(rootElement\)\.render\(<App \/>\)/);
  assert.doesNotMatch(initialMain, /StrictMode/);
  const index = fs.readFileSync(path.join(workspace, "index.html"), "utf8");
  assert.match(index, /<div id="root"><\/div>/);
  assert.match(index, /src="\/src\/main\.tsx"/);
  const viteConfig = fs.readFileSync(path.join(workspace, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /bigbag-direct-lucide-imports/);
  assert.match(viteConfig, /__bigbagLucideExistsSync\(modulePath\)/);
  assert.match(viteConfig, /retainedBindings\.push\(binding\)/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /@bigbag-managed-auth-client/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /clientPromise = null/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /authUnavailable = true/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /registerAuthTokenProvider\(getAuthAccessToken\)/);
  assert.match(GENERATED_AUTH_BRIDGE_SOURCE, /getPlatformAuthAccessToken/);
  assert.equal(
    fs.readFileSync(path.join(workspace, "src/lib/auth-bridge.ts"), "utf8"),
    GENERATED_AUTH_BRIDGE_SOURCE
  );
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /AuthChangeEvent/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /callback\.length >= 2/);

  const customAuthWorkspace = path.join(tempRoot, `runtime-custom-auth-${randomUUID()}`);
  writeStarterTemplate(customAuthWorkspace, "runtime-custom-auth-test");
  const customAuth = `export const auth = { getSession: async () => null };\n`;
  fs.writeFileSync(path.join(customAuthWorkspace, "src/lib/auth.ts"), customAuth);
  writeStarterTemplate(customAuthWorkspace, "runtime-custom-auth-test");
  assert.equal(fs.readFileSync(path.join(customAuthWorkspace, "src/lib/auth.ts"), "utf8"), customAuth);

  const migratedWorkspace = path.join(tempRoot, `runtime-vite-migration-${randomUUID()}`);
  writeStarterTemplate(migratedWorkspace, "runtime-vite-migration-test");
  fs.writeFileSync(
    path.join(migratedWorkspace, "vite.config.ts"),
    `import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const configDir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ plugins: [react()], resolve: { alias: { "@": path.resolve(configDir, "./src") } } });`
  );
  writeStarterTemplate(migratedWorkspace, "runtime-vite-migration-test");
  const migratedViteConfig = fs.readFileSync(path.join(migratedWorkspace, "vite.config.ts"), "utf8");
  assert.match(migratedViteConfig, /plugins: \[directLucideImports\(\), react\(\)\],\n\s*build: \{ minify: false }/);

  fs.writeFileSync(
    path.join(workspace, "src/App.tsx"),
    `export default function App(){ return <main>Generated application</main>; }`,
  );
  writeStarterTemplate(workspace, "runtime-entry-test");

  const generatedMain = fs.readFileSync(path.join(workspace, "src/main.tsx"), "utf8");
  assert.match(generatedMain, /import App from "\.\/App"/);
  assert.doesNotMatch(generatedMain, /Waiting for the first generated application/);

  fs.unlinkSync(path.join(workspace, "src/App.tsx"));
  fs.writeFileSync(
    path.join(workspace, "src/app.tsx"),
    `export default function App(){ return <main>Alternate generated entry</main>; }`,
  );
  writeStarterTemplate(workspace, "runtime-entry-test");
  assert.match(
    fs.readFileSync(path.join(workspace, "src/main.tsx"), "utf8"),
    /import App from "\.\/app"/,
  );

  const migrationWorkspace = path.join(tempRoot, `runtime-migration-${randomUUID()}`);
  writeStarterTemplate(migrationWorkspace, "runtime-migration-test");
  fs.writeFileSync(
    path.join(migrationWorkspace, "src/app/page.tsx"),
    `export default function Home(){ return <main>AI is assembling your application — Ready for Prompt, with user changes.</main>; }`,
  );
  fs.writeFileSync(path.join(migrationWorkspace, "src/index.css"), "body { color: rebeccapurple; }");
  fs.unlinkSync(path.join(migrationWorkspace, "src/app/globals.css"));
  writeStarterTemplate(migrationWorkspace, "runtime-migration-test");

  assert.equal(fs.existsSync(path.join(migrationWorkspace, "src/app/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(migrationWorkspace, "src/app/globals.css")), false);
  assert.match(
    fs.readFileSync(path.join(migrationWorkspace, "src/main.tsx"), "utf8"),
    /import "\.\/index\.css"/,
  );
  writeStarterTemplate(migrationWorkspace, "runtime-migration-test");
  assert.equal(fs.existsSync(path.join(migrationWorkspace, "src/app/globals.css")), false);
  assert.match(
    fs.readFileSync(path.join(migrationWorkspace, "src/main.tsx"), "utf8"),
    /import "\.\/index\.css"/,
  );
  assert.equal(
    fs.readFileSync(path.join(migrationWorkspace, "src/index.css"), "utf8"),
    "body { color: rebeccapurple; }",
  );

  const renamedWorkspace = path.join(tempRoot, `runtime-renamed-${randomUUID()}`);
  writeStarterTemplate(renamedWorkspace, "new-project-id");
  fs.writeFileSync(
    path.join(renamedWorkspace, "src/app/page.tsx"),
    legacyStarterPageSource("old-project-id"),
  );
  fs.writeFileSync(
    path.join(renamedWorkspace, "src/app/layout.tsx"),
    legacyStarterLayoutSource("old-project-id"),
  );
  fs.writeFileSync(
    path.join(renamedWorkspace, "src/App.tsx"),
    `export default function App(){ return <main>Renamed generated app</main>; }`,
  );
  writeStarterTemplate(renamedWorkspace, "new-project-id");
  assert.equal(fs.existsSync(path.join(renamedWorkspace, "src/app/page.tsx")), false);
  assert.equal(fs.existsSync(path.join(renamedWorkspace, "src/app/layout.tsx")), false);
  assert.match(
    fs.readFileSync(path.join(renamedWorkspace, "src/main.tsx"), "utf8"),
    /import App from "\.\/App"/,
  );
  assert.match(
    fs.readFileSync(path.join(renamedWorkspace, "src/main.tsx"), "utf8"),
    /document\.title = "new-project-id"/,
  );

  const legacyMainWorkspace = path.join(tempRoot, `runtime-legacy-main-${randomUUID()}`);
  writeStarterTemplate(legacyMainWorkspace, "legacy-main-test");
  fs.writeFileSync(
    path.join(legacyMainWorkspace, "src/App.tsx"),
    `export default function App(){ return <main>Legacy generated app</main>; }`,
  );
  writeStarterTemplate(legacyMainWorkspace, "legacy-main-test");
  const legacyMainPath = path.join(legacyMainWorkspace, "src/main.tsx");
  const legacyMain = fs.readFileSync(legacyMainPath, "utf8")
    .replace("// @bigbag-runtime-entry\n", "")
    .replace(
      'import { createRoot } from "react-dom/client";',
      'import React from "react";\nimport { createRoot } from "react-dom/client";',
    )
    .replace(
      `const rootElement = document.getElementById("root");\nif (!rootElement) throw new Error('Missing <div id="root"></div> in index.html');\n\n`,
      "",
    )
    .replace(
      "createRoot(rootElement).render(<App />);",
      `createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`,
    );
  fs.writeFileSync(legacyMainPath, legacyMain);
  writeStarterTemplate(legacyMainWorkspace, "legacy-main-test");
  const migratedLegacyMain = fs.readFileSync(legacyMainPath, "utf8");
  assert.match(migratedLegacyMain, /@bigbag-runtime-entry/);
  assert.match(migratedLegacyMain, /createRoot\(rootElement\)\.render\(<App \/>\)/);
  assert.doesNotMatch(migratedLegacyMain, /StrictMode/);

  const customMainWorkspace = path.join(tempRoot, `runtime-custom-main-${randomUUID()}`);
  writeStarterTemplate(customMainWorkspace, "custom-main-test");
  const customMainPath = path.join(customMainWorkspace, "src/main.tsx");
  const customizedMain = fs.readFileSync(customMainPath, "utf8")
    .replace("// @bigbag-runtime-entry\n", "")
    .concat("\nconsole.info('keep this custom runtime');\n");
  fs.writeFileSync(customMainPath, customizedMain);
  writeStarterTemplate(customMainWorkspace, "custom-main-test");
  assert.equal(fs.readFileSync(customMainPath, "utf8"), customizedMain);

  const customIndexWorkspace = path.join(tempRoot, `runtime-custom-index-${randomUUID()}`);
  writeStarterTemplate(customIndexWorkspace, "custom-index-test");
  const customIndexPath = path.join(customIndexWorkspace, "index.html");
  fs.writeFileSync(
    customIndexPath,
    `<!doctype html><html><head><meta name="custom" content="preserve-me"></head><body><main>Custom shell</main></body></html>`,
  );
  writeStarterTemplate(customIndexWorkspace, "custom-index-test");
  const repairedIndex = fs.readFileSync(customIndexPath, "utf8");
  assert.match(repairedIndex, /<meta name="custom" content="preserve-me">/);
  assert.match(repairedIndex, /<main>Custom shell<\/main>/);
  assert.match(repairedIndex, /<div id="root"><\/div>/);
  assert.match(repairedIndex, /<script type="module" src="\/src\/main\.tsx"><\/script>/);

  fs.writeFileSync(
    customIndexPath,
    `<!doctype html><html><body><div id="root"></div><script type="module" src="./src/bootstrap/client.tsx?v=2#app"></script></body></html>`,
  );
  fs.mkdirSync(path.join(customIndexWorkspace, "src/bootstrap"), { recursive: true });
  fs.writeFileSync(
    path.join(customIndexWorkspace, "src/bootstrap/client.tsx"),
    `document.getElementById("root").textContent = "Custom entry";`,
  );
  writeStarterTemplate(customIndexWorkspace, "custom-index-test");
  const compatibleIndex = fs.readFileSync(customIndexPath, "utf8");
  assert.match(compatibleIndex, /src="\.\/src\/bootstrap\/client\.tsx\?v=2#app"/);
  assert.doesNotMatch(compatibleIndex, /src="\/src\/main\.tsx"/);
  fs.unlinkSync(path.join(customIndexWorkspace, "src/bootstrap/client.tsx"));
  writeStarterTemplate(customIndexWorkspace, "custom-index-test");
  const staleEntryRepaired = fs.readFileSync(customIndexPath, "utf8");
  assert.doesNotMatch(staleEntryRepaired, /src="\.\/src\/bootstrap\/client\.tsx/);
  assert.match(staleEntryRepaired, /src="\/src\/main\.tsx"/);

  const commentedRuntimeWorkspace = path.join(tempRoot, `runtime-commented-${randomUUID()}`);
  writeStarterTemplate(commentedRuntimeWorkspace, "commented-runtime-test");
  const commentedIndexPath = path.join(commentedRuntimeWorkspace, "index.html");
  fs.writeFileSync(
    commentedIndexPath,
    `<!doctype html><html><body><!-- <div id="root"></div><script type="module" src="/src/main.tsx"></script> --></body></html>`,
  );
  writeStarterTemplate(commentedRuntimeWorkspace, "commented-runtime-test");
  const commentedRuntimeIndex = fs.readFileSync(commentedIndexPath, "utf8");
  assert.match(commentedRuntimeIndex, /<!-- <div id="root"><\/div><script type="module" src="\/src\/main\.tsx"><\/script> -->/);
  const activeRuntimeIndex = commentedRuntimeIndex.replace(/<!--[\s\S]*?-->/g, "");
  assert.match(activeRuntimeIndex, /<div id="root"><\/div>/);
  assert.match(activeRuntimeIndex, /<script type="module" src="\/src\/main\.tsx"><\/script>/);

  const compatibleIndexWorkspace = path.join(tempRoot, `runtime-compatible-index-${randomUUID()}`);
  writeStarterTemplate(compatibleIndexWorkspace, "compatible-index-test");
  const compatibleIndexPath = path.join(compatibleIndexWorkspace, "index.html");
  fs.writeFileSync(
    compatibleIndexPath,
    `<!doctype html><html><body><main id="root"></main><script type="module" src="src/main.tsx"></script></body></html>`,
  );
  writeStarterTemplate(compatibleIndexWorkspace, "compatible-index-test");
  const compatibleRuntimeIndex = fs.readFileSync(compatibleIndexPath, "utf8");
  assert.equal((compatibleRuntimeIndex.match(/\bid="root"/g) || []).length, 1);
  assert.match(compatibleRuntimeIndex, /<main id="root"><\/main>/);
  assert.match(compatibleRuntimeIndex, /<script type="module" src="src\/main\.tsx"><\/script>/);
  assert.doesNotMatch(compatibleRuntimeIndex, /src="\/src\/main\.tsx"/);

  const commentedBodyWorkspace = path.join(tempRoot, `runtime-commented-body-${randomUUID()}`);
  writeStarterTemplate(commentedBodyWorkspace, "commented-body-test");
  const commentedBodyIndexPath = path.join(commentedBodyWorkspace, "index.html");
  fs.writeFileSync(
    commentedBodyIndexPath,
    `<!doctype html><html><body><!-- disabled closing tag: </body> --></body></html>`,
  );
  writeStarterTemplate(commentedBodyWorkspace, "commented-body-test");
  const commentedBodyIndex = fs.readFileSync(commentedBodyIndexPath, "utf8");
  assert.match(commentedBodyIndex, /<!-- disabled closing tag: <\/body> -->/);
  const activeCommentedBodyIndex = commentedBodyIndex.replace(/<!--[\s\S]*?-->/g, "");
  assert.match(activeCommentedBodyIndex, /<div id="root"><\/div>/);
  assert.match(activeCommentedBodyIndex, /<script type="module" src="\/src\/main\.tsx"><\/script>/);

  const bodylessIndexWorkspace = path.join(tempRoot, `runtime-bodyless-${randomUUID()}`);
  writeStarterTemplate(bodylessIndexWorkspace, "bodyless-index-test");
  const bodylessIndexPath = path.join(bodylessIndexWorkspace, "index.html");
  fs.writeFileSync(
    bodylessIndexPath,
    `<!doctype html><html><body><main>Custom shell</main></html>`,
  );
  writeStarterTemplate(bodylessIndexWorkspace, "bodyless-index-test");
  const bodylessIndex = fs.readFileSync(bodylessIndexPath, "utf8");
  assert.match(bodylessIndex, /<div id="root"><\/div>/);
  assert.match(bodylessIndex, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
  assert.match(bodylessIndex, /<\/html>/);
});

test("generation validation rejects invented durable database methods", () => {
  const issues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `import db from "@/lib/db"; export default function Page(){ db.putMany?.("habits", []); return <main />; }`,
  }], ["src/lib/db.ts"]);
  assert.ok(issues.some((issue) => issue.includes("invents a database method")));
  const aliasedIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `import client from "@/lib/db"; const store = client; export default function Page(){ store.query?.("habits"); return <main />; }`,
  }], ["src/lib/db.ts"]);
  assert.ok(aliasedIssues.some((issue) => issue.includes("invents a database method")));
  const shadowedIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `import db from "@/lib/db"; function run(db: { query: () => void }) { db.query(); } export default function Page(){ return <main />; }`,
  }], ["src/lib/db.ts"]);
  assert.equal(shadowedIssues.some((issue) => issue.includes("invents a database method")), false);
});

test("generation validation rejects fake browser authentication and exposed server secrets", () => {
  const clientAuthIssues = generationValidationIssues([
    {
      path: "src/App.tsx",
      content: `export default function App(){ return <main>Sign in</main>; }`,
    },
    {
      path: "src/lib/auth.ts",
      content: `import db from "@/lib/db";
const users = db.collection("users");
async function hashPassword(password: string) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)); }
export async function signIn(password: string) { const passwordHash = await hashPassword(password); return users.list().then(({ records }) => records.find((user) => user.passwordHash === passwordHash)); }`,
    },
    {
      path: "src/store/session.ts",
      content: `export const loadSession = () => localStorage.getItem("auth.session.token");`,
    },
  ], ["src/lib/db.ts"]);
  assert.ok(clientAuthIssues.some((issue) => issue.includes("password hashing or comparison")));
  assert.ok(clientAuthIssues.some((issue) => issue.includes("project CRUD datastore as an authentication system")));
  assert.ok(clientAuthIssues.some((issue) => issue.includes("browser storage as an authentication authority")));

  const secretIssues = generationValidationIssues([
    {
      path: "src/App.tsx",
      content: `export default function App(){ return <main>{import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY}</main>; }`,
    },
    { path: ".env.example", content: "VITE_SUPABASE_SERVICE_ROLE_KEY=" },
  ]);
  assert.ok(secretIssues.some((issue) => issue.includes("server-only secret")));

  const ordinaryStorage = generationValidationIssues([{
    path: "src/App.tsx",
    content: `export default function App(){ localStorage.setItem("theme", "dark"); return <main>Ready</main>; }`,
  }]);
  assert.equal(ordinaryStorage.some((issue) => issue.includes("authentication authority")), false);
  const themeStorageWithAuth = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth"; localStorage.setItem("theme", "dark"); export const login = () => auth.signIn("person@example.test", "password");`,
  }]);
  assert.equal(themeStorageWithAuth.some((issue) => issue.includes("authentication authority")), false);

  const runtimeAuthImport = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth"; export default function App(){ return <button onClick={() => auth.signOut()}>Sign out</button>; }`,
  }], ["src/lib/auth.ts"]);
  assert.equal(runtimeAuthImport.some((issue) => issue.includes("missing local module")), false);
  assert.ok(generationValidationIssues([{
    path: "src/lib/auth.ts",
    content: `export const auth = {};`,
  }]).some((issue) => issue.includes("runtime-owned file")));

  const narrowEditIssues = generationValidationIssues([{
    path: "src/App.tsx",
    content: `export default function App(){ return <main className="bg-slate-950">Updated header</main>; }`,
  }], ["src/lib/auth.ts"], {
    existingSources: [{
      path: "src/lib/auth.ts",
      content: `export const restore = () => sessionStorage.getItem("access_token");`,
    }],
  });
  assert.ok(narrowEditIssues.some((issue) => issue.includes("browser storage as an authentication authority")));

  const inMemoryAuthIssues = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>Sign in</main>; }` },
    {
      path: "src/lib/auth.ts",
      content: `const profiles = new Map<string, { email: string }>(); export async function signUp(email: string) { profiles.set(email, { email }); } export async function signIn(email: string) { return profiles.get(email); }`,
    },
  ]);
  assert.ok(inMemoryAuthIssues.some((issue) => issue.includes("in-memory demo authentication")));
  const javascriptMapAuthIssues = generationValidationIssues([{
    path: "src/auth.js",
    content: `const users = new Map(); export function signIn(email) { return users.get(email); }`,
  }]);
  assert.ok(javascriptMapAuthIssues.some((issue) => issue.includes("in-memory demo authentication")));
  const providerWithUnrelatedMap = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth"; const filters = new Map(); export const login = () => auth.signIn("person@example.test", "password");`,
  }]);
  assert.equal(providerWithUnrelatedMap.some((issue) => issue.includes("in-memory demo authentication")), false);

  const relativeDbCredentialIssues = generationValidationIssues([{
    path: "src/lib/login.ts",
    content: `import db from "./db"; const users = db.collection("users"); export const signUp = (password: string) => users.create({ password });`,
  }]);
  assert.ok(relativeDbCredentialIssues.some((issue) => issue.includes("CRUD datastore as an authentication system")));
  const legitimateDbAndAuth = generationValidationIssues([{
    path: "src/App.tsx",
    content: `import db from "@/lib/db"; import { auth } from "@/lib/auth"; const tasks = db.collection("tasks"); export async function login(password: string) { await auth.signIn("person@example.test", password); await tasks.create({ title: "Ready" }); }`,
  }]);
  assert.equal(legitimateDbAndAuth.some((issue) => issue.includes("CRUD datastore as an authentication system")), false);

  const demoIdentityIssues = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>Jobs</main>; }` },
    {
      path: "src/components/IdentityPicker.tsx",
      content: `import { useState } from "react"; export function IdentityPicker({ onSelect }: { onSelect: (role: string) => void }) { const [role, setRole] = useState("candidate"); return <button onClick={() => { setRole("company"); onSelect(role); }}>Switch identity for this local demo; ownership is client-side</button>; }`,
    },
  ]);
  assert.ok(demoIdentityIssues.some((issue) => issue.includes("local demo identity or role switcher")));
});

test("generation validation rejects unrequested seed data but permits explicit seed requests", () => {
  const files = [
    { path: "src/App.tsx", content: `export default function App(){ return <main>Courses</main>; }` },
    { path: "src/lib/seed.ts", content: `export const courses = [{ title: "Demo course" }];` },
  ];
  assert.ok(generationValidationIssues(files).some((issue) => issue.includes("without an explicit user request")));
  assert.equal(generationValidationIssues(files, [], { allowSeedData: true }).some((issue) => issue.includes("seed or fixture data")), false);
  assert.ok(generationValidationIssues([{ path: "src/fixtures.json", content: "[]" }])
    .some((issue) => issue.includes("without an explicit user request")));
});

test("generation validation keeps authentication controlled by user intent", () => {
  const files = [{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth"; export default function App(){ return <button onClick={() => auth.signOut()}>Sign out</button>; }`,
  }];
  assert.ok(generationValidationIssues(files, ["src/lib/auth.ts"], { allowAuthentication: false })
    .some((issue) => issue.includes("did not request accounts")));
  assert.equal(generationValidationIssues(files, ["src/lib/auth.ts"], { allowAuthentication: true })
    .some((issue) => issue.includes("did not request accounts")), false);
  const relativeImport = [{
    path: "src/components/Login.tsx",
    content: `const auth = require("../lib/auth"); export const Login = () => auth.signIn();`,
  }];
  assert.ok(generationValidationIssues(relativeImport, ["src/lib/auth.ts"], { allowAuthentication: false })
    .some((issue) => issue.includes("did not request accounts")));
});

test("end-user auth state follows committed generated source and can be cleared", () => {
  assert.equal(generatedSourcesRequireEndUserAuth([{
    path: "src/App.tsx",
    content: `import { auth } from "@/lib/auth"; export default () => auth.getSession();`,
  }]), true);
  assert.equal(generatedSourcesRequireEndUserAuth([{
    path: "src/App.tsx",
    content: `export default function App(){ return <main>Public app</main>; }`,
  }]), false);
});

test("generation validation rejects broken imagery and fixed mobile shells", () => {
  const issues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `export default function Page(){ return <main className="min-w-[900px]"><img src="https://picsum.photos/800/600" /></main>; }`,
  }]);
  assert.ok(issues.some((issue) => issue.includes("without alt text")));
  assert.ok(issues.some((issue) => issue.includes("placeholder or random image")));
  assert.ok(issues.some((issue) => issue.includes("fixed minimum-width")));

  const sharedFallbackIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `export default function Page(){ return <main><img src="https://images.pexels.com/photo.jpeg" alt="Pottery studio" onError={(event) => event.currentTarget.naturalWidth > 0 && event.currentTarget.remove()} /></main>; }`,
  }]);
  assert.deepEqual(sharedFallbackIssues, []);

  const prefixedAttributeIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `export default function Page(){ return <main className="md:min-w-[640px]"><img src="/photo.jpg" data-alt="Not an accessible name" /></main>; }`,
  }]);
  assert.ok(prefixedAttributeIssues.some((issue) => issue.includes("without alt text")));
  assert.equal(prefixedAttributeIssues.some((issue) => issue.includes("fixed minimum-width")), false);

  const cssIssues = generationValidationIssues([
    { path: "src/app/page.tsx", content: "export default function Page(){ return <main>Ready</main>; }" },
    { path: "src/app/globals.css", content: "@import \"tailwindcss\"; body { min-width: 800px; }" },
  ]);
  assert.ok(cssIssues.some((issue) => issue.includes("fixed root minimum width")));

  const expressionShellIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `export default function Page(){ return <main data-ready={() => 1 > 0} className="min-w-[720px]">Ready</main>; }`,
  }]);
  assert.ok(expressionShellIssues.some((issue) => issue.includes("fixed minimum-width")));

  const mediaRootIssues = generationValidationIssues([
    { path: "src/app/page.tsx", content: "export default function Page(){ return <main>Ready</main>; }" },
    { path: "src/app/globals.css", content: "@import \"tailwindcss\"; @media (min-width: 40rem) { body { min-width: 800px; } }" },
  ]);
  assert.ok(mediaRootIssues.some((issue) => issue.includes("fixed root minimum width")));

  const expressionSourceIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `export default function Page(){ return <main className={\`min-w-[720px]\`}><img src={""} alt="Unavailable" /></main>; }`,
  }]);
  assert.ok(expressionSourceIssues.some((issue) => issue.includes("unresolved image source")));
  assert.ok(expressionSourceIssues.some((issue) => issue.includes("fixed minimum-width")));

  const nonRenderedMarkupIssues = generationValidationIssues([{
    path: "src/app/page.tsx",
    content: `const example = '<img src="" />'; /* <main className="min-w-[900px]" /> */ export default function Page(){ return <main>Ready</main>; }`,
  }]);
  assert.deepEqual(nonRenderedMarkupIssues, []);
});

test("generation validation enforces entrypoint, encoding, JSON, CSS, and env contracts", () => {
  const valid = generationValidationIssues([
    {
      path: "src/App.tsx",
      content: `export default function App(){ return <main>Ready</main>; }`,
    },
    {
      path: "src/app/globals.css",
      content: `@import "tailwindcss";\nbody { margin: 0; }`,
    },
    {
      path: "src/lib/config.ts",
      content: `export const apiUrl = import.meta.env.VITE_API_URL;`,
    },
    {
      path: ".env.example",
      content: `VITE_API_URL=`,
    },
  ], ["src/lib/db.ts"], { requireEntrypointFirst: true });
  assert.deepEqual(valid, []);

  const entrypointOrder = generationValidationIssues([
    { path: "src/components/Hero.tsx", content: `export function Hero(){ return <h1>Ready</h1>; }` },
    { path: "src/App.tsx", content: `export default function App(){ return <main>Ready</main>; }` },
  ], [], { requireEntrypointFirst: true });
  assert.ok(entrypointOrder.some((issue) => issue.includes("first generated file block")));

  const nestedRouteOnly = generationValidationIssues([{
    path: "src/app/settings/page.tsx",
    content: `export default function Settings(){ return <main>Settings</main>; }`,
  }]);
  assert.ok(nestedRouteOnly.some((issue) => issue.includes("missing required application entrypoint")));

  const duplicateEntrypoints = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>App</main>; }` },
    { path: "src/app/page.tsx", content: `export default function Page(){ return <main>Page</main>; }` },
  ]);
  assert.ok(duplicateEntrypoints.some((issue) => issue.includes("multiple application entrypoints")));

  const malformed = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>Bad\u2014copy</main>; }` },
    { path: "src/app/globals.css", content: `body { color: red;` },
    { path: "src/data.json", content: `{ "ok": true, }` },
    { path: "src/lib/config.ts", content: `export const secret = import.meta.env.VITE_MISSING;` },
  ]);
  assert.ok(malformed.some((issue) => issue.includes("U+2014")));
  assert.ok(malformed.some((issue) => issue.includes("invalid CSS")));
  assert.ok(malformed.some((issue) => issue.includes("invalid JSON")));
  assert.ok(malformed.some((issue) => issue.includes(".env.example is missing")));

  const existingEnvironment = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>Ready</main>; }` },
    { path: "src/lib/config.ts", content: `export const apiUrl = import.meta.env.VITE_API_URL;` },
  ], [".env.example"], { existingEnvironmentExample: "VITE_API_URL=" });
  assert.deepEqual(existingEnvironment, []);

  const undeclaredExistingEnvironment = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>Ready</main>; }` },
    { path: "src/lib/config.ts", content: `export const apiUrl = import.meta.env.VITE_NEW_API_URL;` },
  ], [".env.example"], { existingEnvironmentExample: "VITE_API_URL=" });
  assert.ok(undeclaredExistingEnvironment.some((issue) => issue.includes("does not declare")));

  const runtimeEnvironment = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>{import.meta.env.MODE}</main>; }` },
    { path: "src/lib/runtime.ts", content: `export const production = process.env.NODE_ENV === "production";` },
  ]);
  assert.deepEqual(runtimeEnvironment, []);

  const processBaseUrl = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>{process.env.BASE_URL}</main>; }` },
  ]);
  assert.ok(processBaseUrl.some((issue) => issue.includes("BASE_URL")));

  const unexposedViteVariable = generationValidationIssues([
    { path: "src/App.tsx", content: `export default function App(){ return <main>{import.meta.env.API_URL}</main>; }` },
    { path: ".env.example", content: "API_URL=" },
  ]);
  assert.ok(unexposedViteVariable.some((issue) => issue.includes("use a VITE_ prefix")));

  const unsupportedBigBagGlobal = generationValidationIssues([{
    path: "src/App.tsx",
    content: `export default function App(){ return <main>{__BIGBAG_DB__.items.length}</main>; }`,
  }]);
  assert.ok(unsupportedBigBagGlobal.some((issue) => issue.includes("unsupported runtime global __BIGBAG_DB__")));

  function* oneShotPaths() {
    yield "src/lib/db.ts";
  }
  const oneShotIterableIssues = generationValidationIssues([
    {
      path: "src/App.tsx",
      content: `import db from "@/lib/db"; export default function App(){ return <main>{String(db)}</main>; }`,
    },
  ], oneShotPaths());
  assert.deepEqual(oneShotIterableIssues, []);
});

test("Pexels sourcing is limited to image-forward prompts and returns real candidates", async () => {
  assert.deepEqual(buildPexelsSearchPlan("Build a B2B analytics dashboard"), []);
  const plan = buildPexelsSearchPlan("Build a warm modern restaurant for handmade pasta");
  assert.deepEqual(plan.map((entry) => entry.orientation), ["landscape", "square", "portrait"]);

  let calls = 0;
  const context = await resolvePexelsImagery("Build a warm modern restaurant for handmade pasta", {
    apiKey: "test-key",
    fetchImpl: (async (input: string | URL | Request) => {
      calls += 1;
      const requestUrl = new URL(String(input));
      const orientation = requestUrl.searchParams.get("orientation") || "landscape";
      return new Response(JSON.stringify({
        photos: [{
          id: calls,
          alt: `${orientation} restaurant scene`,
          avg_color: "#6b4f3a",
          photographer: "Test photographer",
          src: {
            large2x: `https://images.pexels.com/photos/${calls}/hero.jpeg`,
            portrait: `https://images.pexels.com/photos/${calls}/portrait.jpeg`,
            square: `https://images.pexels.com/photos/${calls}/square.jpeg`,
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
  assert.equal(calls, 3);
  assert.match(context || "", /\[PEXELS IMAGE CANDIDATES\]/);
  assert.match(context || "", /images\.pexels\.com/);

  let partialCalls = 0;
  const partialContext = await resolvePexelsImagery("Build a modern restaurant gallery", {
    apiKey: "test-key",
    fetchImpl: (async () => {
      partialCalls += 1;
      if (partialCalls === 2) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({
        photos: [{
          id: 100 + partialCalls,
          alt: "Restaurant interior",
          photographer: "Test photographer",
          src: { large2x: `https://images.pexels.com/photos/${100 + partialCalls}/hero.jpeg`, portrait: `https://images.pexels.com/photos/${100 + partialCalls}/portrait.jpeg`, square: `https://images.pexels.com/photos/${100 + partialCalls}/square.jpeg` },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
  assert.equal(partialCalls, 3);
  assert.match(partialContext || "", /\[PEXELS IMAGE CANDIDATES\]/);

  let failureCalls = 0;
  const recoveredContext = await resolvePexelsImagery("Build a modern restaurant gallery", {
    apiKey: "test-key",
    fetchImpl: (async () => {
      failureCalls += 1;
      if (failureCalls === 1) throw new Error("temporary network failure");
      if (failureCalls === 2) return new Response("not-json", { status: 200 });
      return new Response(JSON.stringify({
        photos: [{
          id: 303,
          alt: "Restaurant interior",
          photographer: "Test photographer",
          src: { large2x: "https://images.pexels.com/photos/303/hero.jpeg", portrait: "https://images.pexels.com/photos/303/portrait.jpeg", square: "https://images.pexels.com/photos/303/square.jpeg" },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
  assert.equal(failureCalls, 3);
  assert.match(recoveredContext || "", /photos\/303\/portrait\.jpeg/);
});

test("preview-originated browser requests cannot reach builder APIs", () => {
  const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as never;
  assert.equal(
    isPreviewInitiatedRequest(request({ referer: "https://builder.example.test/api/preview/demo/" })),
    true
  );
  assert.equal(
    isPreviewInitiatedRequest(request({ referer: "https://builder.example.test/project/demo" })),
    false
  );
  assert.equal(isPreviewInitiatedRequest(request({ origin: "null", "sec-fetch-site": "cross-site" })), true);
  assert.equal(isPreviewInitiatedRequest(request({ "sec-fetch-site": "same-origin" })), false);
  assert.equal(isPreviewInitiatedRequest(request({})), false);
});

test("proxy query parameters cannot grant preview document privileges", async () => {
  const publicPreview = await proxy(new NextRequest("https://builder.example.test/api/preview/demo/"));
  const editorPreview = await proxy(new NextRequest("https://builder.example.test/api/preview/demo/?editor=1"));
  const platform = await proxy(new NextRequest("https://builder.example.test/project/demo"));

  assert.equal(publicPreview.headers.get("content-security-policy"), null);
  assert.equal(editorPreview.headers.get("content-security-policy"), null);
  assert.equal(platform.headers.get("content-security-policy"), "frame-ancestors *");
});

test("signed auth sessions protect provider-backed APIs", async () => {
  const session = createAuthSession("test-user", 1_000_000);
  assert.equal(verifyAuthSession(session, 1_000_000)?.sub, "test-user");
  assert.equal(verifyAuthSession(`${session}x`, 1_000_000), null);
  assert.equal(verifyAuthSession(session, 1_000_000 + 8 * 24 * 60 * 60_000), null);

  const priorNodeEnv = process.env.NODE_ENV;
  const priorTenantSecret = process.env.TENANT_COOKIE_SECRET;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.TENANT_COOKIE_SECRET;
    assert.throws(() => createAuthSession("test-user"), /TENANT_COOKIE_SECRET is required/);
  } finally {
    if (priorNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", priorNodeEnv);
    if (priorTenantSecret === undefined) delete process.env.TENANT_COOKIE_SECRET;
    else process.env.TENANT_COOKIE_SECRET = priorTenantSecret;
  }

  const blocked = await proxy(new NextRequest("https://builder.example.test/api/planner"));
  assert.equal(blocked.status, 401);
  const allowed = await proxy(new NextRequest("https://builder.example.test/api/planner", {
    headers: { cookie: `bigbag_auth=${createAuthSession("test-user")}` },
  }));
  assert.equal(allowed.status, 200);

  const previousOperators = process.env.VCAAS_OPERATOR_UIDS;
  process.env.VCAAS_OPERATOR_UIDS = "another-user, test-user";
  try {
    assert.equal(isCloudOperator({ sub: "test-user", exp: Number.MAX_SAFE_INTEGER }), true);
    assert.equal(isCloudOperator({ sub: "not-enrolled", exp: Number.MAX_SAFE_INTEGER }), false);
  } finally {
    if (previousOperators === undefined) delete process.env.VCAAS_OPERATOR_UIDS;
    else process.env.VCAAS_OPERATOR_UIDS = previousOperators;
  }
});

test("authentication redirects preserve safe app destinations and reject open redirects", async () => {
  assert.equal(safeAuthReturnPath("/project/demo?tab=code#editor"), "/project/demo?tab=code#editor");
  assert.equal(safeAuthReturnPath("https://attacker.example/path"), "/dashboard");
  assert.equal(safeAuthReturnPath("//attacker.example/path"), "/dashboard");
  assert.equal(safeAuthReturnPath("/\\attacker.example/path"), "/dashboard");
  assert.equal(safeAuthReturnPath("/api/vcaas/projects"), "/dashboard");
  assert.equal(safeAuthReturnPath("/api"), "/dashboard");
  assert.equal(safeAuthReturnPath("/login"), "/dashboard");
  assert.equal(safeAuthReturnPath("/login/continue"), "/dashboard");
  assert.equal(isProtectedPagePath("/dashboard"), true);
  assert.equal(isProtectedPagePath("/generate"), true);
  assert.equal(isProtectedPagePath("/project/demo"), true);
  assert.equal(isProtectedPagePath("/pricing"), false);

  const blocked = await proxy(new NextRequest("https://builder.example.test/project/demo?tab=code"));
  assert.equal(blocked.status, 307);
  assert.equal(
    blocked.headers.get("location"),
    "https://builder.example.test/login?next=%2Fproject%2Fdemo%3Ftab%3Dcode"
  );

  const allowed = await proxy(new NextRequest("https://builder.example.test/dashboard", {
    headers: { cookie: `bigbag_auth=${createAuthSession("test-user")}` },
  }));
  assert.equal(allowed.status, 200);
});

test("Gemini is first and GLM-5.3-Flash is the fallback", () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.TELNYX_API_KEY = "test-telnyx";
  try {
    assert.deepEqual(multiModelRouter.getProviders().map((provider) => provider.id), [
      "gemini-flash",
      "telnyx-glm",
    ]);
    assert.equal(multiModelRouter.getProviders()[0].maxRetries, 5);
    assert.equal(GEMINI_MAX_RETRIES, 5);
  } finally {
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("token-limited model output continues, merges safely, and keeps provider identity private", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = "test-gemini";
  delete process.env.TELNYX_API_KEY;
  const statuses: string[] = [];
  const requestBodies: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
  let requestCount = 0;

  global.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body || "{}")));
    requestCount += 1;
    if (requestCount === 1) {
      return Response.json({
        choices: [{
          finish_reason: "length",
          message: { content: "<section>continuation-boundary" },
        }],
      });
    }
    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: "continuation-boundary-complete</section>" },
      }],
    });
  }) as typeof fetch;

  try {
    const result = await multiModelRouter.complete(
      [{ role: "user", content: "Build the complete page" }],
      (status) => statuses.push(status),
      { perProviderTimeoutMs: 2_000, totalTimeoutMs: 5_000 }
    );
    assert.equal(result.text, "<section>continuation-boundary-complete</section>");
    assert.equal(result.publicModelName, "AI");
    assert.equal(requestCount, 2);
    assert.match(requestBodies[1].messages?.at(-1)?.content || "", /Continue exactly/);
    assert.ok(statuses.some((status) => status.includes("Continuing generation")));
    assert.ok(statuses.every((status) => !/Gemini|gemini-2\.5|Google/i.test(status)));
    assert.equal(publicModelName("telnyx-glm"), "AI");
    assert.equal(
      appendContinuationChunk("0123456789abcdefghijkl", "6789abcdefghijkl-complete"),
      "0123456789abcdefghijkl-complete"
    );
    assert.equal(
      appendContinuationChunk("0123456789abcdefghijkl", "0123456789abcdefghijkl"),
      "0123456789abcdefghijkl"
    );
  } finally {
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("provider exhaustion and failover statuses keep provider identity private", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.TELNYX_API_KEY = "test-telnyx";
  const statuses: string[] = [];
  global.fetch = (async () => Response.json(
    { error: { message: "invalid test credential" } },
    { status: 401 }
  )) as typeof fetch;

  try {
    await assert.rejects(
      multiModelRouter.complete(
        [{ role: "user", content: "Build" }],
        (status) => statuses.push(status),
        { perProviderTimeoutMs: 2_000, totalTimeoutMs: 5_000 }
      ),
      (error: Error) => {
        assert.equal(error.name, "ProviderExhaustedError");
        assert.doesNotMatch(error.message, /Gemini|Telnyx|gemini-2\.5|GLM-5\.3/i);
        return true;
      }
    );
    assert.deepEqual(statuses, [
      "Generating the implementation…",
      "Continuing generation…",
      "Generating the implementation…",
    ]);
  } finally {
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("specialized vision requests stay on the required provider and preserve image inputs", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.TELNYX_API_KEY = "test-telnyx";
  const requestedUrls: string[] = [];
  let requestBody: { messages?: Array<{ content?: unknown }> } = {};

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrls.push(String(input));
    requestBody = JSON.parse(String(init?.body || "{}"));
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: "Observed a structured hero and compact navigation." } }],
    });
  }) as typeof fetch;

  try {
    const result = await multiModelRouter.complete(
      [{
        role: "user",
        content: [
          { type: "text", text: "Analyze this real reference." },
          { type: "image_url", image_url: { url: "https://assets.example.test/reference.png" } },
        ],
      }],
      undefined,
      { onlyProviderId: "telnyx-glm", perProviderTimeoutMs: 2_000, totalTimeoutMs: 5_000 }
    );
    assert.equal(result.providerId, "telnyx-glm");
    assert.equal(requestedUrls.length, 1);
    assert.deepEqual(requestBody.messages?.[0]?.content, [
      { type: "text", text: "Analyze this real reference." },
      { type: "image_url", image_url: { url: "https://assets.example.test/reference.png" } },
    ]);
  } finally {
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("reference analysis falls back to metadata without retrying non-retryable multimodal requests", async () => {
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousFetch = global.fetch;
  process.env.TELNYX_API_KEY = "test-telnyx";
  delete process.env.GEMINI_API_KEY;
  const requestImageCounts: number[] = [];
  const validSpecification = {
    reference_url: "https://example.test/",
    design_summary: "A restrained editorial landing page with a centered content column.",
    layout: { header: "Compact horizontal nav", hero: "Centered headline", sections: "Stacked content bands", footer: "Minimal link row" },
    colors: { primary: "#111111", secondary: "#555555", background: "#ffffff", text: "#111111", accent: "#3366ff" },
    typography: { heading_style: "Bold sans serif", body_style: "Readable system sans", scale: "Large display with compact body" },
    spacing: { section_spacing: "64px", container_width: "1120px", grid_gap: "24px" },
    components: ["navigation", "hero"],
    images: ["full-page screenshot"],
    responsive_behavior: ["Collapse navigation on small screens"],
    implementation_notes: ["Preserve generous whitespace"],
  };

  global.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const content = body.messages?.[0]?.content || [];
    const imageCount = Array.isArray(content)
      ? content.filter((part: { type?: string }) => part.type === "image_url").length
      : 0;
    requestImageCounts.push(imageCount);
    if (imageCount > 0) {
      return Response.json({ error: { message: "multimodal image_url input is unsupported" } }, { status: 400 });
    }
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validSpecification) } }],
    });
  }) as typeof fetch;

  try {
    const result = await runReferenceAnalysis({
      sourceUrl: "https://example.test/",
      context: "compact context",
      referencePackage: {
        referenceUrl: "https://example.test/",
        metadata: { title: "Example" },
        relevantText: "A small amount of relevant copy.",
        branding: "{}",
        designInformation: "{}",
        assets: [
          { url: "https://assets.example.test/page.png", role: "screenshot", selected: true },
          { url: "https://assets.example.test/hero.jpg", role: "hero", selected: true },
        ],
      },
      screenshotUrl: "https://assets.example.test/page.png",
      imageUrls: ["https://assets.example.test/page.png", "https://assets.example.test/hero.jpg"],
      selectedImages: [
        { url: "https://assets.example.test/page.png", role: "screenshot", contentType: "image/png", sizeBytes: 1_000 },
        { url: "https://assets.example.test/hero.jpg", role: "hero", contentType: "image/jpeg", sizeBytes: 2_000 },
      ],
      assetUrls: ["https://assets.example.test/page.png", "https://assets.example.test/hero.jpg"],
      rawImageCount: 2,
      approximateCrawlPayloadSize: 4_000,
    });
    assert.deepEqual(requestImageCounts, [2, 1, 0]);
    assert.equal(result.diagnostics.fallbackMode, "metadata_only");
    assert.equal(result.specification.reference_url, "https://example.test/");
    assert.match(result.implementationContext, /VALIDATED REFERENCE DESIGN SPECIFICATION/);
  } finally {
    global.fetch = previousFetch;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
  }
});

test("reference design schema rejects incomplete output", () => {
  assert.throws(
    () => parseReferenceDesignSpecification('{"design_summary":"too small"}', "https://example.test/"),
    /missing required/
  );
});

test("plain-text overloads retry and repeated continuations cannot produce false success", async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousTelnyx = process.env.TELNYX_API_KEY;
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = "test-gemini";
  delete process.env.TELNYX_API_KEY;
  let requestCount = 0;

  global.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) return new Response("upstream proxy overloaded", { status: 503 });
    if (requestCount === 2) {
      return Response.json({
        choices: [{ finish_reason: "length", message: { content: "0123456789abcdefghijkl" } }],
      });
    }
    if (requestCount === 3) {
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: "0123456789abcdefghijkl" } }],
      });
    }
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: "recovered without false success" } }],
    });
  }) as typeof fetch;

  try {
    const result = await multiModelRouter.complete(
      [{ role: "user", content: "Build" }],
      undefined,
      { perProviderTimeoutMs: 2_000, totalTimeoutMs: 5_000, retryDelayMs: 0 }
    );
    assert.equal(result.text, "recovered without false success");
    assert.equal(requestCount, 4);
  } finally {
    global.fetch = previousFetch;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGemini;
    if (previousTelnyx === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousTelnyx;
  }
});

test("generated apps use a browser-safe durable data client", async () => {
  assert.match(GENERATED_DB_CLIENT_SOURCE, /\/__bigbag\/data\//);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /collection<T extends object = DbRecord>/);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /Promise<\{ records: T\[\]; total: number \}>/);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /X-BigBag-Capability/);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /Authorization/);
  assert.match(GENERATED_DB_CLIENT_SOURCE, /getPlatformAuthAccessToken/);
  assert.doesNotMatch(GENERATED_DB_CLIENT_SOURCE, /from "@\/lib\/auth"/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /signInWithPassword/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /signUp/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /onAuthStateChange/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /__bigbag\/auth\/storage/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /storage: previewAuthStorage/);
  assert.match(GENERATED_AUTH_CLIENT_SOURCE, /bigbag-preview-/);
  assert.doesNotMatch(GENERATED_AUTH_CLIENT_SOURCE, /service.role|SERVICE_ROLE|passwordHash/);
  assert.doesNotMatch(GENERATED_DB_CLIENT_SOURCE, /@libsql|node:|process\.env|process\.cwd|from ["'](?:fs|path)["']/);
  assert.match(GENERATED_RUNTIME_CHECK_SCRIPT, /\/api\/preview\/runtime-validation\//);
  assert.match(GENERATED_RUNTIME_CHECK_SCRIPT, /__bigbag\/auth\/config/);
  assert.match(GENERATED_RUNTIME_CHECK_SCRIPT, /__bigbag\/auth\/storage/);
  assert.match(GENERATED_RUNTIME_CHECK_SCRIPT, /__BIGBAG_WRITE_CAPABILITY__/);
  assert.match(GENERATED_RUNTIME_CHECK_SCRIPT, /Missing or invalid preview write capability/);
  assert.match(GENERATED_RUNTIME_CHECK_SCRIPT, /blocked a non-platform network request/);

  const tenantId = "11111111-1111-4111-8111-111111111111";
  const projectId = `data-${randomUUID()}`;
  const project = record(tenantId, projectId);
  try {
    await durableProjectStore.saveRecord(project);
    const created = await durableProjectStore.createAppRecord(projectId, "tasks", {
      title: "Ship a working preview",
      done: false,
    });
    assert.equal(created.title, "Ship a working preview");
    assert.equal(typeof created._id, "string");

    await Promise.all(Array.from({ length: 105 }, (_, index) =>
      durableProjectStore.createAppRecord(projectId, "tasks", { title: `Task ${index}` })
    ));
    const listed = await durableProjectStore.listAppRecords(projectId, "tasks", { limit: 100 });
    assert.equal(listed.total, 106);
    assert.equal(listed.records.length, 100);
    assert.equal((await durableProjectStore.listAllAppRecords(projectId, "tasks")).length, 106);
    assert.equal((await durableProjectStore.getAppRecord(projectId, "tasks", created._id))?._id, created._id);

    const updated = await durableProjectStore.updateAppRecord(projectId, "tasks", created._id, {
      done: true,
      _id: "cannot-overwrite-system-fields",
    });
    assert.equal(updated?.done, true);
    assert.equal(updated?._id, created._id);

    const collections = await durableProjectStore.listAppCollections(projectId);
    assert.deepEqual(collections, [{ name: "tasks", count: 106 }]);
    assert.equal(await durableProjectStore.deleteAppRecord(projectId, "tasks", created._id), true);
    assert.equal((await durableProjectStore.listAppRecords(projectId, "tasks")).total, 105);

    const userA = "auth-user-a";
    const userB = "auth-user-b";
    const ownedA = await durableProjectStore.createAppRecord(projectId, "private_tasks", { title: "A" }, userA);
    const ownedB = await durableProjectStore.createAppRecord(projectId, "private_tasks", { title: "B" }, userB);
    assert.deepEqual((await durableProjectStore.listAppRecords(projectId, "private_tasks", { ownerId: userA })).records.map((row) => row.title), ["A"]);
    assert.deepEqual((await durableProjectStore.listAppRecords(projectId, "private_tasks", { ownerId: userB })).records.map((row) => row.title), ["B"]);
    assert.equal(await durableProjectStore.getAppRecord(projectId, "private_tasks", ownedB._id, userA), null);
    assert.equal(await durableProjectStore.updateAppRecord(projectId, "private_tasks", ownedB._id, { title: "stolen" }, userA), null);
    assert.equal(await durableProjectStore.deleteAppRecord(projectId, "private_tasks", ownedB._id, userA), false);
    assert.equal((await durableProjectStore.getAppRecord(projectId, "private_tasks", ownedA._id, userA))?.title, "A");
  } finally {
    assert.equal(await durableProjectStore.remove(projectId, tenantId), true);
  }
});

test("preview auth storage is encrypted and bound to project, guest, key, and expiry", () => {
  const guestId = randomUUID();
  const issuedAt = Date.now();
  const sealed = sealPreviewAuthStorage("project-a", guestId, "session-key", '{"access_token":"private"}', issuedAt);
  assert.equal(openPreviewAuthStorage(sealed, "project-a", guestId, "session-key", issuedAt), '{"access_token":"private"}');
  assert.equal(sealed.includes("private"), false);
  assert.equal(openPreviewAuthStorage(sealed, "project-b", guestId, "session-key", issuedAt), null);
  assert.equal(openPreviewAuthStorage(sealed, "project-a", randomUUID(), "session-key", issuedAt), null);
  assert.equal(openPreviewAuthStorage(sealed, "project-a", guestId, "other-key", issuedAt), null);
  const tampered = `${sealed[0] === "A" ? "B" : "A"}${sealed.slice(1)}`;
  assert.equal(openPreviewAuthStorage(tampered, "project-a", guestId, "session-key", issuedAt), null);
  assert.equal(openPreviewAuthStorage(sealed, "project-a", guestId, "session-key", issuedAt + 31 * 24 * 60 * 60_000), null);

  const priorNodeEnv = process.env.NODE_ENV;
  const priorTenantSecret = process.env.TENANT_COOKIE_SECRET;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.TENANT_COOKIE_SECRET;
    assert.throws(
      () => sealPreviewAuthStorage("project-a", guestId, "session-key", "value"),
      /TENANT_COOKIE_SECRET is required/
    );
  } finally {
    if (priorNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", priorNodeEnv);
    if (priorTenantSecret === undefined) delete process.env.TENANT_COOKIE_SECRET;
    else process.env.TENANT_COOKIE_SECRET = priorTenantSecret;
  }
});

test("preview write capabilities are project-scoped, signed, and expiring", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const issuedAt = 1_000_000;
  const capability = createPreviewWriteCapability("capability-demo", tenantId, issuedAt);
  assert.equal(verifyPreviewWriteCapability(capability, "capability-demo", issuedAt), tenantId);
  assert.equal(verifyPreviewWriteCapability(capability, "another-project", issuedAt), null);
  assert.equal(verifyPreviewWriteCapability(`${capability}x`, "capability-demo", issuedAt), null);
  assert.equal(
    verifyPreviewWriteCapability(capability, "capability-demo", issuedAt + 15 * 60_000 + 1_000),
    null
  );
});

test("guest mutation limits are project-scoped rather than identity-scoped", () => {
  const projectId = `guest-budget-${randomUUID()}`;
  const startedAt = 1_000_000;
  for (let index = 0; index < 60; index += 1) {
    assert.equal(consumePreviewGuestMutationBudget(projectId, startedAt + index), true);
  }
  assert.equal(consumePreviewGuestMutationBudget(projectId, startedAt + 59_999), false);
  assert.equal(consumePreviewGuestMutationBudget(projectId, startedAt + 60_000), true);
});

test("restored workspaces preserve package mode and customized database clients", () => {
  const workspace = path.join(tempRoot, "custom-restored-workspace");
  const customDbClient = `import { createClient } from "@libsql/client";
type DbRecord = { _id: string };
function collectionPath(name: string): string { return name; }
export function collection<T extends DbRecord = DbRecord>(name: string) { return { name: collectionPath(name), update: (_id: string, data: Partial<T>) => data, client: createClient }; }
export const customized = true;
`;
  fs.mkdirSync(path.join(workspace, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
    name: "custom-restored-workspace",
    type: "commonjs",
  }));
  fs.writeFileSync(path.join(workspace, "src", "lib", "db.ts"), customDbClient);
  fs.writeFileSync(
    path.join(workspace, "vite.config.ts"),
    `import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from "vite";
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: [".e2b.app"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
`
  );

  writeStarterTemplate(workspace, "custom-restored-workspace");

  const restoredPackage = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
  assert.equal(restoredPackage.type, "commonjs");
  assert.equal(restoredPackage.dependencies["@libsql/client"], "^0.18.0");
  assert.equal(fs.readFileSync(path.join(workspace, "src", "lib", "db.ts"), "utf8"), customDbClient);
  const viteConfig = fs.readFileSync(path.join(workspace, "vite.config.ts"), "utf8");
  assert.match(viteConfig, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(viteConfig, /pathToFileURL, fileURLToPath/);
  assert.doesNotMatch(viteConfig, /\b__dirname\b/);

  const incompleteWorkspace = path.join(tempRoot, "incomplete-vite-migration");
  const incompleteViteConfig = `import path from "node:path";\nexport default { resolve: { alias: { "@": path.resolve(__dirname, "./src") } } };\n`;
  fs.mkdirSync(path.join(incompleteWorkspace, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(incompleteWorkspace, "package.json"), JSON.stringify({
    name: "incomplete-vite-migration",
  }));
  fs.writeFileSync(path.join(incompleteWorkspace, "vite.config.ts"), incompleteViteConfig);
  writeStarterTemplate(incompleteWorkspace, "incomplete-vite-migration");
  assert.equal(
    fs.readFileSync(path.join(incompleteWorkspace, "vite.config.ts"), "utf8"),
    incompleteViteConfig
  );
});

test("legacy database clients remain only for server-exclusive consumers", () => {
  const browserWorkspace = path.join(tempRoot, "legacy-db-browser-consumer");
  fs.mkdirSync(path.join(browserWorkspace, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(browserWorkspace, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(browserWorkspace, "src", "server"), { recursive: true });
  fs.writeFileSync(path.join(browserWorkspace, "package.json"), JSON.stringify({
    name: "legacy-db-browser-consumer",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(path.join(browserWorkspace, "src", "lib", "db.ts"), LEGACY_GENERATED_DB_CLIENT_SOURCE);
  fs.writeFileSync(
    path.join(browserWorkspace, "src", "server", "bridge.ts"),
    `import db from "@/lib/db";\nexport const forwardedDatabaseClient = db;\n`
  );
  fs.writeFileSync(
    path.join(browserWorkspace, "src", "app", "page.tsx"),
    `export { forwardedDatabaseClient } from "@/server/bridge";\nconst queue = { batch: () => "ok" };\nexport const unrelatedBatch = queue.batch();\n`
  );

  writeStarterTemplate(browserWorkspace, "legacy-db-browser-consumer");
  assert.equal(
    fs.readFileSync(path.join(browserWorkspace, "src", "lib", "db.ts"), "utf8"),
    GENERATED_DB_CLIENT_SOURCE
  );
  const browserPackage = JSON.parse(fs.readFileSync(path.join(browserWorkspace, "package.json"), "utf8"));
  assert.equal(browserPackage.dependencies["@libsql/client"], undefined);

  const incompatibleWorkspace = path.join(tempRoot, "legacy-db-browser-sql");
  fs.mkdirSync(path.join(incompatibleWorkspace, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(incompatibleWorkspace, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(incompatibleWorkspace, "src", "server"), { recursive: true });
  fs.writeFileSync(path.join(incompatibleWorkspace, "package.json"), JSON.stringify({
    name: "legacy-db-browser-sql",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(
    path.join(incompatibleWorkspace, "src", "lib", "db.ts"),
    LEGACY_GENERATED_DB_CLIENT_SOURCE
  );
  fs.writeFileSync(
    path.join(incompatibleWorkspace, "src", "server", "bridge.ts"),
    `import { default as database } from "@/lib/db";\nexport const forwardedDatabase = database;\n`
  );
  fs.writeFileSync(
    path.join(incompatibleWorkspace, "src", "app", "page.tsx"),
    `import { forwardedDatabase } from "@/server/bridge";\nexport const load = () => forwardedDatabase.execute("SELECT 1");\n`
  );
  assert.throws(
    () => writeStarterTemplate(incompatibleWorkspace, "legacy-db-browser-sql"),
    /Migrate those calls to db\.collection\(\)/
  );
  assert.equal(
    fs.readFileSync(path.join(incompatibleWorkspace, "src", "lib", "db.ts"), "utf8"),
    LEGACY_GENERATED_DB_CLIENT_SOURCE
  );

  const serverWorkspace = path.join(tempRoot, "legacy-db-server-consumer");
  fs.mkdirSync(path.join(serverWorkspace, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(serverWorkspace, "src", "app", "api", "records"), { recursive: true });
  fs.writeFileSync(path.join(serverWorkspace, "package.json"), JSON.stringify({
    name: "legacy-db-server-consumer",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(path.join(serverWorkspace, "src", "lib", "db.ts"), LEGACY_GENERATED_DB_CLIENT_SOURCE);
  fs.writeFileSync(
    path.join(serverWorkspace, "src", "lib", "repository.ts"),
    `import db from "@/lib/db";\nexport const serverDatabaseClient = db;\n`
  );
  fs.writeFileSync(
    path.join(serverWorkspace, "src", "app", "api", "records", "route.ts"),
    `export { serverDatabaseClient } from "@/lib/repository";\n`
  );

  writeStarterTemplate(serverWorkspace, "legacy-db-server-consumer");
  assert.equal(
    fs.readFileSync(path.join(serverWorkspace, "src", "lib", "db.ts"), "utf8"),
    LEGACY_GENERATED_DB_CLIENT_SOURCE
  );
  const serverPackage = JSON.parse(fs.readFileSync(path.join(serverWorkspace, "package.json"), "utf8"));
  assert.equal(serverPackage.dependencies["@libsql/client"], "^0.14.0");

  const unusedWorkspace = path.join(tempRoot, "unused-legacy-db");
  fs.mkdirSync(path.join(unusedWorkspace, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(unusedWorkspace, "package.json"), JSON.stringify({
    name: "unused-legacy-db",
    dependencies: { "@libsql/client": "^0.14.0" },
  }));
  fs.writeFileSync(path.join(unusedWorkspace, "src", "lib", "db.ts"), LEGACY_GENERATED_DB_CLIENT_SOURCE);
  fs.mkdirSync(path.join(unusedWorkspace, "src", "server"), { recursive: true });
  fs.writeFileSync(
    path.join(unusedWorkspace, "src", "server", "direct-libsql.ts"),
    `import { createClient } from "@libsql/client";\nexport const createDirectClient = createClient;\n`
  );

  writeStarterTemplate(unusedWorkspace, "unused-legacy-db");
  assert.equal(
    fs.readFileSync(path.join(unusedWorkspace, "src", "lib", "db.ts"), "utf8"),
    GENERATED_DB_CLIENT_SOURCE
  );
  const unusedPackage = JSON.parse(fs.readFileSync(path.join(unusedWorkspace, "package.json"), "utf8"));
  assert.equal(unusedPackage.dependencies["@libsql/client"], "^0.14.0");
});

test.after(async () => {
  await durableProjectStore.remove("durable-demo", "11111111-1111-4111-8111-111111111111");
  assert.equal(await durableProjectStore.readDeploymentFile("durable-demo", "index.html"), null);
  await testDatabase.end().catch(() => {});
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Best-effort cleanup on Windows
  }
});
