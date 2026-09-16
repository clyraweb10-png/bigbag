import { NextResponse } from "next/server";
import { getVcaasApiKey } from "@/lib/vcaas-server";

// Reports whether the AI engine is configured — WITHOUT ever
// exposing any key to the client. The dashboard uses this to show setup
// guidance when the builder hasn't been configured yet.
export function GET() {
  const hasLocalKeys =
    Boolean(process.env.GLM_API_KEY) ||
    Boolean(process.env.GROQ_API_KEY) ||
    Boolean(process.env.OPENROUTER_API_KEY);

  const isLocal =
    process.env.ORCHESTRATOR_MODE === "local" ||
    process.env.USE_LOCAL_ORCHESTRATOR === "true" ||
    hasLocalKeys ||
    !process.env.TOTALUM_VCAAS_API_KEY ||
    process.env.TOTALUM_VCAAS_API_KEY === "local-orchestrator-active";

  return NextResponse.json({
    ok: true,
    data: {
      configured: isLocal || getVcaasApiKey().trim().length > 0,
      mode: isLocal ? "local" : "cloud",
    },
  });
}
