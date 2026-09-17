import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { verifyFirebaseIdToken, type FirebaseServerUser } from "@/lib/firebase-auth-server";
import { projectAccess } from "@/lib/project-access";

export { isRoutableProjectSlug } from "@/lib/project-slug";

export interface VcaasContext { accountUserId: string; user: FirebaseServerUser }
export interface VcaasAuthOk { ok: true; ctx: VcaasContext; team: { userId: string } }
export type VcaasAuthResult = VcaasAuthOk | { ok: false; response: NextResponse };
export type VcaasAuthFailed = Extract<VcaasAuthResult, { ok: false }>;

export function authFailed(result: VcaasAuthResult): result is VcaasAuthFailed { return result.ok === false; }

export async function resolveVcaasContext(): Promise<VcaasAuthResult> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  const authorization = headerStore.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const user = await verifyFirebaseIdToken(bearer || cookieStore.get("bigbag_session")?.value || "");
  if (!user) {
    return { ok: false, response: NextResponse.json(
      { ok: false, error: "Sign in with Google to access this workspace.", code: "UNAUTHORIZED" },
      { status: 401 }
    ) };
  }
  return { ok: true, ctx: { accountUserId: user.uid, user }, team: { userId: user.uid } };
}

export function enforceProjectScope(team: { userId: string }, _method: string, path: string[]): NextResponse | null {
  const projectId = path[0] === "projects" ? path[1] : undefined;
  if (!projectId || projectId === "launch" || projectAccess.canAccess(team.userId, projectId)) return null;
  return NextResponse.json({ ok: false, error: "Project not found.", code: "NOT_FOUND" }, { status: 404 });
}
