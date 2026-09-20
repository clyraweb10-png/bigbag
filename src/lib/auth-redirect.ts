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

/**
 * Resolves the canonical application origin for post-login redirects and OAuth callbacks.
 * - Local development (localhost / 127.0.0.1) returns http://localhost:3000 (or the local host:port).
 * - Production (Render deployment) returns https://vibecode-spzy.onrender.com.
 */
export function resolveAppOrigin(request?: {
  headers?: { get: (name: string) => string | null };
  url?: string;
}): string {
  if (request) {
    const forwardedHost = request.headers?.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";

    if (forwardedHost) {
      if (forwardedHost.startsWith("localhost") || forwardedHost.startsWith("127.0.0.1")) {
        return `http://${forwardedHost}`;
      }
      return `${forwardedProto}://${forwardedHost}`;
    }

    const host = request.headers?.get("host")?.trim();
    if (host) {
      if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        return `http://${host}`;
      }
      return `https://${host}`;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
    if (appUrl && (process.env.NODE_ENV !== "production" || !appUrl.includes("localhost"))) {
      return appUrl;
    }

    if (request.url) {
      try {
        const reqUrl = new URL(request.url);
        if (reqUrl.hostname === "localhost" || reqUrl.hostname === "127.0.0.1") {
          if (process.env.NODE_ENV === "production") {
            return "https://vibecode-spzy.onrender.com";
          }
          return reqUrl.origin;
        }
        return reqUrl.origin;
      } catch {}
    }
  }

  // Browser context
  if (typeof window !== "undefined") {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return window.location.origin;
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
    if (appUrl && !appUrl.includes("localhost")) {
      return appUrl;
    }
    return window.location.origin;
  }

  // Server fallback
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (appUrl && (process.env.NODE_ENV !== "production" || !appUrl.includes("localhost"))) {
    return appUrl;
  }

  if (process.env.NODE_ENV === "production") {
    return "https://vibecode-spzy.onrender.com";
  }
  return "http://localhost:3000";
}
