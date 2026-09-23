import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { NextRequest, NextResponse } from "next/server";

export const TENANT_COOKIE = "bigbag_tenant";
export const PREVIEW_GUEST_COOKIE = "bigbag_preview_guest";
const TENANT_ID = /^[a-f0-9-]{36}$/;
const PREVIEW_WRITE_TTL_MS = 15 * 60_000;
const PREVIEW_GUEST_TTL_MS = 24 * 60 * 60_000;
const PREVIEW_AUTH_STORAGE_TTL_MS = 30 * 24 * 60 * 60_000;
const PREVIEW_GUEST_MUTATION_WINDOW_MS = 60_000;
const PREVIEW_GUEST_MUTATION_LIMIT = 60;
const guestMutationBudgets = new Map<string, { windowStartedAt: number; count: number }>();

function signingSecret(): string {
  const secret = process.env.TENANT_COOKIE_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TENANT_COOKIE_SECRET is required in production");
  }
  return "bigbag-development-only-tenant-secret";
}

function signature(tenantId: string): string {
  return createHmac("sha256", signingSecret()).update(tenantId).digest("base64url");
}

function previewWriteSignature(payload: string): string {
  return createHmac("sha256", signingSecret())
    .update(`preview-write:${payload}`)
    .digest("base64url");
}

function previewGuestSignature(payload: string): string {
  return createHmac("sha256", signingSecret())
    .update(`preview-guest:${payload}`)
    .digest("base64url");
}

function previewAuthStorageKey(): Buffer {
  return createHash("sha256").update(`preview-auth-storage:${signingSecret()}`).digest();
}

export function sealPreviewAuthStorage(
  projectId: string,
  guestId: string,
  key: string,
  value: string,
  now = Date.now()
): string {
  if (!projectId || !TENANT_ID.test(guestId) || !key || value.length > 12_000) {
    throw new Error("Invalid preview auth storage value");
  }
  const plaintext = deflateRawSync(Buffer.from(JSON.stringify({
    projectId,
    guestId,
    key,
    value,
    expiresAt: now + PREVIEW_AUTH_STORAGE_TTL_MS,
  }), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", previewAuthStorageKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openPreviewAuthStorage(
  token: string | undefined,
  projectId: string,
  guestId: string,
  key: string,
  now = Date.now()
): string | null {
  if (!token || token.length > 4_000 || !projectId || !TENANT_ID.test(guestId) || !key) return null;
  try {
    const sealed = Buffer.from(token, "base64url");
    if (sealed.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", previewAuthStorageKey(), sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(sealed.subarray(28)),
      decipher.final(),
    ]);
    const payload = JSON.parse(inflateRawSync(plaintext).toString("utf8")) as Record<string, unknown>;
    if (
      payload.projectId !== projectId ||
      payload.guestId !== guestId ||
      payload.key !== key ||
      typeof payload.value !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < now ||
      payload.expiresAt > now + PREVIEW_AUTH_STORAGE_TTL_MS + 60_000
    ) return null;
    return payload.value;
  } catch {
    return null;
  }
}

export function resolvePreviewGuest(request: NextRequest): { guestId: string; cookieValue?: string } {
  const value = request.cookies.get(PREVIEW_GUEST_COOKIE)?.value;
  if (value) {
    const separator = value.lastIndexOf(".");
    const guestId = separator > 0 ? value.slice(0, separator) : "";
    const received = separator > 0 ? value.slice(separator + 1) : "";
    const expected = previewGuestSignature(guestId);
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (TENANT_ID.test(guestId) && a.length === b.length && timingSafeEqual(a, b)) return { guestId };
  }
  const guestId = randomUUID();
  return { guestId, cookieValue: `${guestId}.${previewGuestSignature(guestId)}` };
}

export function createPreviewGuestCapability(projectId: string, guestId: string, now = Date.now()): string {
  if (!TENANT_ID.test(guestId)) throw new Error("Invalid preview guest id");
  const expiresAt = Math.floor((now + PREVIEW_GUEST_TTL_MS) / 1000);
  const payload = `${projectId}.${guestId}.${expiresAt}`;
  return `${payload}.${previewGuestSignature(payload)}`;
}

export function verifyPreviewGuestCapability(token: string | null, projectId: string, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [tokenProjectId, guestId, rawExpiry, received] = parts;
  const expiresAt = Number(rawExpiry);
  if (
    tokenProjectId !== projectId ||
    !TENANT_ID.test(guestId) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt * 1000 < now ||
    expiresAt * 1000 > now + PREVIEW_GUEST_TTL_MS + 60_000
  ) return null;
  const payload = `${tokenProjectId}.${guestId}.${rawExpiry}`;
  const expected = previewGuestSignature(payload);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? guestId : null;
}

/** Project-scoped so rotating guest identities cannot bypass the mutation limit. */
export function consumePreviewGuestMutationBudget(projectId: string, now = Date.now()): boolean {
  if (!projectId) return false;
  const current = guestMutationBudgets.get(projectId);
  if (!current || now - current.windowStartedAt >= PREVIEW_GUEST_MUTATION_WINDOW_MS) {
    guestMutationBudgets.set(projectId, { windowStartedAt: now, count: 1 });
    if (guestMutationBudgets.size > 1_000) {
      for (const [key, budget] of guestMutationBudgets) {
        if (now - budget.windowStartedAt >= PREVIEW_GUEST_MUTATION_WINDOW_MS) guestMutationBudgets.delete(key);
      }
    }
    return true;
  }
  if (current.count >= PREVIEW_GUEST_MUTATION_LIMIT) return false;
  current.count += 1;
  return true;
}

export function createPreviewWriteCapability(
  projectId: string,
  tenantId: string,
  now = Date.now()
): string {
  if (!TENANT_ID.test(tenantId)) throw new Error("Invalid tenant id");
  const expiresAt = Math.floor((now + PREVIEW_WRITE_TTL_MS) / 1000);
  const payload = `${projectId}.${tenantId}.${expiresAt}`;
  return `${payload}.${previewWriteSignature(payload)}`;
}

export function verifyPreviewWriteCapability(
  token: string | null,
  projectId: string,
  now = Date.now()
): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [tokenProjectId, tenantId, rawExpiry, received] = parts;
  const expiresAt = Number(rawExpiry);
  if (
    tokenProjectId !== projectId ||
    !TENANT_ID.test(tenantId) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt * 1000 < now ||
    expiresAt * 1000 > now + PREVIEW_WRITE_TTL_MS + 60_000
  ) return null;
  const payload = `${tokenProjectId}.${tenantId}.${rawExpiry}`;
  const expected = previewWriteSignature(payload);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? tenantId : null;
}

