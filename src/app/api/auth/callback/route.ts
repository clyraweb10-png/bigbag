import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, getSupabaseClient } from "@/lib/supabase";
import { AUTH_COOKIE, authCookieOptions, createAuthSession } from "@/lib/auth-session";
import { attachLocalTenantCookie, tenantContextForIdentity } from "@/lib/local-orchestrator/tenant-context";
import { safeAuthReturnPath } from "@/lib/auth-redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeAuthReturnPath(requestUrl.searchParams.get("next"), "/dashboard");

  // If no code is present in query parameters (e.g. implicit flow with URL hash),
  // return an HTML forwarder that preserves search params and hash fragment.
  if (!code) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting…</title>
  <script>
    var target = '/auth/callback' + window.location.search + window.location.hash;
    window.location.replace(target);
  </script>
</head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1d1d1c;color:#fff;">
  <p>Connecting securely…</p>
</body>
</html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const supabase = getSupabaseAdminClient() || getSupabaseClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/auth/callback" + requestUrl.search, requestUrl.origin));
  }

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user?.id) {
      const user = data.user;
      const targetUrl = new URL(next, requestUrl.origin);
      const response = NextResponse.redirect(targetUrl, 303);

      // Set secure HttpOnly session and tenant cookies
      response.cookies.set(AUTH_COOKIE, createAuthSession(user.id), authCookieOptions);
      return attachLocalTenantCookie(response, tenantContextForIdentity(user.id));
    }
  } catch {
    // If server code exchange fails (e.g. PKCE verifier is in browser storage), forward to client callback
  }

  // Forward to client callback which has access to browser localStorage PKCE verifiers
  return NextResponse.redirect(new URL("/auth/callback" + requestUrl.search, requestUrl.origin));
}
