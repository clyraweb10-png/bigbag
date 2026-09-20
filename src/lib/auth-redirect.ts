const LOCAL_ORIGIN = "https://bigbag.local";

export const DEFAULT_AUTH_RETURN_PATH = "/dashboard";
export const OAUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Accept only same-origin application paths after sign-in. Parsing against a
 * fixed origin catches protocol-relative URLs and backslash variants that can
 * otherwise turn a convenient `next` parameter into an open redirect.
 */
export function safeAuthReturnPath(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_RETURN_PATH
): string {
  if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const target = new URL(value, LOCAL_ORIGIN);
    if (target.origin !== LOCAL_ORIGIN) return fallback;
    if (!target.pathname.startsWith("/") || target.pathname === "/api" || target.pathname.startsWith("/api/")) return fallback;
    if (target.pathname === "/login" || target.pathname.startsWith("/login/")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function isProtectedPagePath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname === "/generate" ||
    pathname.startsWith("/project/")
  );
}

/**
 * Canonical production origin.
 * Prefers NEXT_PUBLIC_APP_URL (already set to https://vibecode-spzy.onrender.com in production).
 * The hardcoded string is a compile-time last-resort only — it never overrides the env var.
 */
export const PRODUCTION_APP_ORIGIN: string =
  (() => {
    const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
    if (configured && !configured.includes("localhost")) return configured;
    return "https://vibecode-spzy.onrender.com";
  })();
export const LOCAL_DEV_ORIGIN = "http://localhost:3000";

/**
 * Supabase must return directly to the registered browser callback, where the
 * PKCE verifier is available in localStorage. This exact URL must match an
 * entry in Supabase's Redirect URLs allow-list. If it does not, Supabase falls
 * back to the project's Site URL before this application receives the code.
 */
export function oauthCallbackUrl(origin = resolveAppOrigin()): string {
  return new URL(OAUTH_CALLBACK_PATH, `${origin}/`).toString();
}

/**
 * Resolves the canonical application origin for post-login redirects and OAuth callbacks.
 * - In production (Render deployment): NEVER returns localhost. Always returns the
 *   NEXT_PUBLIC_APP_URL value (https://vibecode-spzy.onrender.com) or the verified public host.
 * - In local development: preserves http://localhost:3000.
 */
export function resolveAppOrigin(request?: {
  headers?: { get: (name: string) => string | null };
  url?: string;
}): string {
  const isProd = process.env.NODE_ENV === "production";
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const prodOrigin =
    configuredAppUrl && !configuredAppUrl.includes("localhost")
      ? configuredAppUrl
      : PRODUCTION_APP_ORIGIN;

  // 1. Production mode (Render / Cloud deployment):
  // ALWAYS return the canonical production origin (NEXT_PUBLIC_APP_URL = https://vibecode-spzy.onrender.com).
  // This guarantees that in production, redirects and OAuth callbacks NEVER leak or point to localhost:3000.
  if (isProd) {
    return prodOrigin;
  }

  // 2. Local development mode (NODE_ENV !== "production"):
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  if (request) {
    const forwardedHost = request.headers?.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (forwardedHost) {
      const proto = request.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
      return `${proto}://${forwardedHost}`;
    }
    const host = request.headers?.get("host")?.trim();
    if (host) {
      return `http://${host}`;
    }
    if (request.url) {
      try {
        return new URL(request.url).origin;
      } catch {}
    }
  }

  if (configuredAppUrl && configuredAppUrl.includes("localhost")) {
    return configuredAppUrl;
  }
  return LOCAL_DEV_ORIGIN;
}
