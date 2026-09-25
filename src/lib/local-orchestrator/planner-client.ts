/**
 * Planner client — calls the GLM / Groq / Gemini fast interaction tier for chat, planning,
 * and plan refinement. This is the server-side half; the browser calls /api/planner.
 *
 * Fallback chain: GLM-4.7-Flash → Groq → Gemini → glm-4.5-flash → throw.
 *
 * ⚠️ SERVER ONLY — reads API keys from env; never import from a client component.
 */
import "server-only";

export interface PlannerResult {
  text: string;
  durationMs: number;
  provider: "glm-47-flash" | "groq" | "gemini-flash" | "glm-45-flash";
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    // GLM-4.7-Flash thinking model: reasoning lives here
    reasoning_content?: string | null;
  };
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
}

async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: OpenAIMessage[],
  maxTokens: number,
  timeoutMs = 15_000,
  extraBody: Record<string, unknown> = {}
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        ...extraBody,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as OpenAIResponse;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No choices in response");

  // GLM-4.7-Flash is a reasoning model: it outputs reasoning_content first,
  // then content. If content is empty (common with low max_tokens), throw so
  // the caller can fall back to glm-4.5-flash with a higher token budget.
  const content = choice.message?.content ?? "";
  if (!content.trim()) {
    throw new Error("Empty content (reasoning model may need more tokens)");
  }

  return content;
}

/**
 * Call the planner with the given system prompt and user message.
 * Falls back through GLM-4.7-Flash → Groq → Gemini → glm-4.5-flash.
 *
 * @param systemPrompt  One of CHAT_PROMPT, PLANNER_PROMPT, or REFINE_PROMPT.
 * @param messages      Full conversation history to send (system prompt prepended internally).
 */
export async function callPlanner(
  systemPrompt: string,
  messages: OpenAIMessage[],
  options: { groqMaxTokens?: number } = {}
): Promise<PlannerResult> {
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqBaseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
  const groqModel = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  const groqMaxTokens = Math.min(
    950,
    Math.max(256, parseInt(process.env.GROQ_MAX_TOKENS || "950", 10) || 950)
  );

  const glmApiKey = process.env.GLM_API_KEY;
  const glmBaseUrl = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  const glmModel = process.env.GLM_MODEL || "GLM-4.7-Flash";

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiBaseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const geminiMaxTokens = Math.min(
    2_048,
    Math.max(512, parseInt(process.env.GEMINI_MAX_TOKENS || "2048", 10) || 2_048)
  );

  const fullMessages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // --- Try GLM-4.7-Flash first for interactive chat and context questions ---
  if (glmApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        glmBaseUrl,
        glmApiKey,
        glmModel,
        fullMessages,
        1_500
      );
      return { text, durationMs: Date.now() - start, provider: "glm-47-flash" };
    } catch (err) {
      console.warn("[planner] Primary interaction provider failed; trying the next provider:", (err as Error).message);
    }
  }

  // --- Then Groq ---
  if (groqApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        groqBaseUrl,
        groqApiKey,
        groqModel,
        fullMessages,
        Math.min(groqMaxTokens, options.groqMaxTokens ?? groqMaxTokens)
      );
      return { text, durationMs: Date.now() - start, provider: "groq" };
    } catch (err) {
      console.warn("[planner] Secondary interaction provider failed; trying the next provider:", (err as Error).message);
    }
  }

  // --- Then Gemini ---
  if (geminiApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        geminiBaseUrl,
        geminiApiKey,
        geminiModel,
        fullMessages,
        geminiMaxTokens,
        15_000,
        { reasoning_effort: "none" }
      );
      return { text, durationMs: Date.now() - start, provider: "gemini-flash" };
    } catch (err) {
      console.warn("[planner] Tertiary interaction provider failed; trying the final provider:", (err as Error).message);
    }
  }

  // --- Finish with the non-reasoning GLM fallback when the same endpoint is available ---
  if (glmApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(glmBaseUrl, glmApiKey, "glm-4.5-flash", fullMessages, 1_024);
      return { text, durationMs: Date.now() - start, provider: "glm-45-flash" };
    } catch (err) {
      console.warn("[planner] Final interaction provider failed:", (err as Error).message);
    }
  }

  throw new Error(
    "All planner providers failed. Configure at least one supported interaction provider."
  );
}
