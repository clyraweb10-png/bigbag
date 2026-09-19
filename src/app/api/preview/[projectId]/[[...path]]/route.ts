import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
    authFailed,
    enforceProjectScope,
    isRoutableProjectSlug,
    resolveVcaasContext,
} from "../../../vcaas/_shared";
import { vcaasRequest } from "@/lib/vcaas-server";
import { getPreviewUrl } from "@/lib/project-status";
import type { VcaasProject } from "@/lib/vcaas-types";
import { AGENT_PATH, AGENT_SOURCE, PREVIEW_RUNTIME_SHIM } from "@/lib/visual-edit-agent";
import { injectAgent, rewriteCss, rewriteHtml, rewriteJavaScript } from "@/lib/preview-proxy";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { durableProjectStore } from "@/lib/local-orchestrator/durable-project-store";
import { localSandboxManager } from "@/lib/local-orchestrator/sandbox-manager";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";
import {
    createPreviewWriteCapability,
    resolveLocalTenant,
    verifyPreviewWriteCapability,
} from "@/lib/local-orchestrator/tenant-context";

export const dynamic = "force-dynamic";

/**
 * ═══ THE SANDBOXED PREVIEW PROXY (the visual editor) ═════════════════════════════
 *
 * ⚠️⚠️ WHY THIS EXISTS — THE FINDING THAT DECIDED THE WHOLE FEATURE.
 *
 * A visual editor needs code inside the previewed app to hit-test clicks, outline
 * elements, read classes and apply temporary edits. The workspace must not access
 * that untrusted DOM directly.
 *
 * The obvious way out is the one the legacy Angular editor used: the generated
 * projects ship a `ScriptExecutor` component that accepts an `inject-editor-script`
 * `postMessage` and `new Function()`s it. **It does not work, and cannot.** Its very
 * first line is `if (process.env.NODE_ENV === 'production') return;`, Next.js inlines
 * that constant at build time, and the preview is served by `npm start` — a
 * PRODUCTION build. Verified, not assumed: a real `next build` of
 * `nextjs-startum-template` contains **zero** occurrences of `inject-editor-script`
 * anywhere in `.next` — the handler is dead-code-eliminated. The legacy editor's
 * injection is inert against every preview this platform shows.
 *
 * The alternative — writing an agent into the user's own project — would modify
 * their code and cost a 1-4 minute rebuild before the editor could be used at all.
 *
 * So this route injects a small agent into the HTML it serves. The iframe remains
 * an opaque-origin browser sandbox and communicates through a per-frame correlation
 * channel; nothing about the user's project changes.
 *
 * ── THE SECURITY BOUNDARY ───────────────────────────────────────────────────
 *
 * 1. **Session first.** `resolveVcaasContext()` runs before anything else; an
 *    unauthenticated request never reaches upstream.
 * 2. **The upstream origin is RESOLVED SERVER-SIDE from the project**, via the
 *    caller's own VCaaS key — it is never taken from the request. There is no
 *    parameter here that names a URL, so this cannot be turned into an SSRF probe:
 *    the only reachable host is the preview of a project this session owns.
 * 3. **Ownership is upstream's answer.** `GET /projects/:id` with the user's key
 *    404s for a project they do not own, and we return 404 unchanged.
 * 4. **Only the resolved origin is fetched.** Redirects are followed manually and
 *    refused if they leave that origin.
 * 5. **The agent is served by this route** and talks to the workspace over
 *    `postMessage`, pinned to the exact iframe window and a random channel.
 * 6. **`set-cookie` is dropped.** The previewed app's cookies must not be written
 *    onto the platform's origin, where they would sit next to the session cookie.
 *
 * In local-orchestrator mode this route is also the permanent Render preview
 * host. Every preview document remains sandboxed without same-origin privileges;
 * `editor=1` only enables the owner-gated editor agent flow.
 */

