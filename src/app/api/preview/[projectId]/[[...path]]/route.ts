import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
import { BookingConflictError, BookingInputError, durableProjectStore } from "@/lib/local-orchestrator/durable-project-store";
import { localSandboxManager } from "@/lib/local-orchestrator/sandbox-manager";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";
import { AUTH_COOKIE, verifyAuthSession } from "@/lib/auth-session";
import { getSupabaseAdminClient, getSupabaseAnonKey, getSupabaseClient, getSupabaseUrl } from "@/lib/supabase";
import {
    createPreviewGuestCapability,
    createPreviewWriteCapability,
    consumePreviewGuestMutationBudget,
    openPreviewAuthStorageRecord,
    PREVIEW_GUEST_COOKIE,
    resolvePreviewGuest,
    sealPreviewAuthStorage,
    tenantContextForIdentity,
    verifyPreviewGuestCapability,
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
  <meta http-equiv="refresh" content="5" />
  <title>Starting preview</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      font-family: ui-sans-serif, system-ui, sans-serif; background:#1d1d1c; color:#a1a1aa; }
    .card { text-align:center; }
    .spin { width:28px; height:28px; margin:0 auto 12px; border:2px solid #3f3f46; border-top-color:#948be8;
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
        // A boot page is not a validated application preview. In particular,
        // health checks and qualification runs must not treat it as success.
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "5" },
    });
}

const APP_DATA_PATH = "__bigbag";
const APP_DATA_MAX_BODY_BYTES = 64 * 1024;
const PRIVATE_FILE_BUCKET = "bigbag-generated-files";
const PRIVATE_FILE_MAX_BYTES = 8 * 1024 * 1024;
const PRIVATE_FILE_LIMIT_PER_USER = 50;
const PREVIEW_GUEST_PROJECT_RECORD_LIMIT = 500;
const PREVIEW_AUTH_STORAGE_COOKIE = "bigbag_preview_auth";

function previewAuthStorageKey(projectId: string): string {
    return `bigbag-preview-${projectId}-auth`;
}

