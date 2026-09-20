import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isCloudOperator, verifyAuthSession } from "./lib/auth-session";
import { isProtectedPagePath, safeAuthReturnPath, resolveAppOrigin } from "./lib/auth-redirect";
import { isLocalOrchestratorEnabled } from "./lib/orchestrator-mode";

const isProduction = process.env.NODE_ENV === "production";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
// Extract origin from app URL (e.g. "https://my-app.com" from "https://my-app.com/")
const appOrigin = appUrl ? new URL(appUrl).origin : "";
// Optional: comma-separated list of additional allowed origins for custom deployments
const extraAllowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)
);
const CORS_ALLOWED_HEADERS = "Content-Type, Authorization, X-Requested-With, X-BigBag-Capability";

/**
 * Check if an origin is allowed for CORS.
 * - Development: any origin
 * - Production: NEXT_PUBLIC_APP_URL, ALLOWED_ORIGINS env, or same-host (custom domains)
 */
function isAllowedOrigin(origin: string, request: NextRequest): boolean {
  if (!isProduction) return true;
  if (appOrigin && origin === appOrigin) return true;
  if (extraAllowedOrigins.has(origin)) return true;

  // Sandboxed preview iframes have origin 'null'
  if (origin === "null" && request.nextUrl.pathname.startsWith("/api/preview/")) return true;

  // Trust same-host requests — custom domains served by this same server
  const host = request.headers.get("host");
  if (host && origin === `https://${host}`) return true;

  return false;
}

// Add CORS headers if the origin is allowed
function addCorsHeaders(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get("origin");

  // Always enable CORS for sandboxed preview iframe assets
  if (request.nextUrl.pathname.startsWith("/api/preview/")) {
    response.headers.set("Access-Control-Allow-Origin", origin === "null" ? "*" : (origin || "*"));
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
    response.headers.set("Access-Control-Max-Age", "86400");
    return response;
  }

  if (origin && isAllowedOrigin(origin, request)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Max-Age", "86400");
    response.headers.set("Vary", "Origin");
  }

  return response;
}

// Generated previews set their CSP after the route has authenticated any editor
// capability. A request query parameter alone must never grant privileges here.
function addCspHeaders(response: NextResponse, request: NextRequest) {
  const isPreview = request.nextUrl.pathname.startsWith("/api/preview/");
  if (!isPreview) response.headers.set("Content-Security-Policy", "frame-ancestors *");
  response.headers.delete("X-Frame-Options");
  return response;
}

// API authentication is an optimistic signed-cookie check here and is repeated
// through tenant ownership at the data boundary. Preview documents remain public.
export async function proxy(request: NextRequest) {
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    addCorsHeaders(response, request);
    addCspHeaders(response, request);
    return response;
  }

  const path = request.nextUrl.pathname;
  const protectedApi = path === "/api/planner" || path.startsWith("/api/vcaas/") || path.startsWith("/api/visual-edit/");
  const protectedPage = isProtectedPagePath(path);
  const session = protectedApi || protectedPage
    ? verifyAuthSession(request.cookies.get(AUTH_COOKIE)?.value)
    : null;

  if (protectedPage && !session) {
    const origin = resolveAppOrigin(request);
    const loginUrl = new URL("/login", origin);
    const returnPath = safeAuthReturnPath(`${path}${request.nextUrl.search}`);
    loginUrl.searchParams.set("next", returnPath);
    const response = NextResponse.redirect(loginUrl, 307);
    addCorsHeaders(response, request);
    addCspHeaders(response, request);
    return response;
  }

  if (protectedApi && !session) {
    const response = NextResponse.json({ ok: false, error: "Sign in with Google to continue" }, { status: 401 });
    addCorsHeaders(response, request);
    addCspHeaders(response, request);
    return response;
  }
  const usesOperatorCredential = path.startsWith("/api/vcaas/") || path.startsWith("/api/visual-edit/");
  if (session && usesOperatorCredential && !isLocalOrchestratorEnabled() && !isCloudOperator(session)) {
    const response = NextResponse.json({ ok: false, error: "This account is not enrolled as a cloud operator" }, { status: 403 });
    addCorsHeaders(response, request);
    addCspHeaders(response, request);
    return response;
  }

  // Browser pages render the client auth gate; sensitive APIs also enforce the
  // signed HttpOnly session above so bypassing the UI cannot spend provider keys.
  const response = NextResponse.next();
  addCorsHeaders(response, request);
  addCspHeaders(response, request);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
