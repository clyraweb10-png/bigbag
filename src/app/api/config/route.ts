import { NextResponse } from "next/server";
import {
  hasConfiguredLocalModel,
  hasConfiguredRemoteOrchestrator,
  isLocalOrchestratorEnabled,
} from "@/lib/orchestrator-mode";

// Reports whether the AI engine is configured — WITHOUT ever
// exposing any key to the client. The dashboard uses this to show setup
// guidance when the builder hasn't been configured yet.
export function GET() {
  const isLocal = isLocalOrchestratorEnabled();

  return NextResponse.json({
    ok: true,
    data: {
      configured: isLocal ? hasConfiguredLocalModel() : hasConfiguredRemoteOrchestrator(),
      mode: isLocal ? "local" : "cloud",
    },
  });
}
