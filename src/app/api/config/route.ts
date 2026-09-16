import { NextResponse } from "next/server";
import { getVcaasApiKey } from "@/lib/vcaas-server";

// Reports whether the Totalum VCaaS API key is configured — WITHOUT ever
// exposing the key itself to the client. The dashboard uses this to show setup
// guidance when the builder hasn't been given a key yet.
export function GET() {
  const isLocal =
    process.env.ORCHESTRATOR_MODE === "local" ||
    Boolean(process.env.GLM_API_KEY);

  return NextResponse.json({
    ok: true,
    data: {
      configured: isLocal || getVcaasApiKey().trim().length > 0,
      mode: isLocal ? "local" : "totalum",
    },
  });
}
