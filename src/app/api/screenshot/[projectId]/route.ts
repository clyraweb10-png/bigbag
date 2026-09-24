/**
 * POST /api/screenshot/[projectId]
 *
 * Body: { previewUrl: string }
 *
 * Uses Firecrawl's /v2/scrape endpoint to take a full-page screenshot of the
 * project's live preview URL, then returns the screenshot URL so the caller
 * can cache it in localStorage for the dashboard thumbnail.
 *
 * In local orchestrator mode the URL is also persisted to the project record,
 * so the dashboard list endpoint can include it in `previewImageUrl` without
 * any localStorage dependency.
 *
 * Authentication: the session cookie is verified by the provider-backed route
 * layer. No Totalum project access is checked here because the preview URL is
 * provided by the caller and is validated as a public URL before fetch.
 *
 * Graceful degradation: if FIRECRAWL_API_KEY is not configured, or if the
 * preview URL is unreachable, returns { ok: false } — the dashboard falls back
 * to the Totalum-supplied previewImageUrl or the gradient placeholder.
 */

import { NextRequest, NextResponse } from "next/server";
import { publicUrlRejectionReason } from "@/lib/safe-url";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { localProjectStore } from "@/lib/local-orchestrator/project-store";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  const { projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    // Not configured — degrade gracefully so the dashboard just shows the placeholder.
    return NextResponse.json({ ok: false, error: "FIRECRAWL_API_KEY not configured" }, { status: 200 });
  }

  let previewUrl: string;
  try {
    const body = (await req.json()) as { previewUrl?: unknown };
    if (typeof body.previewUrl !== "string" || !body.previewUrl) {
      return NextResponse.json({ ok: false, error: "previewUrl is required" }, { status: 400 });
    }
    previewUrl = body.previewUrl;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate the URL is public and not a private/internal address.
  const rejection = await publicUrlRejectionReason(previewUrl);
  if (rejection) {
    return NextResponse.json({ ok: false, error: `Preview URL rejected: ${rejection}` }, { status: 200 });
  }

  try {
    const response = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        url: previewUrl,
        onlyMainContent: false,
        timeout: 45_000,
        formats: [
          { type: "screenshot", fullPage: false, quality: 72 },
        ],
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: { screenshot?: string };
      error?: string;
    } | null;

    if (!response.ok || !payload?.success || !payload.data?.screenshot) {
      console.warn(
        `[screenshot] Firecrawl failed for project "${projectId}": ` +
          `HTTP ${response.status} — ${payload?.error ?? "no screenshot in response"}`
      );
      return NextResponse.json({ ok: false, error: payload?.error ?? "Firecrawl did not return a screenshot" }, { status: 200 });
    }

    const screenshotUrl = payload.data.screenshot;
    console.info(`[screenshot] Captured preview for project "${projectId}": ${screenshotUrl.slice(0, 80)}…`);

    // In local orchestrator mode, persist the screenshot URL to the project record
    // so the dashboard list includes it as previewImageUrl (survives page reloads).
    if (isLocalOrchestratorEnabled()) {
      try {
        localProjectStore.saveScreenshotUrl(projectId, screenshotUrl);
      } catch (saveErr) {
        console.warn(`[screenshot] Could not save screenshot URL for "${projectId}":`, saveErr);
      }
    }

    return NextResponse.json({ ok: true, data: { screenshotUrl } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[screenshot] Firecrawl error for project "${projectId}": ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