function parseCookie(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const tenantId = value.slice(0, separator);
  const received = value.slice(separator + 1);
  if (!TENANT_ID.test(tenantId)) return null;
  const expected = signature(tenantId);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? tenantId : null;
}

export interface LocalTenantContext {
  tenantId: string;
  cookieValue?: string;
}

export function tenantContextForIdentity(identity: string): LocalTenantContext {
  const bytes = createHash("sha256").update(`user:${identity}`).digest().subarray(0, 16);
  // RFC 4122 variant/version bits keep the deterministic identifier compatible
  // with the existing UUID-only tenant storage contract.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const tenantId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { tenantId, cookieValue: `${tenantId}.${signature(tenantId)}` };
}

export function resolveLocalTenant(request: NextRequest): LocalTenantContext {
  const current = parseCookie(request.cookies.get(TENANT_COOKIE)?.value);
  if (current) return { tenantId: current };
  const tenantId = randomUUID();
  return { tenantId, cookieValue: `${tenantId}.${signature(tenantId)}` };
}

export function attachLocalTenantCookie(
  response: NextResponse,
  context: LocalTenantContext
): NextResponse {
  if (context.cookieValue) {
    response.cookies.set(TENANT_COOKIE, context.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

/**
 * Generated previews share the Render hostname but are untrusted applications.
 * The preview Referer path or an opaque sandbox Origin prevents a preview from
 * using the viewer's tenant cookie against builder APIs. Ordinary privacy-aware
 * builder requests may omit Referer and must remain usable.
 */
export function isPreviewInitiatedRequest(request: NextRequest): boolean {
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).pathname.startsWith("/api/preview/");
    } catch {
      return true;
    }
  }
  return request.headers.get("origin") === "null";
}
