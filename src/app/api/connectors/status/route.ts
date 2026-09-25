import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyAuthSession } from "@/lib/auth-session";
import { durablePersistenceConfigured } from "@/lib/local-orchestrator/durable-project-store";

/** Configuration is reported without returning credential values or claiming provider health. */
export function GET(request: NextRequest) {
  if (!verifyAuthSession(request.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "Sign in to view connector configuration" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      supabase: durablePersistenceConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      firecrawl: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
      pexels: Boolean(process.env.PEXELS_API_KEY?.trim()),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
