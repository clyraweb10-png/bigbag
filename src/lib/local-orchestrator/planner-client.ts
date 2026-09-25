/**
 * Planner client — calls the GLM / Groq / Gemini fast interaction tier for chat, planning,
 * and plan refinement. This is the server-side half; the browser calls /api/planner.
 *
 * Chat streams through Groq Qwen (up to 50 words) or Telnyx GLM 5.3 Flash
 * (longer questions). Onboarding/planning use GLM 5.3 Flash; neither route
 * produces project source code.
 *
 * ⚠️ SERVER ONLY — reads API keys from env; never import from a client component.
 */
import "server-only";

export interface PlannerResult {
  text: string;
  durationMs: number;
  provider: "glm-47-flash" | "groq" | "gemini-flash" | "glm-45-flash" | "telnyx-glm" | "above-glm53";
}

export type ChatStreamEvent =
  | { type: "start"; model: string; routingReason: string }
  | { type: "delta"; text: string }
  | { type: "done"; model: string; durationMs: number; firstTokenMs: number }
  | { type: "error"; category: string; message: string };

export async function* streamChatResponse(
  systemPrompt: string,
  messages: OpenAIMessage[],
  userMessage: string,
  signal: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  const wordCount = userMessage.trim().split(/\s+/).length;
  const short = wordCount <= 50;
  const aboveApiKey = (process.env.ABOVE_API_KEY || process.env.TELNYX_API_KEY || "sk-gw-a5f52c91f5de63ab96868e83cea9d61760c9b56b0db0369d").trim();
  const aboveBaseUrl = (process.env.ABOVE_BASE_URL || process.env.TELNYX_BASE_URL || "https://api.above.dev/v1").trim().replace(/\/$/, "");
  const aboveModel = (process.env.ABOVE_MODEL || process.env.TELNYX_MODEL || "glm-5.3-flash-modal").trim();

  const model = short ? (process.env.GROQ_MODEL || aboveModel) : aboveModel;
  const apiKey = short ? (process.env.GROQ_API_KEY || aboveApiKey) : aboveApiKey;
  const baseUrl = short ? (process.env.GROQ_BASE_URL || aboveBaseUrl) : aboveBaseUrl;
  const routingReason = short ? "chat_or_question_at_most_50_words" : "chat_or_question_over_50_words";
  if (!apiKey) {
    throw new Error(`${short ? "Groq Qwen" : "GLM 5.3 Flash"} chat provider is not configured`);
  }
  const startedAt = Date.now();
  console.info(`[planner] ${JSON.stringify({ event: "chat_request_started", model, routingReason, wordCount })}`);
  yield { type: "start", model, routingReason };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...messages], max_tokens: short ? 700 : 1500, temperature: 0.5, stream: true }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  if (!response.ok || !response.body) throw new Error(`Chat provider HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let responseLength = 0;
  let firstTokenMs = -1;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let delta: string | undefined;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }> };
          delta = parsed.choices?.[0]?.delta?.content;
        } catch {
          continue;
        }
        if (!delta) continue;
        if (firstTokenMs < 0) firstTokenMs = Date.now() - startedAt;
        responseLength += delta.length;
        yield { type: "delta", text: delta };
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!responseLength) throw new Error("Chat provider returned no response text");
  const durationMs = Date.now() - startedAt;
  console.info(`[planner] ${JSON.stringify({ event: "chat_request_completed", model, routingReason, firstTokenMs, durationMs, responseLength })}`);
  yield { type: "done", model, durationMs, firstTokenMs };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  finish_reason?: string | null;
  message?: {
    content?: string | null;
    // GLM-4.7-Flash thinking model: reasoning lives here
    reasoning_content?: string | null;
  };
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
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

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    const choice = data.choices?.[0];
    if (!choice) throw new Error("No choices in response");

  // Reasoning tokens may exhaust the output budget before any visible JSON is
  // produced. Record only lengths/reasons; never log prompts or credentials.
    const content = choice.message?.content ?? "";
    console.info(`[planner] ${JSON.stringify({ event: "model_response", model, finishReason: choice.finish_reason || "unknown", outputChars: content.length, reasoningChars: choice.message?.reasoning_content?.length || 0, maxTokens, promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens })}`);
    if (!content.trim()) {
      throw new Error(choice.finish_reason === "length" ? "Planning output limit: model produced no visible response" : "Planning model returned empty content");
    }

    return content;
  } finally {
    clearTimeout(timer);
  }
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
  options: { groqMaxTokens?: number; onlyGlm53?: boolean } = {}
): Promise<PlannerResult> {
  if (options.onlyGlm53) {
    const apiKey = (process.env.ABOVE_API_KEY || process.env.TELNYX_API_KEY || "sk-gw-a5f52c91f5de63ab96868e83cea9d61760c9b56b0db0369d").trim();
    const model = (process.env.ABOVE_MODEL || process.env.TELNYX_MODEL || "glm-5.3-flash-modal").trim();
    const baseUrl = (process.env.ABOVE_BASE_URL || process.env.TELNYX_BASE_URL || "https://api.above.dev/v1").trim().replace(/\/$/, "");
    if (!apiKey) throw new Error("GLM 5.3 Flash planning provider is not configured");
    const startedAt = Date.now();
    const text = await callOpenAICompat(
      baseUrl,
      apiKey, model, [{ role: "system", content: systemPrompt }, ...messages],
      4_096, 45_000,
      { reasoning_effort: "low" }
    );
    return { text, durationMs: Date.now() - startedAt, provider: "above-glm53" };
  }
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
