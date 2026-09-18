import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { isRoutableProjectSlug } from "@/lib/project-slug";

const IS_LOCAL_MODE = isLocalOrchestratorEnabled();

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");
const MAX_LOCAL_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * ═══ LOCAL UPLOAD HANDLER ════════════════════════════════════════════════════
 *
 * In local mode, files are saved to `workspaces/{projectId}/public/uploads/`
 * and returned as `/api/preview/{projectId}/uploads/{filename}` URLs, which
 * are served transparently by the preview proxy — no extra route needed.
 */
async function handleLocalUpload(
  req: NextRequest,
  projectId: string
): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file provided", code: "VALIDATION" },
        { status: 400 }
      );
    }

    if (file.size > MAX_LOCAL_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `File is too large (max ${Math.floor(MAX_LOCAL_UPLOAD_BYTES / 1024 / 1024)} MB)`,
          code: "FILE_TOO_LARGE",
          retryable: false,
        },
        { status: 413 }
      );
    }

    const uploadsDir = path.join(WORKSPACES_DIR, projectId, "public", "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const timestamp = Date.now();
    const filename = `${timestamp}_${safeName}`;
    const filePath = path.join(uploadsDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const url = `/api/preview/${encodeURIComponent(projectId)}/uploads/${filename}`;

    return NextResponse.json({
      ok: true,
      data: { url, name: file.name, size: file.size, mimeType: file.type },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Upload failed",
        code: "UPLOAD_FAILED",
        retryable: true,
      },
      { status: 500 }
    );
  }
}

/**
 * Turn an upstream refusal into something a person can act on.
 */
function messageForStatus(status: number, upstream: string | null): string {
  if (upstream) return upstream;
  if (status === 413) return "That file is too large to upload.";
  if (status === 402) return "Not enough credits to upload this file.";
  if (status === 403 || status === 401)
    return "This project does not accept uploads with the current key.";
  return `Upload failed (${status}).`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  if (!isRoutableProjectSlug(projectId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid project id", code: "VALIDATION" },
      { status: 400 }
    );
  }

  if (IS_LOCAL_MODE) {
    const { localProjectStore } = await import("@/lib/local-orchestrator/project-store");
    const { isPreviewInitiatedRequest, resolveLocalTenant } = await import("@/lib/local-orchestrator/tenant-context");
    if (isPreviewInitiatedRequest(req)) {
      return NextResponse.json({ ok: false, error: "Preview applications cannot upload project files" }, { status: 403 });
    }
    const tenant = resolveLocalTenant(req);
    if (!(await localProjectStore.hydrateProject(projectId, tenant.tenantId))) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }
    const response = await handleLocalUpload(req, projectId);
    if (response.ok) await localProjectStore.persistSource(projectId);
    return response;
  }

  try {
    const { vcaasUploadRequest } = await import("@/lib/vcaas-server");
    const formData = await req.formData();
    const response = await vcaasUploadRequest(
      `/projects/${projectId}/files/upload`,
      formData
    );

    const raw = await response.text();
    let json: {
      errors: { errorCode: string; errorMessage: string } | null;
      data?: unknown;
    } | null = null;
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      json = null;
    }

    if (!response.ok || !json || json.errors) {
      const upstream = json?.errors?.errorMessage ?? null;
      return NextResponse.json(
        {
          ok: false,
          error: messageForStatus(response.status, upstream),
          code:
            json?.errors?.errorCode ??
            (response.status === 413 ? "FILE_TOO_LARGE" : "UPLOAD_FAILED"),
          retryable: response.status >= 500 || response.status === 429,
        },
        { status: response.status === 200 ? 400 : response.status }
      );
    }

    return NextResponse.json({ ok: true, data: json.data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Upload failed",
        code: "UPLOAD_FAILED",
        retryable: true,
      },
      { status: 500 }
    );
  }
}
