export type PromptIntent = "build" | "chat";

const ACTION =
  "build|create|make|add|implement|change|update|edit|fix|repair|remove|delete|redesign|refactor|connect|integrate|clone|recreate|copy|match|deploy|publish";

const DIRECT_ACTION = new RegExp(`^(?:please\\s+)?(?:${ACTION})\\b`, "i");
const POLITE_ACTION = new RegExp(
  `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:${ACTION})\\b`,
  "i"
);
const REQUESTED_ACTION = new RegExp(
  `^i\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+to\\s+)?(?:${ACTION})\\b`,
  "i"
);
const QUESTION_START = /^(?:who|what|when|where|why|how|which|is|are|am|do|does|did|should|may|can|could|would|will)\b/i;
const URL = /https?:\/\/[^\s]+/i;
const URL_BUILD_DIRECTION = new RegExp(`\\b(?:${ACTION})\\b`, "i");

/**
 * Keep obvious questions conversational while preserving the builder's existing
 * default: short or ambiguous instructions still mean "change my app".
 * This is deliberately deterministic so a provider outage cannot prevent the
 * platform from deciding whether a prompt should touch project files.
 */
export function classifyPromptIntent(rawPrompt: string): PromptIntent {
  const prompt = rawPrompt.trim();
  if (!prompt) return "chat";

  if (
    DIRECT_ACTION.test(prompt) ||
    POLITE_ACTION.test(prompt) ||
    REQUESTED_ACTION.test(prompt) ||
    (URL.test(prompt) && URL_BUILD_DIRECTION.test(prompt))
  ) {
    return "build";
  }

  if (QUESTION_START.test(prompt) || prompt.endsWith("?")) return "chat";
  return "build";
}

export function appendPromptSuggestions(answer: string): string {
  if (/^suggestions\s*:/im.test(answer)) return answer.trim();
  return `${answer.trim()}\n\nSuggestions:\n- Review my current app and suggest the highest-impact improvements\n- Add one complete full-stack feature with validation and error states\n- Match the design of a pasted public URL and keep it responsive`;
}

export const CHAT_FALLBACK = appendPromptSuggestions(
  "I can answer questions about your product and help plan the next change. The chat providers are busy right now, but your app and current preview were left unchanged. You can still give me a direct build instruction and I will run it when a provider is available."
);