function appDataHeaders(): HeadersInit {
    return {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, x-bigbag-capability, x-bigbag-guest, x-bigbag-file-name, x-bigbag-folder-id",
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

function previewAuthStorageHeaders(request: NextRequest): HeadersInit {
    const origin = request.headers.get("origin");
    return {
        "access-control-allow-origin": origin === "null" || origin === request.nextUrl.origin ? origin : "null",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, x-bigbag-guest",
        "cache-control": "no-store",
        "vary": "origin",
        "x-content-type-options": "nosniff",
    };
}

function previewAuthCookieOptions(request: NextRequest): {
    secure: boolean;
    sameSite: "lax" | "none";
} {
    const forwardedProtocol = request.headers.get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim()
        .toLowerCase();
    const hostname = request.nextUrl.hostname.toLowerCase();
    const localSecureContext = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const secure = request.nextUrl.protocol === "https:" || forwardedProtocol === "https" || localSecureContext;
    return { secure, sameSite: secure ? "none" : "lax" };
}

function newestPreviewAuthValue(
    durableToken: string | null,
    cookieToken: string | undefined,
    projectId: string,
    guestId: string,
    key: string
): string | null {
    const durable = openPreviewAuthStorageRecord(durableToken || undefined, projectId, guestId, key);
    const cookie = openPreviewAuthStorageRecord(cookieToken, projectId, guestId, key);
    if (!durable) return cookie?.value ?? null;
    if (!cookie) return durable.value;
    return cookie.sealedAt > durable.sealedAt ? cookie.value : durable.value;
}

async function servePreviewAuthStorage(request: NextRequest, projectId: string): Promise<NextResponse> {
    const headers = previewAuthStorageHeaders(request);
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    const guestId = verifyPreviewGuestCapability(request.headers.get("x-bigbag-guest"), projectId);
    if (!guestId) return NextResponse.json({ error: "Preview session authorization required" }, { status: 401, headers });
    const key = request.nextUrl.searchParams.get("key")?.trim() || "";
    if (key !== previewAuthStorageKey(projectId)) {
        return NextResponse.json({ error: "Invalid storage key" }, { status: 400, headers });
    }

    if (request.method === "GET") {
        let stored: string | null = null;
        try {
            stored = await durableProjectStore.readPreviewAuthStorage(projectId, guestId, key);
        } catch (error) {
            console.warn("[preview-auth] Durable session read unavailable; using the encrypted cookie fallback", {
                projectId,
                error: error instanceof Error ? error.message : "Unknown storage error",
            });
        }
        const value = newestPreviewAuthValue(
            stored,
            request.cookies.get(PREVIEW_AUTH_STORAGE_COOKIE)?.value,
            projectId,
            guestId,
            key
        );
        return NextResponse.json({ value }, { headers });
    }
    if (request.method === "DELETE") {
        let durableStored: string | null = null;
        let durableReadFailed = false;
        try {
            durableStored = await durableProjectStore.readPreviewAuthStorage(projectId, guestId, key);
        } catch (error) {
            durableReadFailed = true;
            console.warn("[preview-auth] Durable session read unavailable during sign-out", {
                projectId,
                error: error instanceof Error ? error.message : "Unknown storage error",
            });
        }
        const storedValue = newestPreviewAuthValue(
            durableStored,
            request.cookies.get(PREVIEW_AUTH_STORAGE_COOKIE)?.value,
            projectId,
            guestId,
            key
        );
        if (storedValue === null && !durableReadFailed) return NextResponse.json({ ok: true }, { headers });
        try {
            await durableProjectStore.deletePreviewAuthStorage(projectId, guestId, key);
        } catch (error) {
            console.warn("[preview-auth] Durable session delete unavailable; preserving the cookie so sign-out can be retried", {
                projectId,
                error: error instanceof Error ? error.message : "Unknown storage error",
            });
            return NextResponse.json({ error: "Secure session sign-out is temporarily unavailable" }, { status: 503, headers });
        }
        const response = NextResponse.json({ ok: true }, { headers });
        const cookieSecurity = previewAuthCookieOptions(request);
        response.cookies.set(PREVIEW_AUTH_STORAGE_COOKIE, "", {
            httpOnly: true,
            ...cookieSecurity,
            path: `/api/preview/${encodeURIComponent(projectId)}`,
            maxAge: 0,
        });
        return response;
    }
    if (request.method === "POST") {
        const raw = await request.text();
        if (Buffer.byteLength(raw, "utf8") > 16_000) {
            return NextResponse.json({ error: "Session value is too large" }, { status: 413, headers });
        }
        let value: unknown;
        try {
            value = (JSON.parse(raw || "{}") as { value?: unknown }).value;
        } catch {
            return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
        }
        if (typeof value !== "string") {
            return NextResponse.json({ error: "Session value must be a string" }, { status: 400, headers });
        }
        let sealed: string;
        try {
            sealed = sealPreviewAuthStorage(projectId, guestId, key, value);
        } catch {
            return NextResponse.json({ error: "Session value is invalid" }, { status: 400, headers });
        }
        if (sealed.length > 3_800) {
            return NextResponse.json({ error: "Session value exceeds secure cookie capacity" }, { status: 413, headers });
        }
        const cookieSecurity = previewAuthCookieOptions(request);
        try {
            await durableProjectStore.writePreviewAuthStorage(projectId, guestId, key, sealed);
        } catch (error) {
            console.warn("[preview-auth] Durable session write unavailable", {
                projectId,
                error: error instanceof Error ? error.message : "Unknown storage error",
            });
            if (cookieSecurity.sameSite !== "none") {
                return NextResponse.json({ error: "Secure session persistence is temporarily unavailable" }, { status: 503, headers });
            }
        }
        const response = NextResponse.json({ ok: true }, { headers });
        response.cookies.set(PREVIEW_AUTH_STORAGE_COOKIE, sealed, {
            httpOnly: true,
            // The preview document intentionally has an opaque origin, so this
            // same-host fetch is a third-party context from the browser's view.
            ...cookieSecurity,
            path: `/api/preview/${encodeURIComponent(projectId)}`,
            maxAge: 60 * 60 * 24 * 30,
        });
        return response;
    }
    return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers });
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

class CommerceOrderValidationError extends Error {}
class CommerceSubscriptionValidationError extends Error {}

function verifiedCommercePlan(body: Record<string, unknown>, partial = false): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined || !partial) {
        if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 160) {
            throw new CommerceSubscriptionValidationError("Plan name is invalid");
        }
        data.name = body.name.trim();
    }
    if (body.description !== undefined) {
        if (typeof body.description !== "string" || body.description.length > 2_000) {
            throw new CommerceSubscriptionValidationError("Plan description is invalid");
        }
        data.description = body.description.trim();
    }
    if (body.priceCents !== undefined || !partial) {
        if (!Number.isSafeInteger(body.priceCents) || (body.priceCents as number) < 0 || (body.priceCents as number) > 100_000_000) {
            throw new CommerceSubscriptionValidationError("Plan price is invalid");
        }
        data.priceCents = body.priceCents;
    }
    if (body.interval !== undefined || !partial) {
        if (body.interval !== "monthly" && body.interval !== "yearly") {
            throw new CommerceSubscriptionValidationError("Plan interval is invalid");
        }
        data.interval = body.interval;
    }
    if (body.features !== undefined) {
        if (!Array.isArray(body.features) || body.features.length > 30 ||
            body.features.some((feature) => typeof feature !== "string" || !feature.trim() || feature.length > 240)) {
            throw new CommerceSubscriptionValidationError("Plan features are invalid");
        }
        data.features = body.features.map((feature: string) => feature.trim());
    }
    if (body.active !== undefined) {
        if (typeof body.active !== "boolean") throw new CommerceSubscriptionValidationError("Plan status is invalid");
        data.active = body.active;
    } else if (!partial) {
        data.active = true;
    }
    if (partial && Object.keys(data).length === 0) throw new CommerceSubscriptionValidationError("Plan changes are empty");
    return data;
}

async function verifiedCommerceSubscription(projectId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof body.planId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.planId)) {
        throw new CommerceSubscriptionValidationError("Subscription plan is invalid");
    }
    const plan = await durableProjectStore.getAppRecord(projectId, "plans", body.planId);
    if (!plan || plan.active !== true || typeof plan.name !== "string" ||
        !Number.isSafeInteger(plan.priceCents) || (plan.priceCents as number) < 0 ||
        (plan.interval !== "monthly" && plan.interval !== "yearly")) {
        throw new CommerceSubscriptionValidationError("Selected plan is unavailable");
    }
    return { planId: body.planId, planName: plan.name, priceCents: plan.priceCents,
        interval: plan.interval, status: "pending_payment" };
}

