import { NextRequest, NextResponse } from "next/server";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";
import { localFileManager } from "@/lib/local-orchestrator/file-manager";
import { e2bSandboxManager } from "@/lib/local-orchestrator/e2b-sandbox-manager";
import { localAgentEngine } from "@/lib/local-orchestrator/agent-engine";
import { vcaasRequest, VcaasPathError } from "@/lib/vcaas-server";
import { normalizeVcaasError, toErrorEnvelope } from "@/lib/vcaas-errors";
import { isPromptEndpoint, injectDesignPrompt } from "@/lib/design-system-prompt";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { isRoutableProjectSlug } from "@/lib/project-slug";
import { authFailed, enforceProjectScope, resolveVcaasContext } from "../_shared";
import { projectAccess } from "@/lib/project-access";
import { figmaConnector, validateFigmaToken } from "@/lib/local-orchestrator/figma-connector";

const IS_LOCAL_MODE = isLocalOrchestratorEnabled();

async function handleLocalRequest(req: NextRequest, path: string[], userId: string) {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  // 1. Projects collection: /projects or /projects/launch
  if (path[0] === "projects" && path.length === 1) {
    if (method === "GET") {
      const list = localProjectStore.list();
      projectAccess.claimLegacyProjects(userId, list.map((project) => project.projectId));
      return NextResponse.json({ ok: true, data: projectAccess.filter(userId, list) }, { status: 200 });
    }
    if (method === "POST") {
      const body = await req.json().catch(() => ({}));
      const proj = localProjectStore.create(body);
      projectAccess.assign(userId, proj.projectId);
      return NextResponse.json({ ok: true, data: proj }, { status: 200 });
    }
  }

  // 2. Launch: /projects/launch
  if (path[0] === "projects" && path[1] === "launch" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const proj = localProjectStore.create({
      projectId: body.projectId || `app-${Date.now().toString().slice(-4)}`,
      description: body.prompt || body.description || "Web Application",
      label: body.label || body.projectId,
    });
    projectAccess.assign(userId, proj.projectId);
    if (body.figma?.token) {
      try { await figmaConnector.connect(proj.projectId, body.figma.token); }
      catch (error) {
        localProjectStore.remove(proj.projectId);
        projectAccess.remove(userId, proj.projectId);
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Figma connection failed", code: "FIGMA_INVALID" }, { status: 400 });
      }
    }

    // Start background agent run & dev sandbox
    void localAgentEngine
      .runPrompt(proj.projectId, body.prompt || body.description || "", userId)
      .catch((error) => console.error(`[vcaas] Failed to launch agent for ${proj.projectId}:`, error));

    return NextResponse.json(
      {
        ok: true,
        data: {
          projectId: proj.projectId,
          requestedProjectId: body.projectId,
          agent: { started: true },
          warnings: [],
        },
      },
      { status: 200 }
    );
  }

  // 3. Single project: /projects/:id/...
  if (path[0] === "projects" && path[1]) {
    const projectId = path[1];
    if (!isRoutableProjectSlug(projectId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid project id", code: "VALIDATION" },
        { status: 400 }
      );
    }
    const subRoute = path.slice(2).join("/");

    // /projects/:id
    if (!subRoute) {
      if (method === "GET") {
        const proj = localProjectStore.get(projectId);
        if (!proj) {
          return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true, data: proj }, { status: 200 });
      }
      if (method === "PATCH") {
        const body = await req.json().catch(() => ({}));
        localProjectStore.update(projectId, body);
        const updated = localProjectStore.get(projectId);
        return NextResponse.json({ ok: true, data: updated }, { status: 200 });
      }
      if (method === "DELETE") {
        await e2bSandboxManager.stopDevServer(projectId);
        localProjectStore.remove(projectId);
        projectAccess.remove(userId, projectId);
        figmaConnector.disconnect(projectId);
        return NextResponse.json({ ok: true, data: { deleted: true } }, { status: 200 });
      }
    }

    // /projects/:id/agent/status
    if (subRoute === "agent/status" && method === "GET") {
      const rec = localProjectStore.getRecord(projectId);
      if (!rec) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
      return NextResponse.json(
        {
          ok: true,
          data: {
            projectId,
            status: rec.status,
            startedAt: rec.createdAt,
            realtimeConversation: rec.conversation || [],
            creditsSpent: 0,
            expectedMinutes: 1,
            expectedFinishAt: null,
          },
        },
        { status: 200 }
      );
    }

    // /projects/:id/agent/full-conversation
    if (subRoute === "agent/full-conversation" && method === "GET") {
      const rec = localProjectStore.getRecord(projectId);
      if (!rec) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
      return NextResponse.json(
        {
          ok: true,
          data: {
            conversation: rec.conversation || [],
            totalCount: rec.conversation?.length || 0,
            hasMore: false,
          },
        },
        { status: 200 }
      );
    }

    // /projects/:id/agent/start
    if (subRoute === "agent/start" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!localProjectStore.getRecord(projectId)) {
        return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
      }
      void localAgentEngine
        .runPrompt(projectId, body.prompt || "", userId)
        .catch((error) => console.error(`[vcaas] Failed to start agent for ${projectId}:`, error));
      return NextResponse.json({ ok: true, data: { started: true } }, { status: 200 });
    }

    // /projects/:id/agent/stop
    if (subRoute === "agent/stop" && method === "POST") {
      localProjectStore.update(projectId, { status: "idle" });
      return NextResponse.json({ ok: true, data: { stopped: true } }, { status: 200 });
    }

    // /projects/:id/agent/server/start-or-restart
    if (subRoute === "agent/server/start-or-restart" && method === "POST") {
      await e2bSandboxManager.startDevServer(projectId);
      return NextResponse.json({ ok: true, data: { status: "Active" } }, { status: 200 });
    }

    // /projects/:id/files/tree
    if (subRoute === "files/tree" && method === "GET") {
      const tree = localFileManager.getTree(projectId);
      return NextResponse.json({ ok: true, data: tree }, { status: 200 });
    }

    // /projects/:id/files/content
    if (subRoute === "files/content") {
      if (method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        const content = localFileManager.getContent(projectId, filePath);
        if (!content) {
          return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true, data: content }, { status: 200 });
      }
      if (method === "PUT") {
        const body = await req.json().catch(() => ({}));
        const res = localFileManager.writeContent(projectId, body.path, body.content, body.encoding);
        return NextResponse.json({ ok: true, data: res }, { status: 200 });
      }
    }

    // /projects/:id/deployments/status
    if (subRoute === "deployments/status") {
      return NextResponse.json({ ok: true, data: { status: null, createdAt: null } }, { status: 200 });
    }

    // /projects/:id/database/tables-structure
    if (subRoute === "database/tables-structure") {
      return NextResponse.json({ ok: true, data: { tables: [] } }, { status: 200 });
    }

    // /projects/:id/github/status
    if (subRoute === "github/status") {
      return NextResponse.json({ ok: true, data: { connected: false, repository: null } }, { status: 200 });
    }

    // /projects/:id/rebuild and /projects/:id/rebuild/status
    if (subRoute === "rebuild" && method === "POST") {
      const startedAt = new Date().toISOString();
      try {
        await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
        return NextResponse.json(
          { ok: true, data: { status: "success", startedAt } },
          { status: 200 }
        );
      } catch (error) {
        return NextResponse.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Preview rebuild failed",
            code: "REBUILD_FAILED",
          },
          { status: 500 }
        );
      }
    }
    if (subRoute === "rebuild/status" && method === "GET") {
      const rec = localProjectStore.getRecord(projectId);
      const status = rec?.serverStatus === "Error" ? "error" : rec?.serverStatus === "Starting" ? "rebuilding" : "success";
      return NextResponse.json({ ok: true, data: { status } }, { status: 200 });
    }

    if (subRoute === "figma/status" && method === "GET") {
      return NextResponse.json({ ok: true, data: await figmaConnector.status(projectId, url.searchParams.get("verify") === "true") });
    }
    if (subRoute === "figma/connect" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      try { return NextResponse.json({ ok: true, data: await figmaConnector.connect(projectId, body.token || "") }); }
      catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Figma connection failed", code: "FIGMA_INVALID" }, { status: 400 }); }
    }
    if (subRoute === "figma/connect" && method === "DELETE") {
      figmaConnector.disconnect(projectId);
      return NextResponse.json({ ok: true, data: { connected: false } });
    }
  }

  if (path[0] === "figma" && path[1] === "validate" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    try { return NextResponse.json({ ok: true, data: { valid: true, account: await validateFigmaToken(body.token || "") } }); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Figma token is invalid", code: "FIGMA_INVALID" }, { status: 400 }); }
  }

  // Fallback 404 for unimplemented local endpoint
  return NextResponse.json(
    { ok: false, error: `Local orchestrator: endpoint not mapped /${path.join("/")}` },
    { status: 404 }
  );
}

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const auth = await resolveVcaasContext();
    if (authFailed(auth)) return auth.response;
    const outOfScope = enforceProjectScope(auth.team, req.method, path);
    if (outOfScope) return outOfScope;

    // Route to local orchestrator when in local mode
    if (IS_LOCAL_MODE) {
      return await handleLocalRequest(req, path, auth.team.userId);
    }

    // Upstream Totalum fallback
    const vcaasPath = "/" + path.join("/");
    const url = new URL(req.url);
    const queryString = url.searchParams.toString();
    const fullPath = queryString ? `${vcaasPath}?${queryString}` : vcaasPath;

    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        const text = await req.text();
        if (text) body = text;
      } catch {
        // No body
      }
    }

    // Inject design system prompt for prompt-carrying endpoints
    if (body && req.method === "POST" && isPromptEndpoint(path)) {
      body = injectDesignPrompt(body);
    }

    const response = await vcaasRequest(fullPath, {
      method: req.method,
      body,
    });

    const json = await response.json();
    if (json.errors) {
      const normalized = normalizeVcaasError(json.errors, response.status);
      return NextResponse.json(toErrorEnvelope(normalized), { status: normalized.status });
    }

    let data = json.data;
    if (req.method === "GET" && path[0] === "projects" && path.length === 1 && Array.isArray(data)) {
      const projects = data.filter((item): item is { projectId: string } => item && typeof item.projectId === "string");
      projectAccess.claimLegacyProjects(auth.team.userId, projects.map((project) => project.projectId));
      data = projectAccess.filter(auth.team.userId, projects);
    }
    if (req.method === "POST" && path[0] === "projects" && data && typeof data.projectId === "string") {
      projectAccess.assign(auth.team.userId, data.projectId);
    }
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof VcaasPathError) {
      return NextResponse.json(
        { ok: false, error: "Invalid path", code: "VALIDATION", data: null },
        { status: 400 }
      );
    }
    console.error(`[vcaas] ${req.method} proxy failed:`, error);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "UNKNOWN", data: null },
      { status: 500 }
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const DELETE = handleRequest;
export const PATCH = handleRequest;