function previewBootPage(): NextResponse {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="2" />
  <title>Starting preview</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      font-family: ui-sans-serif, system-ui, sans-serif; background:#151513; color:#a1a1aa; }
    .card { text-align:center; }
    .spin { width:28px; height:28px; margin:0 auto 12px; border:2px solid #3f3f46; border-top-color:#818cf8;
      border-radius:50%; animation:s .8s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spin"></div>
    <p>Starting live preview…</p>
  </div>
</body>
</html>`;
    return new NextResponse(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
}

const APP_DATA_PATH = "__bigbag";
const APP_DATA_MAX_BODY_BYTES = 64 * 1024;

function appDataHeaders(): HeadersInit {
    return {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
        "access-control-allow-headers": "content-type, x-bigbag-capability",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    };
}

function appDataJson(
    body: { ok: boolean; data?: unknown; error?: string },
    status = 200
): NextResponse {
    return NextResponse.json(body, { status, headers: appDataHeaders() });
}

async function readAppDataBody(request: NextRequest): Promise<Record<string, unknown>> {
    const declaredSize = Number(request.headers.get("content-length") || "0");
    if (declaredSize > APP_DATA_MAX_BODY_BYTES) throw new Error("Record is too large");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > APP_DATA_MAX_BODY_BYTES) throw new Error("Record is too large");
    const parsed = JSON.parse(raw || "{}");
    const data = parsed?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Request body must contain a data object");
    }
    return data as Record<string, unknown>;
}

/**
 * Public, project-scoped CRUD used by generated apps. This is intentionally not
 * the builder API: it exposes no tenant cookie, source, provider key, or project
 * operation. Generated applications that need end-user auth must implement that
 * policy in their own UI before exposing write controls.
 */
async function serveAppData(
    request: NextRequest,
    projectId: string,
    segments: string[]
): Promise<NextResponse> {
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: appDataHeaders() });
    const [, scope, collection, recordId, ...extra] = segments;
    if (scope !== "data" || !collection || extra.length > 0) {
        return appDataJson({ ok: false, error: "Invalid data path" }, 404);
    }

    try {
        if (request.method === "GET") {
            if (recordId) {
                const record = await durableProjectStore.getAppRecord(projectId, collection, recordId);
                return record
                    ? appDataJson({ ok: true, data: record })
                    : appDataJson({ ok: false, error: "Record not found" }, 404);
            }
            const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || "50");
            const requestedOffset = Number(request.nextUrl.searchParams.get("offset") || "0");
            const limit = Number.isInteger(requestedLimit)
                ? Math.min(200, Math.max(1, requestedLimit))
                : 50;
            const offset = Number.isInteger(requestedOffset)
                ? Math.max(0, requestedOffset)
                : 0;
            const data = await durableProjectStore.listAppRecords(projectId, collection, { limit, offset });
            return appDataJson({ ok: true, data });
        }
        const tenantId = verifyPreviewWriteCapability(
            request.headers.get("x-bigbag-capability"),
            projectId
        );
        if (!tenantId) return appDataJson({ ok: false, error: "Write authorization required" }, 401);
        if (!(await localProjectStore.hydrateProject(projectId, tenantId))) {
            return appDataJson({ ok: false, error: "Project not found" }, 404);
        }
        if (request.method === "POST" && !recordId) {
            const data = await durableProjectStore.createAppRecord(
                projectId,
                collection,
                await readAppDataBody(request)
            );
            return appDataJson({ ok: true, data }, 201);
        }
        if (request.method === "PATCH" && recordId) {
            const data = await durableProjectStore.updateAppRecord(
                projectId,
                collection,
                recordId,
                await readAppDataBody(request)
            );
            return data
                ? appDataJson({ ok: true, data })
                : appDataJson({ ok: false, error: "Record not found" }, 404);
        }
        if (request.method === "DELETE" && recordId) {
            const deleted = await durableProjectStore.deleteAppRecord(projectId, collection, recordId);
            return deleted
                ? appDataJson({ ok: true, data: { deleted: true } })
                : appDataJson({ ok: false, error: "Record not found" }, 404);
        }
        return appDataJson({ ok: false, error: "Method not allowed" }, 405);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Database request failed";
        const clientError = error instanceof SyntaxError || /invalid|must contain|too large/i.test(message);
        if (clientError) return appDataJson({ ok: false, error: message }, 400);
        console.error("[preview-data] Request failed", error);
        return appDataJson({ ok: false, error: "Database request failed" }, 500);
    }
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

async function servePersistentDeployment(
    request: NextRequest,
    projectId: string,
    segments: string[],
    writeCapability?: string
): Promise<NextResponse> {
    const requestedPath = segments.length > 0 ? segments.join("/") : "index.html";
    let file = await durableProjectStore.readDeploymentFile(projectId, requestedPath);
    if (!file && requestedPath.startsWith("uploads/")) {
        file = await durableProjectStore.readPublicSourceFile(projectId, `public/${requestedPath}`);
    }
    if (!file && !requestedPath.split("/").at(-1)?.includes(".")) {
        file = await durableProjectStore.readDeploymentFile(projectId, "index.html");
    }
    if (!file) {
        // For document requests (browser navigation), show a friendly boot page
        // with auto-refresh instead of raw JSON. The user sees this as "starting"
        // and the iframe will auto-retry every 2 seconds.
        const wantsDocument = request.method === "GET" &&
            (request.headers.get("accept") || "").includes("text/html");
        if (wantsDocument) return previewBootPage();
        return NextResponse.json(
            { ok: false, error: "This project has no persistent deployment yet", code: "NO_PREVIEW" },
            { status: 404, headers: { "cache-control": "no-store" } }
        );
    }

    const extension = file.path.slice(file.path.lastIndexOf(".")).toLowerCase();
    const contentType = STATIC_CONTENT_TYPES[extension] || "application/octet-stream";
    const base = `/api/preview/${encodeURIComponent(projectId)}`;
    const isHtml = contentType.includes("text/html");
    const isHashedAsset = /^assets\/.+-[a-z0-9_-]{8,}\.[^/]+$/i.test(file.path);
    const headers = new Headers({
        "content-type": contentType,
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "*",
        "cache-control": isHtml
            ? "no-store"
            : isHashedAsset
              ? "public, max-age=31536000, immutable"
              : "public, max-age=300, must-revalidate",
        "x-content-type-options": "nosniff",
        "content-security-policy": "frame-ancestors *; sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads",
    });
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    if (request.method === "HEAD") return new NextResponse(null, { status: 200, headers });

    if (isHtml) {
        const html = Buffer.from(file.content).toString("utf8");
        return new NextResponse(
            injectWriteCapability(injectAgent(rewriteHtml(html, base), base), writeCapability),
            { status: 200, headers }
        );
    }
    if (contentType.includes("text/css")) {
        return new NextResponse(rewriteCss(Buffer.from(file.content).toString("utf8"), base), { status: 200, headers });
    }
    if (contentType.includes("javascript")) {
        return new NextResponse(rewriteJavaScript(Buffer.from(file.content).toString("utf8"), base), { status: 200, headers });
    }
    return new NextResponse(file.content, { status: 200, headers });
}

async function proxyLocalDevelopment(
    request: NextRequest,
    projectId: string,
    segments: string[],
    origin: string,
    writeCapability?: string
): Promise<NextResponse> {
    const target = new URL(origin);
    target.pathname = `/${segments.join("/")}`;
    target.search = request.nextUrl.search;

    const requestHeaders = new Headers();
    request.headers.forEach((value, key) => {
        if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) requestHeaders.set(key, value);
    });
    requestHeaders.set("accept-encoding", "identity");
    const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: request.method,
            headers: requestHeaders,
            body,
            redirect: "manual",
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        const wantsDocument = request.method === "GET" &&
            (request.headers.get("accept") || "").includes("text/html");
        return wantsDocument
            ? previewBootPage()
            : NextResponse.json(
                { ok: false, error: "Local preview is unavailable" },
                { status: 502, headers: { "cache-control": "no-store" } }
            );
    }

    const headers = new Headers();
    upstream.headers.forEach((value, key) => {
        if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
    });
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
    headers.set("access-control-allow-headers", "*");
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set(
        "content-security-policy",
        "frame-ancestors *; sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads"
    );
    const base = `/api/preview/${encodeURIComponent(projectId)}`;
    const location = headers.get("location");
    if (location) {
        try {
            const resolvedLocation = new URL(location, target);
            if (resolvedLocation.origin !== target.origin) {
                return NextResponse.json(
                    { ok: false, error: "The local preview attempted an unsafe redirect" },
                    { status: 502, headers: { "cache-control": "no-store" } }
                );
            }
            headers.set("location", `${base}${resolvedLocation.pathname}${resolvedLocation.search}`);
        } catch {
            headers.delete("location");
        }
    }
    if (request.method === "HEAD") return new NextResponse(null, { status: upstream.status, headers });

    const contentType = headers.get("content-type") || "";
    const bytes = await upstream.arrayBuffer();
    if (contentType.includes("text/html")) {
        return new NextResponse(
            injectWriteCapability(
                injectAgent(rewriteHtml(new TextDecoder().decode(bytes), base), base),
                writeCapability
            ),
            { status: upstream.status, headers }
        );
    }
    if (contentType.includes("text/css")) {
        return new NextResponse(rewriteCss(new TextDecoder().decode(bytes), base), { status: upstream.status, headers });
    }
    if (contentType.includes("javascript")) {
        return new NextResponse(rewriteJavaScript(new TextDecoder().decode(bytes), base), { status: upstream.status, headers });
    }
    return new NextResponse(bytes, { status: upstream.status, headers });
}

function injectWriteCapability(html: string, capability?: string): string {
    if (!capability) return html;
    const script = `<script>window.__BIGBAG_WRITE_CAPABILITY__=${JSON.stringify(capability)};</script>`;
    return /<head(?:\s[^>]*)?>/i.test(html)
        ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${script}`)
        : `${script}${html}`;
}

