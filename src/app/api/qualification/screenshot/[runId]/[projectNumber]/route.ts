import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isQualificationOperator, verifyAuthSession } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string; projectNumber: string }> }
) {
  const session = verifyAuthSession(request.cookies.get(AUTH_COOKIE)?.value);
  if (!session || !isQualificationOperator(session)) {
    return new NextResponse(null, { status: 404 });
  }
  const { runId, projectNumber } = await context.params;
  const number = Number(projectNumber);
  if (!/^[a-z0-9-]{1,120}$/i.test(runId) || !Number.isInteger(number) || number < 1 || number > 100) {
    return new NextResponse(null, { status: 404 });
  }
  const workspaceRoot = process.env.WORKSPACE_ROOT;
  if (!workspaceRoot) return new NextResponse(null, { status: 404 });
  const file = path.join(workspaceRoot, "output", "bigbag-qualification", runId, "screenshots", `project-${String(number).padStart(2, "0")}-desktop.png`);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 5_000_000) return new NextResponse(null, { status: 404 });
    const content = await fs.readFile(file);
    return new NextResponse(content, {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
