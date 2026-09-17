import "server-only";

import { createHash } from "node:crypto";

const FIREBASE_API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBCzzML3CziZX9Njc5kwBC06-DEOvf2Ock";
const LOOKUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
const MAX_TOKEN_LENGTH = 8_192;

export type FirebaseServerUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  photoUrl?: string;
  expiresAt: number;
};

type CacheEntry = { user: FirebaseServerUser; validUntil: number };
const verificationCache = new Map<string, CacheEntry>();

function tokenExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? payload.exp * 1_000 : null;
  } catch {
    return null;
  }
}

function emailAllowed(email: string): boolean {
  const configured = (process.env.FIREBASE_ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.length === 0 || configured.includes(email.toLowerCase());
}

export async function verifyFirebaseIdToken(
  token: string
): Promise<FirebaseServerUser | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const expiresAt = tokenExpiry(token);
  if (!expiresAt || expiresAt <= Date.now()) return null;

  const cacheKey = createHash("sha256").update(token).digest("hex");
  const cached = verificationCache.get(cacheKey);
  if (cached && cached.validUntil > Date.now()) return cached.user;

  try {
    const response = await fetch(LOOKUP_URL, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      users?: Array<{
        localId?: unknown;
        email?: unknown;
        emailVerified?: unknown;
        displayName?: unknown;
        photoUrl?: unknown;
        disabled?: unknown;
      }>;
    };
    const account = payload.users?.[0];
    if (
      !account ||
      account.disabled === true ||
      typeof account.localId !== "string" ||
      typeof account.email !== "string" ||
      !emailAllowed(account.email)
    ) {
      return null;
    }

    const user: FirebaseServerUser = {
      uid: account.localId,
      email: account.email,
      emailVerified: account.emailVerified === true,
      displayName:
        typeof account.displayName === "string" ? account.displayName : undefined,
      photoUrl: typeof account.photoUrl === "string" ? account.photoUrl : undefined,
      expiresAt,
    };
    verificationCache.set(cacheKey, {
      user,
      validUntil: Math.min(expiresAt, Date.now() + 5 * 60_000),
    });
    if (verificationCache.size > 500) verificationCache.clear();
    return user;
  } catch {
    return null;
  }
}