async function verifiedCommerceOrder(projectId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
        throw new CommerceOrderValidationError("An order needs between 1 and 50 products");
    }
    const contact: Record<string, string> = {};
    const contactLimits: Record<string, number> = { customerName: 160, email: 254, address: 2_000, phone: 40, notes: 2_000 };
    for (const [field, limit] of Object.entries(contactLimits)) {
        const value = body[field];
        if (value === undefined || value === null || value === "") continue;
        if (typeof value !== "string" || value.trim().length > limit) {
            throw new CommerceOrderValidationError(`Order ${field} is invalid`);
        }
        contact[field] = value.trim();
    }
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
        throw new CommerceOrderValidationError("Order email is invalid");
    }
    const items = [];
    let subtotalCents = 0;
    const requestedVariantQuantities = new Map<string, number>();
    for (const rawItem of body.items) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
            throw new CommerceOrderValidationError("Order items are invalid");
        }
        const item = rawItem as Record<string, unknown>;
        const productId = item.productId;
        const qty = item.qty;
        if (typeof productId !== "string" || !/^[a-f0-9-]{36}$/i.test(productId) ||
            !Number.isSafeInteger(qty) || (qty as number) < 1 || (qty as number) > 100) {
            throw new CommerceOrderValidationError("Order product or quantity is invalid");
        }
        const product = await durableProjectStore.getAppRecord(projectId, "products", productId);
        if (!product || product.active === false ||
            typeof product.name !== "string" || !Number.isSafeInteger(product.priceCents) ||
            (product.priceCents as number) < 0) {
            throw new CommerceOrderValidationError("A selected product is unavailable");
        }
        const variants = Array.isArray(product.variants) ? product.variants : [];
        let variantLabel = "";
        let variantId: string | undefined;
        if (variants.length) {
            const variant = variants.find((candidate) => {
                if (!candidate || typeof candidate !== "object") return false;
                const value = candidate as Record<string, unknown>;
                const label = [value.color, value.size].filter((part) => typeof part === "string" && part).join(" / ");
                return (typeof item.variantId === "string" && value.id === item.variantId) ||
                    (typeof item.variantLabel === "string" && label === item.variantLabel);
            }) as Record<string, unknown> | undefined;
            if (!variant || typeof variant.id !== "string" || !variant.id.trim() ||
                !Number.isSafeInteger(variant.stock) || (variant.stock as number) < (qty as number)) {
                throw new CommerceOrderValidationError("The selected product option is unavailable");
            }
            variantId = variant.id.trim();
            variantLabel = [variant.color, variant.size].filter((part) => typeof part === "string" && part).join(" / ");
            // This checks the current catalogue only. Pending orders do not
            // reserve inventory; a payment integration must recheck it atomically.
            const stockKey = `${productId}:${variantId}`;
            const requested = (requestedVariantQuantities.get(stockKey) || 0) + (qty as number);
            if (requested > (variant.stock as number)) throw new CommerceOrderValidationError("The selected product option is unavailable");
            requestedVariantQuantities.set(stockKey, requested);
        }
        const lineTotal = (product.priceCents as number) * (qty as number);
        subtotalCents += lineTotal;
        if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 100_000_000) {
            throw new CommerceOrderValidationError("Order total is too large");
        }
        items.push({ productId, ...(variantId ? { variantId } : {}), name: product.name, variantLabel,
            unitPriceCents: product.priceCents, qty });
    }
    return { ...contact, items, subtotalCents, status: "pending_payment" };
}

async function serveProjectRole(request: NextRequest, projectId: string): Promise<NextResponse> {
    const project = localProjectStore.getRecord(projectId) || await durableProjectStore.loadRecordByProjectId(projectId);
    if (!project) return appDataJson({ ok: false, error: "Project not found" }, 404);
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer) {
        const capabilityTenantId = verifyPreviewWriteCapability(request.headers.get("x-bigbag-capability"), projectId);
        return appDataJson({ ok: true, data: { role: capabilityTenantId === project.tenantId ? "owner" : "visitor" } });
    }
    const supabase = getSupabaseAdminClient() || getSupabaseClient();
    if (!supabase) return appDataJson({ ok: false, error: "Authentication is not configured" }, 503);
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user) return appDataJson({ ok: false, error: "A valid user session is required" }, 401);
    const role = tenantContextForIdentity(data.user.id).tenantId === project.tenantId ? "owner" : "customer";
    return appDataJson({ ok: true, data: { role } });
}

