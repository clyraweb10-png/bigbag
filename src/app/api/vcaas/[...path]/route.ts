import { NextRequest, NextResponse } from "next/server";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";
import { localFileManager } from "@/lib/local-orchestrator/file-manager";
import { localSandboxManager } from "@/lib/local-orchestrator/sandbox-manager";
import { e2bSandboxManager } from "@/lib/local-orchestrator/e2b-sandbox-manager";
import { localAgentEngine } from "@/lib/local-orchestrator/agent-engine";
import { vcaasRequest, VcaasPathError } from "@/lib/vcaas-server";
import { normalizeVcaasError, toErrorEnvelope } from "@/lib/vcaas-errors";
import { isPromptEndpoint, injectDesignPrompt } from "@/lib/design-system-prompt";

const IS_LOCAL_MODE =
  process.env.ORCHESTRATOR_MODE === "local" ||
  !process.env.TOTALUM_VCAAS_API_KEY ||
  process.env.TOTALUM_VCAAS_API_KEY === "your_key_here" ||
  process.env.USE_LOCAL_ORCHESTRATOR === "true";

async function handleLocalRequest(req: NextRequest, path: string[]) {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  // 1. Projects collection: /projects or /projects/launch
  if (path[0] === "projects" && path.length === 1) {
    if (method === "GET") {
      const list = localProjectStore.list();
      return NextResponse.json({ ok: true, data: list }, { status: 200 });
    }
    if (method === "POST") {
      const body = await req.json().catch(() => ({}));
      const proj = localProjectStore.create(body);
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

    // Start background agent run & dev sandbox
    localAgentEngine.runPrompt(proj.projectId, body.prompt || body.description || "");

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
    const subRoute = path.slice(2).join("/");

    // /projects/:id
    if (!subRoute) {
      if (method === "GET") {
        const proj = localProjectStore.get(projectId);
        if (!proj) {
          return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
        }
        e2bSandboxManager.startDevServer(projectId).catch((err) => {
          console.warn(`[vcaas] background sandbox start failed for ${projectId}:`, err);
        });
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
      localAgentEngine.runPrompt(projectId, body.prompt || "");
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

    // /projects/:id/rebuild/status
    if (subRoute === "rebuild/status") {
      return NextResponse.json({ ok: true, data: { status: "idle" } }, { status: 200 });
    }

    // /projects/:id/figma/status
    if (subRoute === "figma/status") {
      return NextResponse.json({ ok: true, data: { connected: false } }, { status: 200 });
    }
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

    // Route to local orchestrator when in local mode
    if (IS_LOCAL_MODE) {
      return await handleLocalRequest(req, path);
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

    return NextResponse.json({ ok: true, data: json.data }, { status: 200 });
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
