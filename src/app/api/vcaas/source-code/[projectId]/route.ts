import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { zip } from "fflate";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { isRoutableProjectSlug } from "@/lib/project-slug";

const IS_LOCAL_MODE = isLocalOrchestratorEnabled();

const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);

/**
 * ═══ LOCAL SOURCE ARCHIVE ════════════════════════════════════════════════════
 *
 * Builds the source archive in-process. Render images do not guarantee that the
 * system `zip` utility is installed, and silently returning an empty archive
 * makes the editor claim that a successful generation produced zero files.
 */
async function buildLocalZip(
  workspaceDir: string
): Promise<{ buffer: Buffer; filesCount: number }> {
  const entries: Record<string, Uint8Array> = {};

  async function walk(currentDir: string): Promise<void> {
    const directoryEntries = await fs.promises.readdir(currentDir, {
      withFileTypes: true,
    });
    await Promise.all(directoryEntries.map(async (entry) => {
      if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) return;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(workspaceDir, fullPath).replace(/\\/g, "/");
        entries[relativePath] = await fs.promises.readFile(fullPath);
      }
    }));
  }

  await walk(workspaceDir);
  const filesCount = Object.keys(entries).length;
  if (filesCount === 0) {
    throw new Error("The generated workspace does not contain any source files yet");
  }

  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  return {
    buffer: Buffer.from(archive),
    filesCount,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  if (!isRoutableProjectSlug(projectId)) {
    return NextResponse.json({ ok: false, error: "Invalid project id" }, { status: 400 });
  }

  if (IS_LOCAL_MODE) {
    try {
      const { localProjectStore } = await import("@/lib/local-orchestrator/project-store");
      const { isPreviewInitiatedRequest, resolveLocalTenant } = await import("@/lib/local-orchestrator/tenant-context");
      if (isPreviewInitiatedRequest(req)) {
        return NextResponse.json({ ok: false, error: "Preview applications cannot access project source" }, { status: 403 });
      }
      const tenant = resolveLocalTenant(req);
      if (!(await localProjectStore.hydrateProject(projectId, tenant.tenantId))) {
        return NextResponse.json(
          { ok: false, error: "Project not found" },
          { status: 404 }
        );
      }
      const workspaceDir = localProjectStore.getWorkspaceDir(projectId);

      const { buffer, filesCount } = await buildLocalZip(workspaceDir);

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${projectId}.zip"`,
          "Content-Length": String(buffer.byteLength),
          "x-files-count": String(filesCount),
          "x-commit-sha": "",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to build archive",
        },
        { status: 500 }
      );
    }
  }

  try {
    const { vcaasRequest } = await import("@/lib/vcaas-server");
    const metaRes = await vcaasRequest(`/projects/${projectId}/source-code`);
    const metaJson = (await metaRes.json()) as {
      errors: { errorCode: string; errorMessage: string } | null;
      data: { filesCount?: number; lastCommitSha?: string; downloadUrl?: string | null } | null;
    };

    if (metaJson.errors || !metaJson.data?.downloadUrl) {
      const errorMessage =
        metaJson.errors?.errorMessage ||
        "No download URL returned for project source code";
      const code = metaJson.errors?.errorCode;
      const status =
        code === "PROJECT_NOT_FOUND"
          ? 404
          : code === "INSUFFICIENT_CREDITS"
          ? 402
          : code === "MISSING_PROJECT_ID"
          ? 400
          : metaRes.ok
          ? 502
          : metaRes.status || 500;
      return NextResponse.json({ ok: false, error: errorMessage }, { status });
    }

    const { downloadUrl, filesCount, lastCommitSha } = metaJson.data;
    const zipRes = await fetch(downloadUrl!);
    if (!zipRes.ok) {
      return NextResponse.json(
        { ok: false, error: `Failed to download source archive (HTTP ${zipRes.status})` },
        { status: 502 }
      );
    }

    const buffer = await zipRes.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(buffer.byteLength),
        "x-files-count": String(filesCount ?? 0),
        "x-commit-sha": String(lastCommitSha ?? ""),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch source code" },
      { status: 500 }
    );
  }
}