const STRIPPED_REQUEST_HEADERS = new Set([
    "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "cookie", "origin", "referer",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
    "connection", "keep-alive", "transfer-encoding", "upgrade", "content-encoding",
    "content-length", "set-cookie", "content-security-policy",
    "content-security-policy-report-only", "x-frame-options", "strict-transport-security",
]);

/**
 * ═══ THE RESOLVED ORIGIN, MEMOISED FOR A FEW SECONDS ════════════════════════
 *
 * ⚠️⚠️ WITHOUT THIS, ONE PAGE LOAD PAYS THE SAME EXPENSIVE QUESTION FIVE TIMES.
 * Every request through this proxy — the document AND each asset — called
 * `GET /projects/:id`, and that call is NOT cheap: on the account-backend it runs
 * `computeDevelopmentUrlRecommendation`, which probes the sandbox's HTML **twice**.
 * Against a sleeping sandbox each round trip is seconds, not milliseconds.
 *
 * ⭐ MEASURED, ON THE REPORTED PROJECT: raw upstream 3.2 s per request, but 7.9 s
 * through this proxy — 4.7 s of it this one call, repeated per asset. That turned
 * the broken-preview check (1 document + 4 probes, then a confirming pass) into a
 * **~42-second** wait before the user was told anything, which is
 * indistinguishable from "the feature does not work". It is what they reported.
 *
 * ⚠️ KEYED BY THE CALLER, NOT JUST THE PROJECT — this is a security property, not
 * a detail. The origin is resolved with the CALLER'S OWN key and ownership is
 * upstream's answer (a project you do not own 404s). A cache keyed on `projectId`
 * alone would let one user's successful resolution answer another user's request.
 * With `accountUserId` in the key, a non-owner always misses and always re-asks.
 *
 * ⚠️ THE TTL IS DELIBERATELY SHORTER THAN ANYTHING THAT CAN CHANGE THE ANSWER.
 * `getPreviewUrl`'s contract is that the field is re-read on navigation, on manual
 * refresh and whenever a run finishes — all of which take far longer than this. So
 * this can only ever collapse a BURST of requests that belong to one page load; it
 * cannot serve a stale origin across a rebuild.
 *
 * ⚠️ FAILURES ARE NEVER CACHED. A 404/409 stays a live question, so a project that
 * has just acquired a preview is not told "no preview" for another 15 seconds.
 */
