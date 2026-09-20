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
