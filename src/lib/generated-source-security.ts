export type GeneratedSourceSeverity = "CRITICAL" | "HIGH" | "MEDIUM";

export interface GeneratedSourceLineFinding {
  finding: string;
  severity: GeneratedSourceSeverity;
}

const RULES: Array<GeneratedSourceLineFinding & { pattern: RegExp; clientOnly?: boolean }> = [
  {
    pattern: /\b(?:VITE_|NEXT_PUBLIC_)?(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|DATABASE_URL|DATABASE_PASSWORD|STRIPE_SECRET_KEY|E2B_API_KEY|FIRECRAWL_API_KEY|GEMINI_API_KEY|GLM_API_KEY|GROQ_API_KEY|TELNYX_API_KEY|TENANT_COOKIE_SECRET)\b/i,
    finding: "Server-only credential identifier appears in generated client source",
    severity: "CRITICAL",
    clientOnly: true,
  },
  {
    pattern: /\b(?:(?:sb_secret_|sk_(?:live|test)_|gsk_|e2b_|ghp_|glpat-|xoxb-)[A-Za-z0-9._-]{12,}|fc-[a-f0-9]{32}|AIza[A-Za-z0-9_-]{20,}|KEY[0-9A-F]{24,}_[A-Za-z0-9_-]{12,})\b/i,
    finding: "Credential-shaped literal appears in generated source",
    severity: "CRITICAL",
  },
  {
    pattern: /(?:postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/)[^\s"'`]+/i,
    finding: "Database connection string appears in generated source",
    severity: "CRITICAL",
  },
  {
    pattern: /\b(?:password|candidate)\s*(?:===|!==|==|!=)\s*(?:\w+\.)?(?:password|passwordHash|password_hash)\b/i,
    finding: "Password comparison appears in browser source",
    severity: "HIGH",
  },
  {
    pattern: /\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*["'`][^"'`]*(?:auth|session|access[_-]?token|refresh[_-]?token|bearer|jwt)[^"'`]*["'`]/i,
    finding: "Browser localStorage appears authoritative for authentication material",
    severity: "HIGH",
  },
  {
    pattern: /dangerouslySetInnerHTML\s*=/,
    finding: "Unreviewed raw HTML rendering sink",
    severity: "HIGH",
  },
  {
    pattern: /(?:href|src)\s*=\s*["'`]javascript:/i,
    finding: "JavaScript URL sink",
    severity: "HIGH",
  },
  {
    pattern: /\b(?:eval|Function)\s*\(/,
    finding: "Dynamic code execution sink",
    severity: "HIGH",
  },
  {
    pattern: /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE|DATABASE|PASSWORD)|VITE_[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE|DATABASE|PASSWORD)/,
    finding: "Server-only value is exposed through a public environment variable",
    severity: "HIGH",
  },
];

function isClientSource(relativeFile: string): boolean {
  if (/\.(?:tsx|jsx|html)$/i.test(relativeFile)) return true;
  if (!/\.(?:ts|js)$/i.test(relativeFile)) return false;
  return !/(?:^|\/)(?:server|api|backend|functions)(?:\/|$)|\.server\.(?:ts|js)$/i.test(relativeFile);
}

export function scanGeneratedSourceLine(relativeFile: string, line: string): GeneratedSourceLineFinding[] {
  return RULES.flatMap((rule) => {
    if (rule.clientOnly && !isClientSource(relativeFile)) return [];
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(line) ? [{ finding: rule.finding, severity: rule.severity }] : [];
  });
}