const ORIGIN_TTL_MS = 15_000;
const originCache = new Map<string, { origin: string; at: number }>();

function cachedOrigin(key: string): string | null {
    const hit = originCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > ORIGIN_TTL_MS) {
        originCache.delete(key);
        return null;
    }
    return hit.origin;
}

function rememberOrigin(key: string, origin: string): void {
    /**
     * A bound so a long-lived server cannot accumulate an entry per project seen.
     * Well above any real fan-out; the oldest insertion goes first.
     */
    if (originCache.size > 500) {
        const oldest = originCache.keys().next().value;
        if (oldest !== undefined) originCache.delete(oldest);
    }
    originCache.set(key, { origin, at: Date.now() });
}

async function resolvePreviewOrigin(
    projectId: string,
    ctx: Parameters<typeof vcaasRequest>[2]
): Promise<{ origin: string } | { error: NextResponse }> {
    const cacheKey = `${ctx?.accountUserId ?? ""}:${projectId}`;
    const hit = cachedOrigin(cacheKey);
    if (hit) return { origin: hit };

    const response = await vcaasRequest(`/projects/${encodeURIComponent(projectId)}`, {}, ctx);
    const payload = (await response.json().catch(() => null)) as { data?: VcaasProject } | null;

    if (!response.ok || !payload?.data) {
        return { error: NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 }) };
    }

    const previewUrl = getPreviewUrl(payload.data);
    if (!previewUrl) {
        return {
            error: NextResponse.json(
                { ok: false, error: "This project has no preview yet", code: "NO_PREVIEW" },
                { status: 409 }
            ),
        };
    }

    try {
        const url = new URL(previewUrl);
        // http/https only — a `javascript:` or `file:` value upstream must not be followed.
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
        // Only a SUCCESSFUL resolution is remembered — see the note on the cache.
        rememberOrigin(cacheKey, url.origin);
        return { origin: url.origin };
    } catch {
        return { error: NextResponse.json({ ok: false, error: "Bad preview URL" }, { status: 502 }) };
    }
}

