/**
 * Client-side helpers for the auto-screenshot feature.
 *
 * When an agent run finishes and the preview becomes available, the workspace
 * page calls `captureProjectScreenshot`, which hits the server route at
 * `/api/screenshot/[projectId]`.  The server route calls Firecrawl to capture
 * a screenshot of the live preview, then returns the URL.
 *
 * The URL is cached in `localStorage` alongside a timestamp, so the dashboard
 * can show it immediately on next load without any extra network round-trip.
 * Cached URLs expire after `TTL_MS` (24 h) to avoid showing stale content when
 * Firecrawl's CDN purges the asset.
 *
 * This module is client-only — do not import from a server component or route.
 */

const STORAGE_KEY_PREFIX = "bigbag:preview-screenshot:";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedScreenshot {
  url: string;
  capturedAt: number;
}

/** Read the cached screenshot URL for a project, or `null` if absent / expired. */
export function getCachedScreenshot(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedScreenshot;
    if (Date.now() - entry.capturedAt > TTL_MS) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${projectId}`);
      return null;
    }
    return entry.url;
  } catch {
    return null;
  }
}

/** Persist a screenshot URL for a project. */
function setCachedScreenshot(projectId: string, url: string): void {
  try {
    const entry: CachedScreenshot = { url, capturedAt: Date.now() };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(entry));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Fire-and-forget: calls the server-side screenshot route for the given project
 * and preview URL, then caches the result in localStorage.
 *
 * Safe to call after every agent run — the server degrades gracefully when
 * Firecrawl is not configured.
 *
 * @param onSuccess  Called with the screenshot URL when capture succeeds.
 *                   Use this to update dashboard state without a full reload.
 */
export async function captureProjectScreenshot(
  projectId: string,
  previewUrl: string,
  onSuccess?: (screenshotUrl: string) => void
): Promise<void> {
  try {
    const res = await fetch(`/api/screenshot/${encodeURIComponent(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewUrl }),
    });

    if (!res.ok) return; // network error — degrade silently

    const payload = (await res.json()) as { ok: boolean; data?: { screenshotUrl?: string } };
    if (payload.ok && payload.data?.screenshotUrl) {
      setCachedScreenshot(projectId, payload.data.screenshotUrl);
      onSuccess?.(payload.data.screenshotUrl);
    }
  } catch {
    // Swallow — this is a best-effort enhancement; never let it break the workspace.
  }
}
