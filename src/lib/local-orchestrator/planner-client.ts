/**
 * Server-only GLM 5.3 Flash client for chat, planning, and plan refinement.
 *
 * ⚠️ SERVER ONLY — reads API keys from env; never import from a client component.
 */
import "server-only";
import { GLM_53_PROVIDER_ID, glm53Config } from "./ai-provider-config";
import { providerChatDeltas } from "./provider-chat-stream";

export interface PlannerResult {
  text: string;
  durationMs: number;
  provider: typeof GLM_53_PROVIDER_ID;
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

  const config = glm53Config();
  if (!config) throw new Error("GLM 5.3 Flash is not configured. Set ABOVE_API_KEY on the server.");
  const { model, apiKey, baseUrl } = config;
  const routingReason = "glm53_chat";
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
  let responseLength = 0;
  let firstTokenMs = -1;
  for await (const delta of providerChatDeltas(response)) {
    if (firstTokenMs < 0) firstTokenMs = Date.now() - startedAt;
    responseLength += delta.length;
    yield { type: "delta", text: delta };
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
    // Some GLM-compatible responses place reasoning in this separate field.
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
      throw new Error(`Provider returned HTTP ${res.status}`);
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
    if (choice.finish_reason === "length") {
      throw new Error("Planning output limit: model response was incomplete");
    }

    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Generate a concise plan or refinement with the same GLM 5.3 Flash model as code generation. */
export async function callPlanner(
  systemPrompt: string,
  messages: OpenAIMessage[],
  options: { groqMaxTokens?: number; onlyGlm53?: boolean } = {}
): Promise<PlannerResult> {
  const config = glm53Config();
  if (!config) throw new Error("GLM 5.3 Flash is not configured. Set ABOVE_API_KEY on the server.");
  const startedAt = Date.now();
  const text = await callOpenAICompat(
    config.baseUrl,
    config.apiKey,
    config.model,
    [{ role: "system", content: systemPrompt }, ...messages],
    options.onlyGlm53 ? 4_096 : Math.min(2_048, Math.max(512, options.groqMaxTokens ?? 2_048)),
    45_000
  );
  return { text, durationMs: Date.now() - startedAt, provider: GLM_53_PROVIDER_ID };
}