async function handle(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; path?: string[] }> }
) {
    const { projectId, path } = await params;

    // 1. If projectId is not a valid slug (e.g. "index.html" or an asset that escaped relative resolution),
    // rescue it using the Referer header so preview never breaks with "Invalid project"
    if (!isRoutableProjectSlug(projectId)) {
        const referer = request.headers.get("referer");
        if (referer) {
            const m = referer.match(/\/api\/preview\/([a-zA-Z0-9_-]+)/) || referer.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (m && isRoutableProjectSlug(m[1])) {
                const realProject = m[1];
                const realSubpath = [projectId, ...(path ?? [])].join("/");
                const targetUrl = new URL(`/api/preview/${encodeURIComponent(realProject)}/${realSubpath}`, request.url);
                targetUrl.search = request.nextUrl.search;
                return NextResponse.redirect(targetUrl, 307);
            }
        }
        return NextResponse.json({ ok: false, error: "Invalid project" }, { status: 404 });
    }

    // 2. Enforce trailing slash for root preview documents so relative assets resolve within the project scope
    if ((!path || path.length === 0) && !request.nextUrl.pathname.endsWith("/")) {
        const url = new URL(request.url);
        url.pathname = `${url.pathname}/`;
        return NextResponse.redirect(url, 308);
    }

    const IS_LOCAL = isLocalOrchestratorEnabled();

    let auth: any;
    if (!IS_LOCAL) {
        auth = await resolveVcaasContext();
        if (authFailed(auth)) return auth.response;

        const outOfScope = enforceProjectScope(auth.team, "GET", ["projects", projectId]);
        if (outOfScope) return outOfScope;
    }

    /**
     * ⭐ THE AGENT IS SERVED BY US, NOT PROXIED. It never touches the user's
     * project, and because it comes from this origin the previewed document can be
     * scripted by the workspace at all. In local mode the editor document itself
     * is owner-gated; the static agent contains no tenant data or API capability.
     */
    if ((path ?? []).length === 1 && path![0] === AGENT_PATH) {
        /**
         * ⭐ THE SHIM SHIPS AHEAD OF THE AGENT, IN ONE FILE.
         *
         * One file rather than two script tags because the ORDER is not negotiable:
         * the runtime URL shim must have patched `document.createElement` and `fetch`
         * before anything else executes. Concatenation makes that ordering
         * structural instead of dependent on how the browser schedules two requests.
         */
        const base = `/api/preview/${encodeURIComponent(projectId)}`;
        const body = `${PREVIEW_RUNTIME_SHIM(base)}\n${AGENT_SOURCE}`;
        return new NextResponse(body, {
            status: 200,
            headers: {
                "content-type": "application/javascript; charset=utf-8",
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET, HEAD, OPTIONS",
                "cache-control": "no-store",
            },
        });
    }

    const targetSegments = path ?? [];
    if (targetSegments.some((segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0")
    )) {
        return NextResponse.json({ ok: false, error: "Invalid preview path" }, { status: 400 });
    }

    // Local-orchestrator previews are immutable build artifacts stored outside
    // E2B and served by this existing Render application. Viewing never creates,
    // resumes, or contacts a sandbox.
    if (IS_LOCAL) {
        const trustedEditor = request.nextUrl.searchParams.get("editor") === "1";
        let writeCapability: string | undefined;
        if (trustedEditor) {
            const tenant = resolveLocalTenant(request);
            if (!(await localProjectStore.hydrateProject(projectId, tenant.tenantId))) {
                return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
            }
            writeCapability = createPreviewWriteCapability(projectId, tenant.tenantId);
        }
        if (targetSegments[0] === APP_DATA_PATH) {
            return serveAppData(request, projectId, targetSegments);
        }
        const localRecord = localProjectStore.getRecord(projectId);
        const usesDisposableE2b = process.env.SANDBOX_PROVIDER?.trim().toLowerCase() === "e2b";
        const runningOrigin = localSandboxManager.getRunningOrigin(projectId) ||
            (!usesDisposableE2b && localRecord?.serverStatus === "Active"
                ? `http://127.0.0.1:${localRecord.port}`
                : null);
        if (runningOrigin) {
            return proxyLocalDevelopment(request, projectId, targetSegments, runningOrigin, writeCapability);
        }
        return servePersistentDeployment(request, projectId, targetSegments, writeCapability);
    }

    const resolved = await resolvePreviewOrigin(projectId, auth?.ctx);
    if ("error" in resolved) return resolved.error;

    // Assigning pathname lets the URL implementation escape unsafe characters
    // while preserving Vite's meaningful `@` paths. encodeURIComponent turned
    // `/@vite/client` into `/%40vite/client`, which Vite correctly answered 404.
    const target = new URL(resolved.origin);
    target.pathname = `/${targetSegments.join("/")}`;
    target.search = request.nextUrl.search;

    // Forward the request, minus the headers that would confuse the upstream or
    // leak our own identity into it.
    const headers = new Headers();
    request.headers.forEach((value, key) => {
        if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
    });
    // Ask for an unencoded body so the HTML rewrite below does not have to gunzip.
    headers.set("accept-encoding", "identity");

    const bodyBuffer = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

    let upstream: Response | null = null;
    const isDocument = (!path || path.length === 0) && request.method === "GET";
    const MAX_ATTEMPTS = isDocument ? 12 : 4;
    const perAttemptMs = isDocument ? 8000 : 4000;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers,
                body: bodyBuffer,
                redirect: "manual",
                cache: "no-store",
                signal: AbortSignal.timeout(perAttemptMs),
            });
            break;
        } catch (fetchErr) {
            console.log(`[preview] Fetch attempt ${attempt + 1}/${MAX_ATTEMPTS} failed for ${target.toString()}:`, fetchErr);
            if (attempt < MAX_ATTEMPTS - 1) {
                await new Promise((resolve) => setTimeout(resolve, isDocument ? 700 : 300));
            }
        }
    }

    if (!upstream) {
        originCache.delete(`local:${projectId}`);
        if ((!path || path.length === 0) && request.method === "GET") {
            return previewBootPage();
        }
        return NextResponse.json(
            { ok: false, error: "The preview server did not respond", code: "PREVIEW_UNREACHABLE" },
            { status: 502 }
        );
    }

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
        if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
    });
    responseHeaders.set("access-control-allow-origin", "*");
    responseHeaders.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");

    const base = `/api/preview/${encodeURIComponent(projectId)}`;

    // ── Redirects stay inside the proxy, and inside the origin ──────────────
    const location = upstream.headers.get("location");
    if (location) {
        try {
            const next = new URL(location, target);
            if (next.origin !== resolved.origin) {
                // Leaving the preview origin ends the proxy's remit.
                return NextResponse.json({ ok: false, error: "Blocked cross-origin redirect" }, { status: 502 });
            }
            responseHeaders.set("location", `${base}${next.pathname}${next.search}`);
        } catch {
            responseHeaders.delete("location");
        }
        return new NextResponse(null, { status: upstream.status, headers: responseHeaders });
    }

    const contentType = upstream.headers.get("content-type") || "";

    // ── HTML: rewrite root-absolute URLs, then inject the agent ─────────────
    if (contentType.includes("text/html")) {
        const html = await upstream.text();
        const rewritten = injectAgent(rewriteHtml(html, base), base);
        responseHeaders.set("content-type", "text/html; charset=utf-8");
        responseHeaders.set("cache-control", "no-store");
        return new NextResponse(rewritten, { status: upstream.status, headers: responseHeaders });
    }

    // ── CSS: rewrite root-absolute url() so webfonts resolve ───────────
    if (contentType.includes("text/css")) {
        const css = await upstream.text();
        responseHeaders.set("content-type", contentType);
        return new NextResponse(rewriteCss(css, base), { status: upstream.status, headers: responseHeaders });
    }

    // ── JavaScript: Vite's root-absolute static imports need the proxy base ──
    if (
        contentType.includes("javascript") ||
        contentType.includes("ecmascript") ||
        contentType.includes("typescript")
    ) {
        const source = await upstream.text();
        responseHeaders.set("content-type", contentType);
        responseHeaders.set("cache-control", "no-store");
        return new NextResponse(rewriteJavaScript(source, base), {
            status: upstream.status,
            headers: responseHeaders,
        });
    }

    // Everything else (images, JSON, fonts) is streamed through untouched.
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
