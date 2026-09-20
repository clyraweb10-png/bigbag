import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "bigbag_auth";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthSession {
  sub: string;
  exp: number;
}

function secret(): string {
  const value = process.env.TENANT_COOKIE_SECRET?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TENANT_COOKIE_SECRET is required in production");
  }
  return "bigbag-local-development-auth-secret";
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`auth-session:${payload}`).digest("base64url");
}

export function createAuthSession(userId: string, now = Date.now()): string {
  if (!userId.trim()) throw new Error("A user id is required");
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  } satisfies AuthSession)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyAuthSession(value: string | undefined, now = Date.now()): AuthSession | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const received = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signature(payload));
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;
    if (!parsed.sub || !Number.isSafeInteger(parsed.exp) || parsed.exp <= Math.floor(now / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Cloud VCaaS uses one operator credential and therefore cannot safely be
 * shared across arbitrary users. Keep it fail-closed to explicitly
 * enrolled operator user IDs; local mode has per-user project ownership instead.
 */
export function isCloudOperator(session: AuthSession): boolean {
  const allowed = new Set(
    (process.env.VCAAS_OPERATOR_UIDS || "").split(",").map((value) => value.trim()).filter(Boolean)
  );
  return allowed.has(session.sub);
}

export const authCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