async function servePrivateProjectFile(
    request: NextRequest,
    projectId: string,
    segments: string[]
): Promise<NextResponse> {
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: appDataHeaders() });
    const fileId = segments.length === 3 ? segments[2] : undefined;
    if (segments.length !== (fileId ? 3 : 2) || (fileId && !/^[a-z0-9-]{1,120}$/i.test(fileId))) {
        return appDataJson({ ok: false, error: "Invalid file path" }, 404);
    }
    if (!fileId && request.method !== "POST" || fileId && request.method !== "GET" && request.method !== "DELETE") {
        return appDataJson({ ok: false, error: "Method not allowed" }, 405);
    }
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer) return appDataJson({ ok: false, error: "Sign in to access private files" }, 401);
    const admin = getSupabaseAdminClient();
    if (!admin) return appDataJson({ ok: false, error: "Private file storage is not configured" }, 503);
    const { data: identity, error: identityError } = await admin.auth.getUser(bearer);
    if (identityError || !identity.user) return appDataJson({ ok: false, error: "A valid user session is required" }, 401);
    const project = localProjectStore.getRecord(projectId) || await durableProjectStore.loadRecordByProjectId(projectId);
    if (!project) return appDataJson({ ok: false, error: "Project not found" }, 404);
    if (!project.privateFilesEnabled) return appDataJson({ ok: false, error: "Private file storage is not enabled for this project" }, 403);
    const ownerId = identity.user.id;
    const storage = admin.storage.from(PRIVATE_FILE_BUCKET);

    if (!fileId) {
        const declaredSize = Number(request.headers.get("content-length") || "0");
        if (declaredSize > PRIVATE_FILE_MAX_BYTES) return appDataJson({ ok: false, error: "File exceeds the 8 MB limit" }, 413);
        let name: string;
        try { name = decodeURIComponent(request.headers.get("x-bigbag-file-name") || "").trim(); }
        catch { return appDataJson({ ok: false, error: "Invalid file name" }, 400); }
        if (!name || name.length > 180 || /[\\/\x00-\x1f\x7f]/.test(name)) {
            return appDataJson({ ok: false, error: "Choose a file with a valid name" }, 400);
        }
        const mimeHeader = request.headers.get("content-type") || "";
        const mime = /^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/i.test(mimeHeader)
            ? mimeHeader.toLowerCase() : "application/octet-stream";
        const folderId = request.headers.get("x-bigbag-folder-id")?.trim() || null;
        if (folderId) {
            if (!/^[a-z0-9-]{1,120}$/i.test(folderId) ||
                !await durableProjectStore.getAppRecord(projectId, "folders", folderId, ownerId)) {
                return appDataJson({ ok: false, error: "Selected folder does not belong to this account" }, 400);
            }
        }
        const existing = await durableProjectStore.listAppRecords(projectId, "documents", { limit: 1, ownerId });
        if (existing.total >= PRIVATE_FILE_LIMIT_PER_USER) {
            return appDataJson({ ok: false, error: "This workspace has reached its 50-file limit" }, 429);
        }
        if (!request.body) return appDataJson({ ok: false, error: "Choose a non-empty file" }, 400);
        const reader = request.body.getReader();
        const chunks: Buffer[] = [];
        let sizeBytes = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sizeBytes += value.byteLength;
                if (sizeBytes > PRIVATE_FILE_MAX_BYTES) {
                    await reader.cancel().catch(() => undefined);
                    return appDataJson({ ok: false, error: "File exceeds the 8 MB limit" }, 413);
                }
                chunks.push(Buffer.from(value));
            }
        } finally {
            reader.releaseLock();
        }
        if (!sizeBytes) return appDataJson({ ok: false, error: "Choose a non-empty file" }, 400);
        const objectId = randomUUID();
        const objectPath = `${projectId}/${ownerId}/${objectId}`;
        const uploaded = await storage.upload(objectPath, Buffer.concat(chunks), { contentType: mime, upsert: false });
        if (uploaded.error) return appDataJson({ ok: false, error: "Private file storage is unavailable. Try again shortly." }, 503);
        try {
            const record = await durableProjectStore.createAppRecord(projectId, "documents", {
                name, mime, sizeBytes, fileId: objectId, folderId,
            }, ownerId);
            return appDataJson({ ok: true, data: record }, 201);
        } catch {
            await storage.remove([objectPath]).catch(() => undefined);
            return appDataJson({ ok: false, error: "The file could not be saved. Nothing was added to your documents." }, 503);
        }
    }

    const record = await durableProjectStore.getAppRecord(projectId, "documents", fileId, ownerId);
    if (!record || typeof record.fileId !== "string" || !/^[a-f0-9-]{36}$/i.test(record.fileId)) {
        return appDataJson({ ok: false, error: "File not found" }, 404);
    }
    const objectPath = `${projectId}/${ownerId}/${record.fileId}`;
    if (request.method === "GET") {
        const downloaded = await storage.download(objectPath);
        if (downloaded.error || !downloaded.data) {
            return appDataJson({ ok: false, error: "The private file is unavailable" }, 503);
        }
        const filename = typeof record.name === "string" ? record.name : "document";
        return new NextResponse(downloaded.data, {
            headers: {
                ...appDataHeaders(),
                "content-type": "application/octet-stream",
                "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            },
        });
    }
    const removed = await storage.remove([objectPath]);
    if (removed.error) return appDataJson({ ok: false, error: "The file could not be removed from private storage" }, 503);
    const deleted = await durableProjectStore.deleteAppRecord(projectId, "documents", fileId, ownerId);
    return deleted
        ? appDataJson({ ok: true, data: { deleted: true } })
        : appDataJson({ ok: false, error: "File metadata could not be removed" }, 503);
}

