const NEXT_PROMPTS_PATTERN = /<!--\s*next-prompts\s*([\s\S]*?)-->/i;

export interface PlannerOutput {
  text: string;
  suggestions: string[];
}

/**
 * Keep the planner/UI lifecycle contract deterministic when a provider omits
 * a requested boundary marker. Model-authored visible content is preserved.
 */
export function normalizePlannerText(
  intent: "chat" | "plan" | "update_plan",
  text: string
): string {
  const visible = text.trim();
  if (intent === "chat" || !visible) return visible;

  const withHeading = /^##\s+Implementation Plan\b/im.test(visible)
    ? visible
    : `## Implementation Plan\n\n${visible}`;

  return /Ready to build\?\s*$/i.test(withHeading)
    ? withHeading
    : `${withHeading}\n\nReady to build?`;
}

/**
 * Separates model-authored follow-up ideas from the assistant response. The
 * marker is intentionally HTML-comment syntax so older clients still render a
 * readable response if they receive a newer planner payload.
 */
export function parsePlannerOutput(raw: string): PlannerOutput {
  const match = raw.match(NEXT_PROMPTS_PATTERN);
  if (!match) return { text: raw.trim(), suggestions: [] };

  let suggestions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      suggestions = [...new Set(parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length >= 4 && item.length <= 140))]
        .slice(0, 10);
    }
  } catch {
    // A malformed optional suggestion block must not hide the useful reply.
  }

  return {
    text: raw.replace(match[0], "").trim(),
    suggestions,
  };
}
