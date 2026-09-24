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
  provider: "glm-47-flash" | "groq" | "gemini-flash" | "glm-45-flash" | "telnyx-glm";
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

  let model: string;
  let apiKey: string | undefined;
  let baseUrl: string;
  let routingReason: string;

  if (process.env.GROQ_API_KEY) {
    model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
    apiKey = process.env.GROQ_API_KEY;
    baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    routingReason = "groq_fast_chat";
  } else if (process.env.GEMINI_API_KEY) {
    model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    apiKey = process.env.GEMINI_API_KEY;
    baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
    routingReason = "gemini_fast_chat";
  } else if (process.env.TELNYX_API_KEY) {
    model = process.env.TELNYX_MODEL || "zai-org/GLM-5.3-Flash";
    apiKey = process.env.TELNYX_API_KEY;
    baseUrl = process.env.TELNYX_BASE_URL || "https://api.telnyx.com/v2/ai/openai";
    routingReason = "telnyx_chat";
  } else {
    throw new Error("Chat provider is not configured. Please set GEMINI_API_KEY or GROQ_API_KEY.");
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
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqBaseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
  const groqModel = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  const groqMaxTokens = Math.min(
    950,
    Math.max(256, parseInt(process.env.GROQ_MAX_TOKENS || "950", 10) || 950)
  );

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiBaseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const geminiMaxTokens = Math.min(
    2_048,
    Math.max(512, parseInt(process.env.GEMINI_MAX_TOKENS || "2048", 10) || 2_048)
  );

  const glmApiKey = process.env.GLM_API_KEY;
  const glmBaseUrl = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4";
  const glmModel = process.env.GLM_MODEL || "GLM-4.7-Flash";

  const telnyxApiKey = process.env.TELNYX_API_KEY;
  const telnyxBaseUrl = process.env.TELNYX_BASE_URL || "https://api.telnyx.com/v2/ai/openai";
  const telnyxModel = process.env.TELNYX_MODEL || "zai-org/GLM-5.3-Flash";

  const fullMessages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // If specific Telnyx preference was requested and Telnyx is configured, try it with a 10s timeout
  if (options.onlyGlm53 && telnyxApiKey && /GLM-5\.3-Flash/i.test(telnyxModel)) {
    try {
      const startedAt = Date.now();
      const text = await callOpenAICompat(
        telnyxBaseUrl,
        telnyxApiKey,
        telnyxModel,
        fullMessages,
        4_096,
        10_000
      );
      return { text, durationMs: Date.now() - startedAt, provider: "telnyx-glm" };
    } catch (err) {
      console.warn("[planner] Telnyx GLM-5.3 failed or timed out; falling back to fast providers:", (err as Error).message);
    }
  }

  // 1. Try Groq (ultra fast, ~300ms)
  if (groqApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        groqBaseUrl,
        groqApiKey,
        groqModel,
        fullMessages,
        Math.min(groqMaxTokens, options.groqMaxTokens ?? groqMaxTokens),
        10_000
      );
      return { text, durationMs: Date.now() - start, provider: "groq" };
    } catch (err) {
      console.warn("[planner] Groq provider failed; trying next provider:", (err as Error).message);
    }
  }

  // 2. Try Gemini (fast, ~800ms)
  if (geminiApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        geminiBaseUrl,
        geminiApiKey,
        geminiModel,
        fullMessages,
        geminiMaxTokens,
        12_000,
        { reasoning_effort: "none" }
      );
      return { text, durationMs: Date.now() - start, provider: "gemini-flash" };
    } catch (err) {
      console.warn("[planner] Gemini provider failed; trying next provider:", (err as Error).message);
    }
  }

  // 3. Try GLM-4.7-Flash
  if (glmApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        glmBaseUrl,
        glmApiKey,
        glmModel,
        fullMessages,
        1_500,
        12_000
      );
      return { text, durationMs: Date.now() - start, provider: "glm-47-flash" };
    } catch (err) {
      console.warn("[planner] GLM provider failed; trying next provider:", (err as Error).message);
    }
  }

  // 4. Try Telnyx GLM (if not tried above)
  if (telnyxApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(
        telnyxBaseUrl,
        telnyxApiKey,
        telnyxModel,
        fullMessages,
        2_048,
        12_000
      );
      return { text, durationMs: Date.now() - start, provider: "telnyx-glm" };
    } catch (err) {
      console.warn("[planner] Telnyx provider failed:", (err as Error).message);
    }
  }

  // 5. Try glm-4.5-flash fallback
  if (glmApiKey) {
    try {
      const start = Date.now();
      const text = await callOpenAICompat(glmBaseUrl, glmApiKey, "glm-4.5-flash", fullMessages, 1_024, 10_000);
      return { text, durationMs: Date.now() - start, provider: "glm-45-flash" };
    } catch (err) {
      console.warn("[planner] Final interaction provider failed:", (err as Error).message);
    }
  }

  throw new Error(
    "All planner providers failed. Configure at least one supported interaction provider (GEMINI_API_KEY, GROQ_API_KEY, or TELNYX_API_KEY)."
  );
}
