const CREDENTIAL_PREFIX = /^(?:gsk_|sk[-_]|e2b_|fc-|sb_secret_|ghp_|glpat-|xoxb-|AIza|KEY[0-9a-f]{24}_)/i;

/** Keep accidental credentials in a model-name setting out of requests and logs. */
export function safeConfiguredModel(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 128 || !/^[a-z][a-z0-9./:_-]+$/i.test(candidate) || CREDENTIAL_PREFIX.test(candidate)) {
    return fallback;
  }
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)$/i.test(name) && secret && candidate === secret) return fallback;
  }
  return candidate;
}
