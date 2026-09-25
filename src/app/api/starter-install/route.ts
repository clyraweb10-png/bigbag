/**
 * POST /api/starter-install
 *
 * Creates a new project, writes pre-built template files to the workspace,
 * and kicks off the E2B (or local) dev-server build in the background.
 *
 * Key guarantees:
 *  - Each call creates a NEW project owned by the requesting tenant —
 *    the original template bundles are never mutated.
 *  - Projects are tenant-scoped: User A can never see User B's projects.
 *  - Responds immediately with { projectId } so the client can navigate.
 *
 * Body:  { templateId: string; templateName: string; prompt: string }
 * Response: { ok: true, data: { projectId: string } }
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";
import { localFileManager } from "@/lib/local-orchestrator/file-manager";
import { e2bSandboxManager } from "@/lib/local-orchestrator/e2b-sandbox-manager";
import { localSandboxManager } from "@/lib/local-orchestrator/sandbox-manager";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { slugify } from "@/lib/project-slug";
import {
  durableProjectStore,
  durablePersistenceConfigured,
} from "@/lib/local-orchestrator/durable-project-store";
import { findBundleForTemplate } from "@/lib/template-bundles";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import type { ConversationMessage } from "@/lib/vcaas-types";
import {
  attachLocalTenantCookie,
  tenantContextForIdentity,
} from "@/lib/local-orchestrator/tenant-context";
import { AUTH_COOKIE, verifyAuthSession } from "@/lib/auth-session";

const IS_LOCAL_MODE = isLocalOrchestratorEnabled();

async function availableProjectId(requested: string): Promise<string> {
  let base = slugify(requested);
  if (!base) base = `app-${Date.now().toString().slice(-6)}`;

  if (durablePersistenceConfigured()) {
    if (!(await durableProjectStore.projectIdExists(base))) return base;
  } else {
    if (!localProjectStore.getRecord(base)) return base;
  }

  // Suffix with short random to avoid collision
  return `${base.slice(0, 26).replace(/-+$/, "")}-${randomUUID().slice(0, 8)}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!IS_LOCAL_MODE) {
    return NextResponse.json(
      { ok: false, error: "Starter install is only available in local orchestrator mode." },
      { status: 400 }
    );
  }

  // ── Auth / tenant ─────────────────────────────────────────────────────────
  const session = verifyAuthSession(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Sign in to continue" },
      { status: 401 }
    );
  }
  const tenantCtx = tenantContextForIdentity(session.sub);
  const { tenantId } = tenantCtx;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { templateId?: string; templateName?: string; prompt?: string; previewImage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const templateId   = (body.templateId   ?? "").trim();
  const templateName = (body.templateName ?? "New App").trim();
  const prompt       = (body.prompt       ?? templateName).trim();
  const requestedPreviewImage = (body.previewImage ?? "").trim();

  if (!templateId) {
    return NextResponse.json({ ok: false, error: "templateId is required" }, { status: 400 });
  }

  // ── Find matching template and pre-built bundle ───────────────────────────
  const matchingTemplate = STARTER_TEMPLATES.find(
    (t) =>
      t.id === templateId ||
      t.id.toLowerCase() === templateId.toLowerCase() ||
      t.title.toLowerCase() === templateName.toLowerCase()
  );
  const screenshotUrl = requestedPreviewImage || matchingTemplate?.previewImage || undefined;
  const bundle = findBundleForTemplate(templateId, templateName);

  // ── Create project record ─────────────────────────────────────────────────
  const slugBase = templateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "starter";

  const projectId = await availableProjectId(slugBase);
  const now = new Date().toISOString();
  const generationId = randomUUID();

  const userPromptText = (prompt || "").trim() || `Create a ${templateName} app`;
  const initialUserMessage: ConversationMessage = {
    author: "user",
    message: userPromptText,
    messageType: "regular",
    createdAt: now,
  };

  const initialMessages: ConversationMessage[] = [
    initialUserMessage,
    {
      author: "agent",
      message: `Installing **${templateName}** starter template…`,
      messageType: "building",
      createdAt: now,
      generationEvent: {
        type: "generation_started",
        status: "started",
        generationId,
      },
    },
  ];

  // Create the project (tenantId ensures it only appears in this user's list)
  localProjectStore.create({
    projectId,
    description: `Pre-built ${templateName} starter. Modify with AI to customise.`,
    label: templateName,
    tenantId,
    screenshotUrl,
  });

  localProjectStore.update(projectId, {
    conversation: initialMessages,
    status: "init",
    ...(screenshotUrl ? { screenshotUrl } : {}),
  });

  // Persist immediately so the workspace page can load it
  if (durablePersistenceConfigured()) {
    await localProjectStore.flush(projectId).catch((err) => {
      console.warn("[starter-install] Could not persist project record:", err);
    });
  }

  // ── Write pre-built files to workspace ────────────────────────────────────
  // First seed the Vite+React scaffold (package.json, vite.config, index.html, etc.)
  try {
    localSandboxManager.ensureProjectTemplate(projectId);
  } catch (err) {
    console.warn("[starter-install] ensureProjectTemplate warning:", err);
  }

  // Then overlay the template-specific source files
  if (bundle && bundle.length > 0) {
    for (const file of bundle) {
      try {
        localFileManager.writeContent(projectId, file.path, file.content, "utf8");
      } catch (err) {
        console.warn(`[starter-install] Failed to write ${file.path}:`, err);
      }
    }
  }

  // ── Save deployment snapshot immediately for 0s instant preview ─────────
  const htmlFile = bundle?.find(f => f.path === "dist/index.html" || f.path === "index.html");
  if (htmlFile && durablePersistenceConfigured()) {
    try {
      const rec = localProjectStore.update(projectId, {});
      if (rec) {
        await localProjectStore.flush(projectId);
        await durableProjectStore.saveDeployment(rec, [
          { path: "index.html", content: Buffer.from(htmlFile.content, "utf8") }
        ]);
      }
    } catch (err) {
      console.warn("[starter-install] Could not save deployment snapshot:", err);
    }
  }

  // Pre-seed instant active status so preview is live from second 0
  const previewPath = `/api/preview/${encodeURIComponent(projectId)}/`;
  const initialDoneMessages: ConversationMessage[] = [
    {
      author: "agent",
      message: `Template files installed (${bundle?.length ?? 0} files).`,
      messageType: "building",
      createdAt: new Date().toISOString(),
      generationEvent: { type: "build_completed", status: "completed" },
    },
    {
      author: "agent",
      message: "Live preview is ready.",
      messageType: "building",
      createdAt: new Date().toISOString(),
      generationEvent: {
        type: "preview_ready",
        status: "completed",
        source: "runtime",
      },
    },
    {
      author: "agent",
      message: `✅ **${templateName}** template installed. Preview is live! This is your independent copy — type below to customize it with AI.`,
      messageType: "finished",
      createdAt: new Date().toISOString(),
      generationEvent: {
        type: "generation_completed",
        status: "completed",
        generationId,
      },
    },
  ];

  localProjectStore.update(projectId, {
    status: "done",
    serverStatus: "Starting",
    previewUrl: previewPath,
    conversation: [...initialMessages, ...initialDoneMessages],
    ...(screenshotUrl ? { screenshotUrl } : {}),
  });

  if (durablePersistenceConfigured()) {
    await localProjectStore.flush(projectId).catch(() => {});
  }

  // ── Kick off background dev server so interactive edits hot reload ─────────
  void (async () => {
    try {
      let previewUrl: string | null = null;

      if (e2bSandboxManager.isE2BEnabled()) {
        previewUrl = await e2bSandboxManager.startDevServer(projectId);
      } else {
        previewUrl = await localSandboxManager.startDevServer(projectId);
      }

      if (previewUrl) {
        localProjectStore.update(projectId, {
          previewUrl: previewUrl,
          serverStatus: "Active",
          ...(screenshotUrl ? { screenshotUrl } : {}),
        });
      }
    } catch (err) {
      console.warn(`[starter-install] Background dev server notice for ${projectId}:`, err);
    }
  })();

  // ── Respond immediately ───────────────────────────────────────────────────
  const response = NextResponse.json({ ok: true, data: { projectId } }, { status: 200 });
  attachLocalTenantCookie(response, tenantCtx);
  return response;
}
