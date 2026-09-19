import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";
import { localFileManager } from "@/lib/local-orchestrator/file-manager";
import { e2bSandboxManager } from "@/lib/local-orchestrator/e2b-sandbox-manager";
import { localAgentEngine } from "@/lib/local-orchestrator/agent-engine";
import { vcaasRequest, VcaasPathError } from "@/lib/vcaas-server";
import { normalizeVcaasError, toErrorEnvelope } from "@/lib/vcaas-errors";
import { isPromptEndpoint, injectDesignPrompt } from "@/lib/design-system-prompt";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { isRoutableProjectSlug, slugify } from "@/lib/project-slug";
import {
  assertAppCollectionName,
  durableProjectStore,
  requireDurablePersistence,
} from "@/lib/local-orchestrator/durable-project-store";
import type { AppRecord } from "@/lib/local-orchestrator/durable-project-store";
import type { ConversationMessage, DbProperty, DbTable } from "@/lib/vcaas-types";
import {
  attachLocalTenantCookie,
  isPreviewInitiatedRequest,
  tenantContextForIdentity,
} from "@/lib/local-orchestrator/tenant-context";
import { AUTH_COOKIE, isCloudOperator, verifyAuthSession } from "@/lib/auth-session";

const IS_LOCAL_MODE = isLocalOrchestratorEnabled();
const LOCAL_REBUILD_TIMEOUT_MS = 10 * 60_000;

type PromptAsset = { name?: unknown; url?: unknown; imageDescription?: unknown; description?: unknown };

/**
 * Keep uploaded assets in the model context without teaching the model to invent
 * remote images. URLs are created by our upload route and remain project-scoped.
 */
function promptWithAssets(prompt: unknown, inputFiles: unknown): string {
  const text = typeof prompt === "string" ? prompt : "";
  if (!Array.isArray(inputFiles)) return text;

  const assets = inputFiles
    .slice(0, 20)
    .map((entry: PromptAsset) => {
      const name = typeof entry?.name === "string" ? entry.name.trim().slice(0, 160) : "asset";
      const url = typeof entry?.url === "string" ? entry.url.trim() : "";
      const descriptionSource = entry?.imageDescription ?? entry?.description;
      const description = typeof descriptionSource === "string"
        ? descriptionSource.trim().replace(/\s+/g, " ").slice(0, 300)
        : name;
      if (!url.startsWith(`/api/preview/`) && !/^https?:\/\//i.test(url)) return null;
      return `- ${name}: ${url} (${description || name})`;
    })
    .filter((value): value is string => Boolean(value));

  if (assets.length === 0) return text;
  return `${text}\n\nUSER-PROVIDED ASSETS (use only when relevant; do not replace them with invented URLs):\n${assets.join("\n")}`;
}

function readableLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferredProperty(name: string, values: unknown[]): DbProperty {
  const sample = values.find((value) => value !== null && value !== undefined);
  const propertyType = typeof sample === "number"
    ? "number"
    : typeof sample === "boolean"
      ? "boolean"
      : typeof sample === "object"
        ? Array.isArray(sample) ? "array" : "object"
        : name === "createdAt" || name === "updatedAt"
          ? "date"
          : "string";
  return {
    id: name,
    name,
    label: readableLabel(name),
    propertyType,
    description: "Inferred from generated application records",
  };
}

async function localDatabaseTables(projectId: string): Promise<DbTable[]> {
  const collections = await durableProjectStore.listAppCollections(projectId);
  return Promise.all(collections.map(async ({ name }) => {
    const { records } = await durableProjectStore.listAppRecords(projectId, name, { limit: 100 });
    const fields = new Set<string>();
    for (const record of records) {
      Object.keys(record).forEach((field) => {
        if (!["_id", "createdAt", "updatedAt"].includes(field)) fields.add(field);
      });
    }
    const properties = Object.fromEntries([...fields].map((field) => [
      field,
      inferredProperty(field, records.map((record) => record[field])),
    ]));
    return {
      _id: name,
      type: name,
      label: readableLabel(name),
      description: "Durable collection created by the generated application",
      icon: "database",
      properties,
    };
  }));
}

function matchesFilter(record: AppRecord, filter: unknown): boolean {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return true;
  for (const [field, condition] of Object.entries(filter as Record<string, unknown>)) {
    if (field === "_or" && Array.isArray(condition)) {
      if (!condition.some((branch) => matchesFilter(record, branch))) return false;
      continue;
    }
    const actual = record[field];
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const operations = condition as Record<string, unknown>;
      for (const [operator, expected] of Object.entries(operations)) {
        if (operator === "options") continue;
        const left = typeof actual === "string" ? actual : String(actual ?? "");
        const right = String(expected ?? "");
        if (operator === "contains" && !left.toLowerCase().includes(right.toLowerCase())) return false;
        if (operator === "startsWith" && !left.toLowerCase().startsWith(right.toLowerCase())) return false;
        if (operator === "endsWith" && !left.toLowerCase().endsWith(right.toLowerCase())) return false;
        // JavaScript regular expressions can exhibit catastrophic backtracking.
        // This filter is request-controlled, so generated apps must use one of
        // the bounded plain-text operators above instead.
        if (operator === "regex") return false;
        if (operator === "eq" && actual !== expected) return false;
        if (operator === "ne" && actual === expected) return false;
        if (operator === "gt" && !(Number(actual) > Number(expected))) return false;
        if (operator === "gte" && !(Number(actual) >= Number(expected))) return false;
        if (operator === "lt" && !(Number(actual) < Number(expected))) return false;
        if (operator === "lte" && !(Number(actual) <= Number(expected))) return false;
      }
    } else if (actual !== condition) {
      return false;
    }
  }
  return true;
}

