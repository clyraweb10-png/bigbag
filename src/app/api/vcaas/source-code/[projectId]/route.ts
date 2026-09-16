import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { isLocalOrchestratorEnabled } from "@/lib/orchestrator-mode";
import { isRoutableProjectSlug } from "@/lib/project-slug";

const IS_LOCAL_MODE = isLocalOrchestratorEnabled();

const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);

/**
 * ═══ LOCAL SOURCE ARCHIVE ════════════════════════════════════════════════════
 *
 * Builds a ZIP archive of the workspace directory using PowerShell on Windows
 * or the system `zip` command on Linux/macOS, with no extra npm dependencies.
 */
async function buildLocalZip(projectId: string, workspaceDir: string): Promise<Buffer> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const os = await import("os");
  const execAsync = promisify(exec);

  const tmpOut = path.join(os.tmpdir(), `${projectId}-${Date.now()}.zip`);

  try {
    if (process.platform === "win32") {
      const safeWorkspaceDir = workspaceDir.replace(/'/g, "''");
      const safeTmpOut = tmpOut.replace(/'/g, "''");
      await execAsync(
        `powershell -NoProfile -Command "Get-ChildItem -Path '${safeWorkspaceDir}' -Exclude 'node_modules','.next','.git','.turbo' | Compress-Archive -DestinationPath '${safeTmpOut}' -Force"`,
        { timeout: 60000 }
      );
    } else {
      await execAsync(
        `cd "${workspaceDir}" && zip -r "${tmpOut}" . -x "node_modules/*" -x ".next/*" -x ".git/*" -x ".turbo/*"`,
        { timeout: 60000 }
      );
    }

    if (fs.existsSync(tmpOut)) {
      const buffer = fs.readFileSync(tmpOut);
      fs.unlinkSync(tmpOut);
      return buffer;
    }
  } catch (e) {
    console.error("[source-code] ZIP build failed:", e);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }

  // Return a minimal valid empty ZIP as last resort
  return Buffer.from("PK\x05\x06" + "\x00".repeat(18));
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count++;
  }
  return count;
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
      const workspaceDir = path.join(WORKSPACES_DIR, projectId);
      if (!fs.existsSync(workspaceDir)) {
        return NextResponse.json(
          { ok: false, error: "Project not found" },
          { status: 404 }
        );
      }

      const buffer = await buildLocalZip(projectId, workspaceDir);

      const filesCount = countFiles(workspaceDir);

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
