/**
 * One server-side answer for every route that needs to choose between the
 * self-hosted orchestrator and the legacy remote backend.
 *
 * Keeping this in one place matters: the preview and API proxy previously used
 * different tests, so a keyless install created projects locally and then tried
 * to resolve their preview through the remote API.
 */

const PLACEHOLDER_REMOTE_KEYS = new Set(["your_key_here", "local-orchestrator-active"]);

function remoteApiKey(): string {
  return (process.env.TOTALUM_VCAAS_API_KEY || process.env.VCAAS_API_KEY || "").trim();
}

export function hasConfiguredLocalModel(): boolean {
  return Boolean(
    process.env.GLM_API_KEY?.trim() ||
      process.env.GLM_API_KEY_2?.trim() ||
      process.env.GROQ_API_KEY?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim()
  );
}

export function hasConfiguredRemoteOrchestrator(): boolean {
  const key = remoteApiKey();
  return Boolean(key && !PLACEHOLDER_REMOTE_KEYS.has(key));
}

export function isLocalOrchestratorEnabled(): boolean {
  if (process.env.ORCHESTRATOR_MODE?.trim().toLowerCase() === "local") return true;
  if (process.env.USE_LOCAL_ORCHESTRATOR?.trim().toLowerCase() === "true") return true;
  return !hasConfiguredRemoteOrchestrator();
}
