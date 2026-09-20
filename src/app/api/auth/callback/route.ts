import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { AUTH_COOKIE, authCookieOptions, createAuthSession } from "@/lib/auth-session";
import { attachLocalTenantCookie, tenantContextForIdentity } from "@/lib/local-orchestrator/tenant-context";
import { safeAuthReturnPath } from "@/lib/auth-redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeAuthReturnPath(requestUrl.searchParams.get("next"), "/dashboard");

  if (!code) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("No authorization code provided")}`, requestUrl.origin));
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("Supabase is not configured")}`, requestUrl.origin));
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user?.id) {
    const errorMsg = error?.message || "Could not verify Google authentication session";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorMsg)}`, requestUrl.origin));
  }

  const user = data.user;
  const targetUrl = new URL(next, requestUrl.origin);
  const response = NextResponse.redirect(targetUrl, 303);

  // Set secure HttpOnly session and tenant cookies
  response.cookies.set(AUTH_COOKIE, createAuthSession(user.id), authCookieOptions);
  return attachLocalTenantCookie(response, tenantContextForIdentity(user.id));
}