/**
 * Project-scoped CRUD used by generated apps. Auth-required projects accept
 * only a verified end-user bearer token. Public projects may use signed,
 * owner-scoped guest access, bounded by a project-wide mutation rate and a
 * durable project record quota so rotating guest identities cannot evade it.
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
        const authorization = request.headers.get("authorization") || "";
        const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        let ownerId: string | undefined;
        let authenticatedEmail: string | undefined;
        let hasAuthenticatedUser = false;
        let isGuestAccess = false;
        let builderCapabilityTenantId: string | null = null;
        let projectRecord = localProjectStore.getRecord(projectId);
        if (bearer) {
            const supabase = getSupabaseAdminClient() || getSupabaseClient();
            if (!supabase) return appDataJson({ ok: false, error: "Authentication is not configured" }, 503);
            const { data, error } = await supabase.auth.getUser(bearer);
            if (error || !data.user) return appDataJson({ ok: false, error: "A valid user session is required" }, 401);
            ownerId = data.user.id;
            authenticatedEmail = data.user.email;
            hasAuthenticatedUser = true;
            projectRecord ||= await durableProjectStore.loadRecordByProjectId(projectId);
            if (!projectRecord) return appDataJson({ ok: false, error: "Project not found" }, 404);
        } else {
            const tenantId = verifyPreviewWriteCapability(
                request.headers.get("x-bigbag-capability"),
                projectId
            );
            if (tenantId) {
                builderCapabilityTenantId = tenantId;
                if (!(await localProjectStore.hydrateProject(projectId, tenantId))) {
                    return appDataJson({ ok: false, error: "Project not found" }, 404);
                }
                projectRecord = localProjectStore.getRecord(projectId);
            } else {
                const guestId = verifyPreviewGuestCapability(
                    request.headers.get("x-bigbag-guest"),
                    projectId
                );
                if (!guestId) return appDataJson({ ok: false, error: "Project data authorization required" }, 401);
                projectRecord ||= await durableProjectStore.loadRecordByProjectId(projectId);
                if (!projectRecord) return appDataJson({ ok: false, error: "Project not found" }, 404);
                ownerId = `guest:${guestId}`;
                isGuestAccess = true;
            }
        }
        const commerceProducts = Boolean(projectRecord?.commerceEnabled && collection === "products");
        const commercePlans = Boolean(projectRecord?.commerceEnabled && collection === "plans");
        const commerceCatalog = commerceProducts || commercePlans;
        const sharedCatalog = Boolean(
            (collection === "events" || collection === "courses" || collection === "services" || collection === "tables" || collection === "listings") &&
            projectRecord?.sharedCatalogCollections?.includes(collection)
        );
        const serviceBookings = Boolean(
            collection === "bookings" && projectRecord?.sharedCatalogCollections?.includes("services")
        );
        const tableReservations = Boolean(
            (collection === "reservations" || collection === "table_reservations") &&
            projectRecord?.sharedCatalogCollections?.includes("tables")
        );
        const reservationSlots = Boolean(
            collection === "reservation_slots" && projectRecord?.sharedCatalogCollections?.includes("tables")
        );
        const propertyInquiries = Boolean(
            collection === "inquiries" && projectRecord?.sharedCatalogCollections?.includes("listings")
        );
        const privateDocuments = Boolean(collection === "documents" && projectRecord?.privateFilesEnabled);
        const publicCatalog = commerceCatalog || sharedCatalog || reservationSlots;
        const commerceOrders = Boolean(projectRecord?.commerceEnabled && collection === "orders");
        const commerceSubscriptions = Boolean(projectRecord?.commerceEnabled && collection === "subscriptions");
        const guestCommerceCart = Boolean(projectRecord?.commerceEnabled && collection === "carts" && isGuestAccess);
        const isProjectOwner = Boolean(projectRecord && (
            builderCapabilityTenantId === projectRecord.tenantId ||
            (hasAuthenticatedUser && ownerId && tenantContextForIdentity(ownerId).tenantId === projectRecord.tenantId)
        ));
        const isCommerceOwner = Boolean(projectRecord?.commerceEnabled && (commerceCatalog || commerceOrders) && isProjectOwner);
        const isCatalogOwner = Boolean(publicCatalog && isProjectOwner);
        const canManageReservations = Boolean(tableReservations && isProjectOwner);
        const canManageInquiries = Boolean(propertyInquiries && isProjectOwner);
        if (projectRecord?.requiresEndUserAuth && !hasAuthenticatedUser &&
            !(publicCatalog && request.method === "GET") && !guestCommerceCart && !isCatalogOwner && !isCommerceOwner) {
            return appDataJson({ ok: false, error: "A signed-in user session is required" }, 401);
        }
        if (publicCatalog && request.method !== "GET" && !isCatalogOwner) {
            return appDataJson({ ok: false, error: "Only the project owner can change the catalogue" }, 403);
        }
        if (reservationSlots && (request.method !== "GET" || recordId)) {
            return appDataJson({ ok: false, error: "Availability is read-only" }, 405);
        }
        if (propertyInquiries && !hasAuthenticatedUser && !isProjectOwner) {
            return appDataJson({ ok: false, error: "Sign in to send or view property inquiries" }, 401);
        }
        if (propertyInquiries && request.method !== "GET" && request.method !== "POST") {
            return appDataJson({ ok: false, error: "Property inquiries are a permanent record" }, 403);
        }
        if (privateDocuments && (request.method === "POST" || request.method === "DELETE")) {
            return appDataJson({ ok: false, error: "Use the private file service to add or remove documents" }, 403);
        }
        if ((commerceOrders || commerceSubscriptions) && request.method === "POST" && !hasAuthenticatedUser) {
            return appDataJson({ ok: false, error: "Sign in before starting checkout" }, 401);
        }
        if (isGuestAccess && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
            if (!consumePreviewGuestMutationBudget(projectId)) {
                return appDataJson({ ok: false, error: "Guest write rate limit exceeded" }, 429);
            }
            if (request.method === "POST" && !recordId) {
                const totalRecords = (await durableProjectStore.listAppCollections(projectId))
                    .reduce((total, entry) => total + entry.count, 0);
                if (totalRecords >= PREVIEW_GUEST_PROJECT_RECORD_LIMIT) {
                    return appDataJson({ ok: false, error: "Guest project record quota exceeded" }, 429);
                }
            }
        }
        if (request.method === "GET") {
            if (reservationSlots) {
                return appDataJson({ ok: true, data: await durableProjectStore.listTableReservationSlots(projectId) });
            }
            if (recordId) {
                const record = await durableProjectStore.getAppRecord(projectId, collection, recordId,
                    publicCatalog || (commerceOrders && isCommerceOwner) || canManageReservations || canManageInquiries ? undefined : ownerId);
                if (sharedCatalog && collection !== "services" && collection !== "tables" && !isCatalogOwner && record?.published !== true) {
                    return appDataJson({ ok: false, error: "Record not found" }, 404);
                }
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
            const data = await durableProjectStore.listAppRecords(projectId, collection, {
                limit, offset, ownerId: publicCatalog || (commerceOrders && isCommerceOwner) || canManageReservations || canManageInquiries ? undefined : ownerId,
                publishedOnly: sharedCatalog && collection !== "services" && collection !== "tables" && !isCatalogOwner,
            });
            return appDataJson({ ok: true, data });
        }
        if (request.method === "POST" && !recordId) {
            let body = await readAppDataBody(request);
            if (serviceBookings) {
                if (!hasAuthenticatedUser || !ownerId) return appDataJson({ ok: false, error: "Sign in to book an appointment" }, 401);
                const data = await durableProjectStore.createServiceBooking(projectId, body, ownerId);
                return appDataJson({ ok: true, data }, 201);
            }
            if (tableReservations) {
                if (!hasAuthenticatedUser || !ownerId) return appDataJson({ ok: false, error: "Sign in to reserve a table" }, 401);
                const data = await durableProjectStore.createTableReservation(projectId, body, ownerId, collection as "reservations" | "table_reservations");
                return appDataJson({ ok: true, data }, 201);
            }
            if (propertyInquiries) {
                if (!hasAuthenticatedUser || !ownerId) return appDataJson({ ok: false, error: "Sign in to inquire about a property" }, 401);
                const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
                if (!/^[a-z0-9-]{1,120}$/i.test(listingId)) return appDataJson({ ok: false, error: "Select a valid property" }, 400);
                const listing = await durableProjectStore.getAppRecord(projectId, "listings", listingId);
                if (!listing || listing.published !== true) return appDataJson({ ok: false, error: "Published property not found" }, 404);
                const name = typeof body.name === "string" ? body.name.trim() : "";
                const message = typeof body.message === "string" ? body.message.trim() : "";
                if (name.length < 2 || name.length > 120 || message.length < 10 || message.length > 2_000) {
                    return appDataJson({ ok: false, error: "Enter your name and a message between 10 and 2,000 characters" }, 400);
                }
                if (!authenticatedEmail) return appDataJson({ ok: false, error: "Account email is required to send an inquiry" }, 400);
                body = { listingId, listingTitle: listing.title, name, email: authenticatedEmail, message, status: "unread" };
            }
            if (commerceOrders) body = await verifiedCommerceOrder(projectId, body);
            if (commercePlans) body = verifiedCommercePlan(body);
            if (commerceSubscriptions) body = await verifiedCommerceSubscription(projectId, body);
            const data = await durableProjectStore.createAppRecord(
                projectId,
                collection,
                body,
                publicCatalog ? undefined : ownerId
            );
            return appDataJson({ ok: true, data }, 201);
        }
        if (request.method === "PATCH" && recordId) {
            let body = await readAppDataBody(request);
            if (privateDocuments) {
                if (Object.keys(body).length !== 1 || !("folderId" in body) ||
                    !(body.folderId === null || typeof body.folderId === "string")) {
                    return appDataJson({ ok: false, error: "Only the document folder can be changed here" }, 403);
                }
                if (typeof body.folderId === "string" &&
                    (!/^[a-z0-9-]{1,120}$/i.test(body.folderId) ||
                        !await durableProjectStore.getAppRecord(projectId, "folders", body.folderId, ownerId))) {
                    return appDataJson({ ok: false, error: "Selected folder does not belong to this account" }, 400);
                }
            }
            if (serviceBookings) {
                const keys = Object.keys(body).sort().join(",");
                if (keys === "date,startMinutes") {
                    if (!hasAuthenticatedUser || !ownerId) return appDataJson({ ok: false, error: "Sign in to reschedule" }, 401);
                    const updated = await durableProjectStore.rescheduleServiceBooking(projectId, recordId, body, ownerId);
                    return updated
                        ? appDataJson({ ok: true, data: updated })
                        : appDataJson({ ok: false, error: "Record not found" }, 404);
                }
                if (keys !== "status" || body.status !== "cancelled") {
                    return appDataJson({ ok: false, error: "Change the appointment time or cancel it" }, 403);
                }
            }
            if (tableReservations && (Object.keys(body).length !== 1 || body.status !== "cancelled")) {
                return appDataJson({ ok: false, error: "Reservations can only be cancelled" }, 403);
            }
            if (commercePlans) body = verifiedCommercePlan(body, true);
            if (commerceOrders) {
                if (Object.keys(body).length !== 1 || body.status !== "cancelled") {
                    return appDataJson({ ok: false, error: "Order changes require a verified payment or fulfillment provider" }, 403);
                }
                const current = await durableProjectStore.getAppRecord(projectId, collection, recordId,
                    isCommerceOwner ? undefined : ownerId);
                if (!current) return appDataJson({ ok: false, error: "Record not found" }, 404);
                if (current.status !== "pending_payment") {
                    return appDataJson({ ok: false, error: "This order can no longer be cancelled" }, 409);
                }
            }
            if (commerceSubscriptions) {
                if (Object.keys(body).length !== 1 || body.status !== "cancelled") {
                    return appDataJson({ ok: false, error: "Subscription changes require a verified payment provider" }, 403);
                }
                const current = await durableProjectStore.getAppRecord(projectId, collection, recordId, ownerId);
                if (!current) return appDataJson({ ok: false, error: "Record not found" }, 404);
                if (current.status !== "pending_payment") {
                    return appDataJson({ ok: false, error: "This subscription can no longer be cancelled" }, 409);
                }
            }
            const data = await durableProjectStore.updateAppRecord(
                projectId,
                collection,
                recordId,
                body,
                publicCatalog || (commerceOrders && isCommerceOwner) || canManageReservations ? undefined : ownerId
            );
            return data
                ? appDataJson({ ok: true, data })
                : appDataJson({ ok: false, error: "Record not found" }, 404);
        }
        if (request.method === "DELETE" && recordId) {
            if (serviceBookings) return appDataJson({ ok: false, error: "Cancel the appointment to preserve its history" }, 403);
            if (tableReservations) return appDataJson({ ok: false, error: "Cancel the reservation to preserve its history" }, 403);
            if (commerceSubscriptions) return appDataJson({ ok: false, error: "Cancel a subscription to preserve its history" }, 403);
            if (commerceOrders && !isCommerceOwner) {
                return appDataJson({ ok: false, error: "Orders cannot be deleted by customers" }, 403);
            }
            const deleted = await durableProjectStore.deleteAppRecord(projectId, collection, recordId,
                publicCatalog || commerceOrders ? undefined : ownerId);
            return deleted
                ? appDataJson({ ok: true, data: { deleted: true } })
                : appDataJson({ ok: false, error: "Record not found" }, 404);
        }
        return appDataJson({ ok: false, error: "Method not allowed" }, 405);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Database request failed";
        if (error instanceof BookingConflictError) return appDataJson({ ok: false, error: error.message }, 409);
        const clientError = error instanceof BookingInputError || error instanceof SyntaxError || error instanceof CommerceOrderValidationError ||
            error instanceof CommerceSubscriptionValidationError || /invalid|must contain|too large/i.test(message);
        if (clientError) return appDataJson({ ok: false, error: message }, 400);
        console.error("[preview-data] Request failed", error);
        return appDataJson({ ok: false, error: "Database request failed" }, 500);
    }
}

async function serveGuestCartClaim(request: NextRequest, projectId: string): Promise<NextResponse> {
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: appDataHeaders() });
    if (request.method !== "POST") return appDataJson({ ok: false, error: "Method not allowed" }, 405);
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const guestId = verifyPreviewGuestCapability(request.headers.get("x-bigbag-guest"), projectId);
    if (!bearer || !guestId) return appDataJson({ ok: false, error: "Sign in with the same browser to restore your bag" }, 401);
    const project = await durableProjectStore.loadRecordByProjectId(projectId);
    if (!project?.commerceEnabled) return appDataJson({ ok: false, error: "This project does not have a shop" }, 404);
    const supabase = getSupabaseAdminClient() || getSupabaseClient();
    if (!supabase) return appDataJson({ ok: false, error: "Authentication is not configured" }, 503);
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user) return appDataJson({ ok: false, error: "A valid user session is required" }, 401);
    try {
        const cart = await durableProjectStore.claimGuestCart(projectId, guestId, data.user.id);
        return appDataJson({ ok: true, data: { cart } });
    } catch (error) {
        console.error("[preview-commerce] Guest cart claim failed", error);
        return appDataJson({ ok: false, error: "Your saved bag could not be moved to your account. Please retry." }, 500);
    }
}

function serveAppAuthConfig(): NextResponse {
    const url = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    if (!url || !anonKey) return appDataJson({ ok: false, error: "Authentication is not configured" }, 503);
    return appDataJson({ ok: true, data: { url, anonKey } });
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
    writeCapability?: string,
    guestCapability?: string
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
        try {
            const rootDir = localProjectStore.getWorkspaceDir(projectId);
            const hasExt = requestedPath.split("/").at(-1)?.includes(".");
            // Only serve from build-output directories (dist/) and static-asset
            // directories (public/). Serving from the workspace root directly
            // would expose source files such as src/main.tsx — a TypeScript
            // file that Vite transforms at dev-time but which has no valid MIME
            // type in production and causes a browser 403 / octet-stream failure.
            const candidates = [
                path.join(rootDir, "dist", requestedPath),
                path.join(rootDir, "public", requestedPath),
                // NOTE: path.join(rootDir, requestedPath) intentionally removed —
                // serving workspace-root files exposes src/ TypeScript sources.
                ...(!hasExt || requestedPath === "index.html" ? [path.join(rootDir, "dist", "index.html")] : []),
            ];
            for (const c of candidates) {
                if (fs.existsSync(c) && fs.statSync(c).isFile()) {
                    file = { path: requestedPath, content: fs.readFileSync(c) };
                    break;
                }
            }
        } catch { /* ignore */ }
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
            injectWriteCapability(injectAgent(rewriteHtml(html, base), base), writeCapability, guestCapability),
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
    writeCapability?: string,
    guestCapability?: string
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
        // If live port is temporarily unreachable, fall back to built/persistent deployment if present
        try {
            const fallback = await servePersistentDeployment(request, projectId, segments, writeCapability, guestCapability);
            if (fallback.status !== 404 && fallback.status !== 503) {
                return fallback;
            }
        } catch { /* proceed to boot page */ }

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
                writeCapability,
                guestCapability
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

