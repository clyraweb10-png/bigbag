import { NextResponse } from "next/server";
import {
  hasConfiguredLocalModel,
  hasConfiguredRemoteOrchestrator,
  isLocalOrchestratorEnabled,
} from "@/lib/orchestrator-mode";
import { durablePersistenceConfigured } from "@/lib/local-orchestrator/durable-project-store";

// Reports whether the AI engine and storage are configured — WITHOUT ever
// exposing any key to the client. The dashboard uses this to show setup
// guidance when the builder hasn't been configured yet.
export function GET() {
  const isLocal = isLocalOrchestratorEnabled();
  const persistenceOk = durablePersistenceConfigured();

  return NextResponse.json({
    ok: true,
    data: {
      configured: isLocal
        ? hasConfiguredLocalModel() && persistenceOk
        : hasConfiguredRemoteOrchestrator(),
      mode: isLocal ? "local" : "cloud",
      persistenceConfigured: persistenceOk,
    },
  });
}