function validRecordData(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validCollectionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return assertAppCollectionName(value);
  } catch {
    return null;
  }
}

async function availableProjectId(requested: string): Promise<string> {
  let base = slugify(requested);
  if (!base) base = `app-${Date.now().toString().slice(-6)}`;
  if (!(await durableProjectStore.projectIdExists(base))) return base;
  return `${base.slice(0, 26).replace(/-+$/, "")}-${randomUUID().slice(0, 8)}`;
}

async function handleLocalRequest(req: NextRequest, path: string[], tenantId: string) {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  requireDurablePersistence();

  // 1. Projects collection: /projects or /projects/launch
  if (path[0] === "projects" && path.length === 1) {
    if (method === "GET") {
      await localProjectStore.hydrateTenant(tenantId);
      const list = localProjectStore.list(tenantId);
      return NextResponse.json({ ok: true, data: list }, { status: 200 });
    }
    if (method === "POST") {
      const body = await req.json().catch(() => ({}));
      const projectId = await availableProjectId(body.projectId || body.label || "app");
      const proj = localProjectStore.create({ ...body, projectId, tenantId });
      await localProjectStore.flush(proj.projectId);
      return NextResponse.json({ ok: true, data: proj }, { status: 200 });
    }
  }

  // 2. Launch: /projects/launch
  if (path[0] === "projects" && path[1] === "launch" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const projectId = await availableProjectId(body.projectId || `app-${Date.now().toString().slice(-4)}`);
    const proj = localProjectStore.create({
      projectId,
      description: body.prompt || body.description || "Web Application",
      label: body.label || body.projectId,
      tenantId,
    });
    await localProjectStore.flush(proj.projectId);

    // Start background agent run & dev sandbox
    void localAgentEngine
      .runPrompt(
        proj.projectId,
        promptWithAssets(body.prompt || body.description || "", body.files || body.inputFiles)
      )
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
    if (!(await localProjectStore.hydrateProject(projectId, tenantId))) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

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
        await durableProjectStore.remove(projectId, tenantId);
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
            startedAt: rec.agentStartedAt || rec.createdAt,
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

    // Local-only planner messages must survive navigation and refresh just like
    // code-engine messages. Cloud mode never calls this endpoint.
    if (subRoute === "agent/conversation" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const rawMessages = Array.isArray(body.messages) ? body.messages.slice(0, 4) : [];
      const messages: ConversationMessage[] = rawMessages.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object") return [];
        const value = entry as Record<string, unknown>;
        if ((value.author !== "user" && value.author !== "agent") || typeof value.message !== "string") return [];
        const message = value.message.trim().slice(0, 16_000);
        if (!message) return [];
        return [{
          author: value.author,
          message,
          messageType: "regular",
          createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
        } as ConversationMessage];
      });
      if (messages.length === 0) {
        return NextResponse.json({ ok: false, error: "No valid conversation messages" }, { status: 400 });
      }
      const record = localProjectStore.getRecord(projectId);
      localProjectStore.update(projectId, {
        conversation: [...(record?.conversation || []), ...messages],
      });
      await localProjectStore.flush(projectId);
      return NextResponse.json({ ok: true, data: { saved: messages.length } }, { status: 200 });
    }

    // /projects/:id/agent/start
    if (subRoute === "agent/start" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!localProjectStore.getRecord(projectId)) {
        return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
      }
      void localAgentEngine
        .runPrompt(projectId, promptWithAssets(body.prompt || "", body.inputFiles || body.files))
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
        await localProjectStore.persistSource(projectId);
        return NextResponse.json({ ok: true, data: res }, { status: 200 });
      }
    }

    // /projects/:id/deployments/status
    if (subRoute === "deployments/status" && method === "GET") {
      const deployment = localProjectStore.getRecord(projectId)?.deployment;
      return NextResponse.json(
        {
          ok: true,
          data: deployment
            ? { status: deployment.status, createdAt: deployment.createdAt, versionId: deployment.versionId }
            : { status: null, createdAt: null },
        },
        { status: 200 }
      );
    }
    if (subRoute === "deployments/deploy" && method === "POST") {
      const previewUrl = await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
      return NextResponse.json(
        { ok: true, data: { started: true, status: "success", previewUrl } },
        { status: 200 }
      );
    }

    // /projects/:id/database/* — owner-facing CMS for generated app records.
    if (subRoute === "database/tables-structure" && method === "GET") {
      return NextResponse.json(
        { ok: true, data: { tables: await localDatabaseTables(projectId) } },
        { status: 200 }
      );
    }
    if (subRoute === "database/query" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const tableName = validCollectionName(body.tableName);
      if (!tableName) {
        return NextResponse.json({ ok: false, error: "Invalid database query" }, { status: 400 });
      }
      const queryOptions = validRecordData(body.queryOptions) ? body.queryOptions : {};
      const complete = await durableProjectStore.listAllAppRecords(projectId, tableName);
      let results = complete.filter((record) => matchesFilter(record, queryOptions._filter));
      const sort = validRecordData(queryOptions._sort) ? Object.entries(queryOptions._sort)[0] : undefined;
      if (sort) {
        const [field, direction] = sort;
        results.sort((left, right) => {
          const order = String(left[field] ?? "").localeCompare(String(right[field] ?? ""), undefined, { numeric: true });
          return direction === "asc" ? order : -order;
        });
      }
      const total = results.length;
      const offset = Math.max(0, Number(queryOptions._offset) || 0);
      const limit = Math.min(100, Math.max(1, Number(queryOptions._limit) || 25));
      results = results.slice(offset, offset + limit);
      if (queryOptions._count && results[0]) results[0] = { ...results[0], _count: { _total: total } };
      return NextResponse.json(
        { ok: true, data: { results, ...(queryOptions._count ? { count: total } : {}) } },
        { status: 200 }
      );
    }
    if (subRoute === "database/records" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const tableName = validCollectionName(body.tableName);
      if (!tableName || !validRecordData(body.data)) {
        return NextResponse.json({ ok: false, error: "Invalid record" }, { status: 400 });
      }
      const data = await durableProjectStore.createAppRecord(projectId, tableName, body.data);
      return NextResponse.json({ ok: true, data }, { status: 201 });
    }
    if (subRoute.startsWith("database/records/") && !subRoute.endsWith("/link")) {
      const recordId = path[4] || "";
      if (method === "PATCH") {
        const body = await req.json().catch(() => ({}));
        const tableName = validCollectionName(body.tableName);
        if (!tableName || !validRecordData(body.data)) {
          return NextResponse.json({ ok: false, error: "Invalid record" }, { status: 400 });
        }
        const data = await durableProjectStore.updateAppRecord(projectId, tableName, recordId, body.data);
        return data
          ? NextResponse.json({ ok: true, data }, { status: 200 })
          : NextResponse.json({ ok: false, error: "Record not found" }, { status: 404 });
      }
      if (method === "DELETE") {
        const tableName = validCollectionName(url.searchParams.get("tableName"));
        if (!tableName) {
          return NextResponse.json({ ok: false, error: "Invalid record" }, { status: 400 });
        }
        const deleted = await durableProjectStore.deleteAppRecord(projectId, tableName, recordId);
        return deleted
          ? NextResponse.json({ ok: true, data: { deleted: true } }, { status: 200 })
          : NextResponse.json({ ok: false, error: "Record not found" }, { status: 404 });
      }
    }

    // /projects/:id/github/status
    if (subRoute === "github/status") {
      return NextResponse.json({ ok: true, data: { connected: false, repository: null } }, { status: 200 });
    }

    // /projects/:id/rebuild and /projects/:id/rebuild/status
    if (subRoute === "rebuild" && method === "POST") {
      const startedAt = new Date().toISOString();
      const rebuildOperationId = randomUUID();
      localProjectStore.update(projectId, {
        rebuildStatus: "rebuilding",
        rebuildStartedAt: startedAt,
        rebuildOperationId,
      });
      try {
        await e2bSandboxManager.startDevServer(projectId, { rebuild: true });
        if (localProjectStore.getRecord(projectId)?.rebuildOperationId === rebuildOperationId) {
          localProjectStore.update(projectId, {
            rebuildStatus: "success",
            rebuildStartedAt: undefined,
            rebuildOperationId: undefined,
          });
        }
        return NextResponse.json(
          { ok: true, data: { status: "success", startedAt } },
          { status: 200 }
        );
      } catch (error) {
        if (localProjectStore.getRecord(projectId)?.rebuildOperationId === rebuildOperationId) {
          localProjectStore.update(projectId, {
            rebuildStatus: "error",
            rebuildStartedAt: undefined,
            rebuildOperationId: undefined,
          });
        }
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
      let status = rec?.rebuildStatus || "idle";
      if (status === "rebuilding") {
        const startedAt = Date.parse(rec?.rebuildStartedAt || "");
        if (!Number.isFinite(startedAt) || Date.now() - startedAt > LOCAL_REBUILD_TIMEOUT_MS) {
          status = "idle";
          localProjectStore.update(projectId, {
            rebuildStatus: "idle",
            rebuildStartedAt: undefined,
            rebuildOperationId: undefined,
          });
        }
      }
      return NextResponse.json({ ok: true, data: { status } }, { status: 200 });
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
    const session = verifyAuthSession(req.cookies.get(AUTH_COOKIE)?.value);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Sign in with Google to continue" }, { status: 401 });
    }
    const { path } = await params;

    // Route to local orchestrator when in local mode
    if (IS_LOCAL_MODE) {
      if (isPreviewInitiatedRequest(req)) {
        return NextResponse.json({ ok: false, error: "Preview applications cannot access builder APIs" }, { status: 403 });
      }
      const tenant = tenantContextForIdentity(session.sub);
      const response = await handleLocalRequest(req, path, tenant.tenantId);
      return attachLocalTenantCookie(response, tenant);
    }

    // Cloud mode forwards one privileged operator credential. It is deliberately
    // single-operator until a deployment supplies its own user/project mapping;
    // never expose that key's complete project set to any signed-in user.
    if (!isCloudOperator(session)) {
      return NextResponse.json({ ok: false, error: "This account is not enrolled as a cloud operator" }, { status: 403 });
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