function injectWriteCapability(html: string, capability?: string, guestCapability?: string): string {
    if (!capability && !guestCapability) return html;
    const script = `<script>${capability ? `window.__BIGBAG_WRITE_CAPABILITY__=${JSON.stringify(capability)};` : ""}${guestCapability ? `window.__BIGBAG_GUEST_CAPABILITY__=${JSON.stringify(guestCapability)};` : ""}</script>`;
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
        const ownerSession = verifyAuthSession(request.cookies.get(AUTH_COOKIE)?.value);
        if (trustedEditor && !ownerSession) {
            return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
        }
        const documentRequest = request.method === "GET" && (
            targetSegments.length === 0 ||
            targetSegments.at(-1)?.endsWith(".html") ||
            (request.headers.get("accept")?.includes("text/html") &&
                !targetSegments.at(-1)?.includes("."))
        );
        const guestContext = documentRequest ? resolvePreviewGuest(request) : null;
        const guestCapability = guestContext
            ? createPreviewGuestCapability(projectId, guestContext.guestId)
            : undefined;
        if (ownerSession && trustedEditor) {
            const ownerTenant = tenantContextForIdentity(ownerSession.sub);
            if (await localProjectStore.hydrateProject(projectId, ownerTenant.tenantId)) {
                writeCapability = createPreviewWriteCapability(projectId, ownerTenant.tenantId);
            } else if (trustedEditor) {
                return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
            }
        }
        if (targetSegments[0] === APP_DATA_PATH) {
            if (targetSegments[1] === "files") {
                return servePrivateProjectFile(request, projectId, targetSegments);
            }
            if (targetSegments[1] === "commerce" && targetSegments[2] === "claim-cart" && targetSegments.length === 3) {
                return serveGuestCartClaim(request, projectId);
            }
            if (targetSegments[1] === "auth" && targetSegments[2] === "storage" && targetSegments.length === 3) {
                return servePreviewAuthStorage(request, projectId);
            }
            if (targetSegments[1] === "auth" && targetSegments[2] === "config" && targetSegments.length === 3) {
                return request.method === "GET"
                    ? serveAppAuthConfig()
                    : appDataJson({ ok: false, error: "Method not allowed" }, 405);
            }
            if (targetSegments[1] === "auth" && targetSegments[2] === "role" && targetSegments.length === 3) {
                if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: appDataHeaders() });
                return request.method === "GET"
                    ? serveProjectRole(request, projectId)
                    : appDataJson({ ok: false, error: "Method not allowed" }, 405);
            }
            return serveAppData(request, projectId, targetSegments);
        }
        const localRecord = localProjectStore.getRecord(projectId);
        // Never embed an owner-wide capability in public HTML. A generated
        // login form alone cannot authorize server-side reads or mutations.
        const usesDisposableE2b = process.env.SANDBOX_PROVIDER?.trim().toLowerCase() === "e2b";
        const runningOrigin = localSandboxManager.getRunningOrigin(projectId) ||
            (!usesDisposableE2b && localRecord?.serverStatus === "Active" && localRecord?.port
                ? `http://127.0.0.1:${localRecord.port}`
                : null);
        const response = runningOrigin
            ? await proxyLocalDevelopment(request, projectId, targetSegments, runningOrigin, writeCapability, guestCapability)
            : await servePersistentDeployment(request, projectId, targetSegments, writeCapability, guestCapability);
        if (guestContext?.cookieValue) {
            response.cookies.set(PREVIEW_GUEST_COOKIE, guestContext.cookieValue, {
                httpOnly: true,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
                path: `/api/preview/${encodeURIComponent(projectId)}`,
                maxAge: 60 * 60 * 24 * 365,
            });
        }
        return response;
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
