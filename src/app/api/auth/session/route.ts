import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authCookieOptions, createAuthSession, verifyAuthSession } from "@/lib/auth-session";
import { attachLocalTenantCookie, tenantContextForIdentity, TENANT_COOKIE } from "@/lib/local-orchestrator/tenant-context";

type FirebaseAccount = {
  localId?: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "Firebase authentication is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  if (!idToken || idToken.length > 16_000) {
    return NextResponse.json({ ok: false, error: "A valid Firebase ID token is required" }, { status: 400 });
  }

  let firebaseResponse: Response;
  try {
    firebaseResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Google sign-in is temporarily unavailable" },
      { status: 503 }
    );
  }
  const firebasePayload = await firebaseResponse.json().catch(() => null) as { users?: FirebaseAccount[] } | null;
  const user = firebasePayload?.users?.[0];
  if (!firebaseResponse.ok || !user?.localId) {
    return NextResponse.json({ ok: false, error: "Google sign-in could not be verified" }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    data: {
      uid: user.localId,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoUrl || null,
    },
  });
  response.cookies.set(AUTH_COOKIE, createAuthSession(user.localId), authCookieOptions);
  return attachLocalTenantCookie(response, tenantContextForIdentity(user.localId));
}

export function GET(request: NextRequest) {
  const session = verifyAuthSession(request.cookies.get(AUTH_COOKIE)?.value);
  return NextResponse.json(
    session ? { ok: true, data: { authenticated: true } } : { ok: false, error: "Unauthenticated" },
    { status: session ? 200 : 401 }
  );
}

export function DELETE() {
  const response = NextResponse.json({ ok: true, data: { signedOut: true } });
  response.cookies.set(AUTH_COOKIE, "", { ...authCookieOptions, maxAge: 0 });
  response.cookies.set(TENANT_COOKIE, "", { ...authCookieOptions, maxAge: 0 });
  return response;
}
