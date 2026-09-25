import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authCookieOptions, createAuthSession, verifyAuthSession } from "@/lib/auth-session";
import { attachLocalTenantCookie, tenantContextForIdentity, TENANT_COOKIE } from "@/lib/local-orchestrator/tenant-context";
import { getSupabaseClient, getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase";
import { extractCleanUserName } from "@/lib/user-name";

export async function POST(request: NextRequest) {
  // Token verification needs the public Auth API, not the administrative key.
  // An invalid service-role key must not block an otherwise valid Google login.
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase authentication is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";

  if (!accessToken || accessToken.length > 16_000) {
    return NextResponse.json({ ok: false, error: "A valid Supabase access token is required" }, { status: 400 });
  }

  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user?.id) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Google sign-in could not be verified" },
        { status: 401 }
      );
    }

    const user = data.user;
    const rawDisplayName =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      user.email?.split("@")[0] ||
      null;
    const displayName = rawDisplayName
      ? extractCleanUserName(rawDisplayName) || rawDisplayName
      : null;
    const photoURL =
      (user.user_metadata?.avatar_url as string) ||
      (user.user_metadata?.picture as string) ||
      null;

    const response = NextResponse.json({
      ok: true,
      data: {
        uid: user.id,
        id: user.id,
        email: user.email || null,
        displayName,
        photoURL,
      },
    });

    response.cookies.set(AUTH_COOKIE, createAuthSession(user.id), authCookieOptions);
    return attachLocalTenantCookie(response, tenantContextForIdentity(user.id));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export function GET(request: NextRequest) {
  const session = verifyAuthSession(request.cookies.get(AUTH_COOKIE)?.value);
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const isConfigured = Boolean(url && anonKey);

  return NextResponse.json({
    ok: true,
    data: {
      authenticated: Boolean(session),
      user: session ? { id: session.sub, uid: session.sub } : null,
      configured: isConfigured,
      supabase: isConfigured ? { url, anonKey } : null,
    },
  });
}

export function DELETE() {
  const response = NextResponse.json({ ok: true, data: { signedOut: true } });
  response.cookies.set(AUTH_COOKIE, "", { ...authCookieOptions, maxAge: 0 });
  response.cookies.set(TENANT_COOKIE, "", { ...authCookieOptions, maxAge: 0 });
  return response;
}
