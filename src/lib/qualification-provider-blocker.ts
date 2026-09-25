/** Classify an attempted generation that could not produce source because every model provider was unavailable. */
export function qualificationProviderBlocker(message: string, hasGeneratedSource: boolean): string | null {
  if (hasGeneratedSource) return null;
  const category = /\bAI request failed \((authentication|rate_limit|network_timeout|network_error|provider_unavailable)\)/.exec(message)?.[1];
  return category || null;
}
