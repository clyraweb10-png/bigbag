/**
 * Intent Router — classifies what the user wants based on their message and the
 * current project stage. This drives whether we call the fast Groq/GLM planner
 * or the full code engine.
 *
 * No imports from vcaas or heavy deps — this must be importable server-side and
 * client-side alike (it's used in the API route AND in ChatPanel suggestion logic).
 */

/** Lifecycle stage of a project in the builder flow. */
export type ProjectStage =
  | "idle"                  // No conversation yet / fresh project
  | "planning"              // Groq/GLM is generating an implementation plan
  | "awaiting_confirmation" // Plan shown, waiting for user to confirm or refine
  | "building"              // Code engine running (agent.start called)
  | "active";               // App is live; user is iterating with edits

/** What the user intends with their message. */
export type UserIntent =
  | "chat"                 // Casual reply / question — use Groq/GLM chat mode
  | "plan"                 // Describe an app idea — generate Implementation Plan
  | "confirm_build"        // Confirm the plan → call code engine
  | "update_plan"          // Refine the plan (Groq/GLM, not code engine)
  | "direct_edit";         // Existing active project — go straight to code engine

/**
 * Phrases that confirm the user wants to build now.
 * Matched case-insensitively against a normalised (trimmed, lowercased) version
 * of the user message. "Yes" alone is intentionally excluded — only "yes, build
 * it" or longer forms, to prevent false positives on simple acknowledgements.
 */
const CONFIRM_PHRASES: string[] = [
  "proceed",
  "build it",
  "start building",
  "yes, build it",
  "let's build it",
  "go ahead",
  "go ahead and build",
  "start",
  "build now",
  "ok build",
  "okay build",
  "do it",
  "lets go",
  "let's go",
  "ship it",
  "make it",
  "create it",
  "generate it",
];

/**
 * Short messages that are almost certainly chitchat, not app descriptions.
 * Checked before deciding to generate a plan.
 */
const CHAT_PHRASES: RegExp[] = [
  /^(hi|hello|hey|howdy|yo|sup)\b/,
  /^(thanks|thank you|thx|ty)\b/,
  /^(ok|okay|got it|sounds good|great|nice|cool|awesome)\b/,
  /^(what|how|why|when|where|who|can you|do you)\b/,
  /^(help|what can you|what do you)\b/,
];

/**
 * Classify the user's intent based on their message and the current project stage.
 *
 * @param message         The raw user message text.
 * @param stage           The current project lifecycle stage.
 * @param lastAgentMsg    The most recent agent message (used for "yes" disambiguation).
 */
export function classifyIntent(
  message: string,
  stage: ProjectStage,
  _lastAgentMsg?: string   // reserved: future context-aware "yes" disambiguation
): UserIntent {
  const norm = message.trim().toLowerCase();

  // Active project always goes to the code engine.
  if (stage === "active") return "direct_edit";

  // Code engine is already running — don't re-route.
  if (stage === "building") return "chat";

  // Planning in progress — don't re-plan.
  if (stage === "planning") return "chat";

  // Awaiting confirmation: check for a confirm phrase first.
  if (stage === "awaiting_confirmation") {
    const isConfirm = CONFIRM_PHRASES.some((phrase) => norm.includes(phrase));
    if (isConfirm) return "confirm_build";
    // Anything else refines the plan.
    return "update_plan";
  }

  // Idle stage: distinguish chat from a real app idea.
  // Confirm phrases at idle still go to plan (they have no plan to confirm yet).
  if (CHAT_PHRASES.some((re) => re.test(norm))) return "chat";

  // Very short messages are chitchat.
  const wordCount = norm.split(/\s+/).filter(Boolean).length;
  if (wordCount < 4) return "chat";

  // Long enough to be an app idea → generate plan.
  return "plan";
}

/** Infer a stage from a conversation history on page load (no store persistence needed). */
export function inferStageFromConversation(
  messages: Array<{ author: string; message: string; messageType?: string }>,
  isBuilding: boolean
): ProjectStage {
  if (isBuilding) return "building";
  if (messages.length === 0) return "idle";

  // Check the last agent message.
  const agentMsgs = messages.filter((m) => m.author === "agent");
  if (agentMsgs.length === 0) return "idle";

  const lastAgent = agentMsgs[agentMsgs.length - 1];

  // If there are "finished" messages with file writes, the project is active.
  const hasFinished = messages.some(
    (m) => m.author === "agent" && m.messageType === "finished"
  );
  if (hasFinished) return "active";

  // If the last agent message contains an implementation plan, await confirmation.
  if (
    lastAgent.message.includes("## Implementation Plan") ||
    lastAgent.message.includes("Ready to build?")
  ) {
    return "awaiting_confirmation";
  }

  return "idle";
}
