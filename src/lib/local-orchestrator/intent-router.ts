/**
 * Intent Router — classifies what the user wants based on their message and the
 * current project stage. This drives whether we call the GLM planner
 * or the full code engine.
 *
 * No imports from vcaas or heavy deps — this must be importable server-side and
 * client-side alike (it's used in the API route AND in ChatPanel suggestion logic).
 */

/** Lifecycle stage of a project in the builder flow. */
export type ProjectStage =
  | "idle"                  // No conversation yet / fresh project
  | "planning"              // GLM is generating an implementation plan
  | "awaiting_confirmation" // Plan shown, waiting for user to confirm or refine
  | "building"              // Code engine running (agent.start called)
  | "active";               // App is live; user is iterating with edits

/** What the user intends with their message. */
export type UserIntent =
  | "chat"                 // Casual reply / question — use GLM chat mode
  | "plan"                 // Describe an app idea — generate Implementation Plan
  | "confirm_build"        // Confirm the plan → call code engine
  | "update_plan"          // Refine the plan (GLM, not code engine)
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

function confirmsBuild(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[.!]+$/g, "").trim();
  return CONFIRM_PHRASES.includes(normalized);
}

/**
 * Short messages that are almost certainly chitchat, not app descriptions.
 * Checked before deciding to generate a plan.
 */
const CHAT_PHRASES: RegExp[] = [
  /^(hi|hello|hey|howdy|yo|sup)[\s!?.]*$/,
  /^(thanks|thank you|thx|ty)[\s!?.]*$/,
  /^(ok|okay|got it|sounds good|great|nice|cool|awesome)[\s!?.]*$/,
  /^(help|what can you do|what do you do)[\s!?.]*$/,
];

const BUILD_ACTION = /\b(build|create|make|develop|design|generate|recreate|clone|implement|add|change|remove|update|fix|replace|redesign|adjust|modify|tweak|refine|resize|restyle|enlarge|darken|lighten|increase|decrease|rearrange|rename)\b/i;
const APP_SUBJECT = /\b(app|application|website|site|page|landing page|dashboard|portal|platform|store|shop|saas|crm|portfolio|blog|navbar|header|hero|section|form|auth|login|checkout|database)\b/i;
const QUESTION_START = /^(what|how|why|when|where|who|which|whose|whom|can you|could you|would you|should|do you|is there|is it|are there|tell me|explain)\b/i;
const EXPLANATORY_QUESTION_START = /^(?:(?:what|how|why|when|where|who)\b|(?:can|could|would) you (?:please )?(?:explain|describe|compare|clarify|tell me)\b|please (?:explain|describe|compare|clarify)\b)/i;
const IMPLICIT_EDIT = /\b(should|needs?|must|want|prefer|hate|(?:do not|don't) like|too (?:big|small|dark|light|busy|plain)|more|less|bigger|smaller|different|wrong|broken)\b/i;
const DOUBT_KEYWORDS = /\b(doubt|doubts|confused|not sure|wondering|clarify|clarification|explain|meaning|question|questions|difference between|how to|can I|can we|should I)\b/i;
const PLATFORM_CAPABILITY_QUESTION = /^(?:can|could|would)\s+(?:bigbag|this platform|the platform)\b/i;

export function isQuestionOrDoubt(message: string): boolean {
  const norm = message.trim().toLowerCase();
  if (!norm) return false;
  if (norm.includes("?")) return true;
  if (CHAT_PHRASES.some((re) => re.test(norm))) return true;
  if (QUESTION_START.test(norm)) return true;
  if (DOUBT_KEYWORDS.test(norm)) return true;
  return false;
}

function isActiveEditRequest(message: string): boolean {
  if (EXPLANATORY_QUESTION_START.test(message)) return false;
  if (/^(?:(?:can|could|should|would) i|is it possible for me to)\b/i.test(message)) return false;
  if (BUILD_ACTION.test(message)) return true;
  return APP_SUBJECT.test(message) && IMPLICIT_EDIT.test(message);
}

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

  // Code engine is already running — don't re-route.
  if (stage === "building") return "chat";

  // Planning in progress — don't re-plan.
  if (stage === "planning") return "chat";

  // A confirmation is meaningful only after a plan exists. Treating "start"
  // or "proceed" as a fresh build request loses the actual product brief.
  if (stage === "awaiting_confirmation" && confirmsBuild(norm)) {
    return "confirm_build";
  }

  // An active project still deserves a normal conversational assistant. Only
  // change code when the message actually asks for a product or UI change.
  if (stage === "active") return isActiveEditRequest(norm) ? "direct_edit" : "chat";

  // Once a plan exists, questions stay conversational and concrete product
  // changes refine the plan.
  if (stage === "awaiting_confirmation") {
    return isQuestionOrDoubt(norm) ? "chat" : "update_plan";
  }

  // "Can you build ...?" is a build request despite its grammar. Explanatory
  // questions such as "How can I build ...?" remain chat.
  if (PLATFORM_CAPABILITY_QUESTION.test(norm)) return "chat";
  if (EXPLANATORY_QUESTION_START.test(norm)) return "chat";
  if (!EXPLANATORY_QUESTION_START.test(norm) && BUILD_ACTION.test(norm)) {
    return "plan";
  }

  // If user is chatting or asking a doubt / question -> chat mode to answer them.
  if (isQuestionOrDoubt(norm)) {
    return "chat";
  }

  // A fresh product request first gets the conversational planning pass. The
  // user can then explicitly confirm it, while ordinary chat stays in chat mode.
  return APP_SUBJECT.test(norm) ? "plan" : "chat";
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

/**
 * Turn an approved planning conversation into the instruction consumed by the
 * code engine. Confirmation copy such as "proceed" is UI intent, not a useful
 * generation prompt, so the engine receives the actual request and latest plan.
 */
export function approvedBuildInstruction(
  messages: Array<{ author: string; message: string }>,
  fallback: string
): string {
  let planIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.author === "agent" && message.message.includes("Implementation Plan")) {
      planIndex = index;
      break;
    }
  }
  if (planIndex < 0) {
    const requests = messages
      .filter((message) => message.author === "user" && message.message.trim())
      .map((message) => message.message.trim());
    return requests.length > 0 ? requests.join("\n\n") : fallback;
  }

  const plan = messages[planIndex].message.trim();
  const requestContext = messages
    .slice(0, planIndex)
    .filter((message) => message.author === "user" && message.message.trim())
    .map((message) => message.message.trim());
  const originalRequest = requestContext.length === 1
    ? requestContext[0]
    : requestContext.map((message, index) => `${index + 1}. ${message}`).join("\n");

  return [
    "Build the complete application from the approved request and implementation plan.",
    originalRequest ? `Original request:\n${originalRequest}` : "",
    plan,
  ].filter(Boolean).join("\n\n");
}
