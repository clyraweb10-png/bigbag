import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
// Extract origin from app URL (e.g. "https://my-app.com" from "https://my-app.com/")
const appOrigin = appUrl ? new URL(appUrl).origin : "";
// Optional: comma-separated list of additional allowed origins for custom deployments
const extraAllowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)
);

/**
 * Check if an origin is allowed for CORS.
 * - Development: any origin
 * - Production: NEXT_PUBLIC_APP_URL, ALLOWED_ORIGINS env, or same-host (custom domains)
 */
function isAllowedOrigin(origin: string, request: NextRequest): boolean {
  if (!isProduction) return true;
  if (appOrigin && origin === appOrigin) return true;
  if (extraAllowedOrigins.has(origin)) return true;

  // Trust same-host requests — custom domains served by this same server
  const host = request.headers.get("host");
  if (host && origin === `https://${host}`) return true;

  return false;
}

// Add CORS headers if the origin is allowed
function addCorsHeaders(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get("origin");

  if (origin && isAllowedOrigin(origin, request)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Max-Age", "86400");
    response.headers.set("Vary", "Origin");
  }

  return response;
}

// Set CSP to allow iframe embedding from any domain and remove X-Frame-Options
function addCspHeaders(response: NextResponse) {
  response.headers.set("Content-Security-Policy", "frame-ancestors *");
  response.headers.delete("X-Frame-Options");
  return response;
}

export async function proxy(request: NextRequest) {
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    addCorsHeaders(response, request);
    addCspHeaders(response);
    return response;
  }

  const { pathname, search } = request.nextUrl;
  const isPublic = pathname === "/login" || pathname === "/api/auth/session" || pathname === "/api/config";
  const isPage = !pathname.startsWith("/api/");
  const hasSession = Boolean(request.cookies.get("bigbag_session")?.value);

  // This is only a fast presence check. API routes verify the Firebase token.
  if (isPage && !isPublic && !hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return addCspHeaders(NextResponse.redirect(login));
  }
  if (pathname === "/login" && hasSession) {
    return addCspHeaders(NextResponse.redirect(new URL("/", request.url)));
  }

  const response = NextResponse.next();
  addCorsHeaders(response, request);
  addCspHeaders(response);
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
