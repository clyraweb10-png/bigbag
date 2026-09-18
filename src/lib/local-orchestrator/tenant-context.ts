import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const TENANT_COOKIE = "bigbag_tenant";
const TENANT_ID = /^[a-f0-9-]{36}$/;

function signingSecret(): string {
  const secret = process.env.TENANT_COOKIE_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TENANT_COOKIE_SECRET is required in production for multi-user project isolation");
  }
  return "bigbag-local-development-tenant-secret";
}

function signature(tenantId: string): string {
  return createHmac("sha256", signingSecret()).update(tenantId).digest("base64url");
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
