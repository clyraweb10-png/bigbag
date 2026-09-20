const LOCAL_ORIGIN = "https://bigbag.local";

export const DEFAULT_AUTH_RETURN_PATH = "/dashboard";

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

export const PRODUCTION_APP_ORIGIN = "https://vibecode-spzy.onrender.com";
export const LOCAL_DEV_ORIGIN = "http://localhost:3000";

/**
 * Resolves the canonical application origin for post-login redirects and OAuth callbacks.
 * - In production (Render deployment): NEVER returns localhost. Always returns https://vibecode-spzy.onrender.com
 *   or the verified public host.
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

  // 1. Production mode (Render / Cloud container environment):
  // Inside Docker, Node binds to 0.0.0.0:3000 and internal reverse-proxy headers
  // often report localhost:3000 or 127.0.0.1. We must NEVER return localhost in production.
  if (isProd) {
    if (request) {
      const forwardedHost = request.headers?.get("x-forwarded-host")?.split(",")[0]?.trim();
      const forwardedProto = request.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";

      if (
        forwardedHost &&
        !forwardedHost.startsWith("localhost") &&
        !forwardedHost.startsWith("127.0.0.1") &&
        !forwardedHost.startsWith("0.0.0.0")
      ) {
        return `${forwardedProto}://${forwardedHost}`;
      }

      const host = request.headers?.get("host")?.trim();
      if (
        host &&
        !host.startsWith("localhost") &&
        !host.startsWith("127.0.0.1") &&
        !host.startsWith("0.0.0.0")
      ) {
        return `https://${host}`;
      }
    }

    if (typeof window !== "undefined") {
      if (
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1" &&
        window.location.hostname !== "0.0.0.0"
      ) {
        return window.location.origin;
      }
    }

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
