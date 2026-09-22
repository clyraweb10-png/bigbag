/**
 * Planner client — calls the Groq / GLM "fast interaction tier" for chat, planning,
 * and plan refinement. This is the server-side half; the browser calls /api/planner.
 *
 * Fallback chain: Groq (qwen/qwen3.8-27b) → GLM-4.7-Flash → glm-4.5-flash → throw.
 *
 * ⚠️ SERVER ONLY — reads API keys from env; never import from a client component.
 */
import "server-only";

export interface PlannerResult {
  text: string;
  durationMs: number;
  provider: "groq" | "glm-47-flash" | "glm-45-flash";
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
  timeoutMs = 15_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
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
 * Falls back through Groq → GLM-4.7-Flash → glm-4.5-flash.
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

  const fullMessages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // --- Try Groq first ---
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
      console.warn("[planner] Groq failed, falling back to GLM:", (err as Error).message);
    }
  }

  // --- Try GLM-4.7-Flash ---
  if (glmApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        glmBaseUrl,
        glmApiKey,
        glmModel,
        fullMessages,
        1500 // GLM-4.7-Flash is a reasoning model; needs 1000+ tokens minimum
      );
      return { text, durationMs: Date.now() - start, provider: "glm-47-flash" };
    } catch (err) {
      console.warn("[planner] GLM-4.7-Flash failed, falling back to glm-4.5-flash:", (err as Error).message);
    }

    // --- Try glm-4.5-flash as final fallback ---
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        glmBaseUrl,
        glmApiKey,
        "glm-4.5-flash",
        fullMessages,
        1024
      );
      return { text, durationMs: Date.now() - start, provider: "glm-45-flash" };
    } catch (err) {
      console.warn("[planner] glm-4.5-flash also failed:", (err as Error).message);
    }
  }

  throw new Error(
    "All planner providers failed. Set GROQ_API_KEY or GLM_API_KEY in .env.local."
  );
}
