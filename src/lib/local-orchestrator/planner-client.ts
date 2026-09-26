/**
 * Planner client — all planning, chat, and refinement handled by Above.dev GLM-5.3-Flash.
 *
 * ⚠️ SERVER ONLY — reads API keys from env; never import from a client component.
 */
import "server-only";

export interface PlannerResult {
  text: string;
  durationMs: number;
  provider: "above-glm53";
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
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
  timeoutMs = 30_000,
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

  const content = choice.message?.content ?? "";
  if (!content.trim()) throw new Error("Empty content in response");

  return content;
}

/**
 * Call the planner using Above.dev GLM-5.3-Flash.
 */
export async function callPlanner(
  systemPrompt: string,
  messages: OpenAIMessage[],
  _options: { groqMaxTokens?: number } = {}
): Promise<PlannerResult> {
  const apiKey = (process.env.ABOVE_API_KEY || process.env.TELNYX_API_KEY || "").trim();
  const baseUrl = (process.env.ABOVE_BASE_URL || process.env.TELNYX_BASE_URL || "https://api.above.dev/v1").trim().replace(/\/$/, "");
  const model = (process.env.ABOVE_MODEL || "glm-5.3-flash-modal").trim();
  const maxTokens = Math.min(
    4_096,
    Math.max(512, parseInt(process.env.ABOVE_MAX_TOKENS || "2048", 10) || 2_048)
  );

  if (!apiKey) {
    throw new Error("No AI API key configured. Set ABOVE_API_KEY in your environment.");
  }

  const fullMessages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const start = Date.now();
  const text = await callOpenAICompat(
    baseUrl,
    apiKey,
    model,
    fullMessages,
    maxTokens,
    30_000,
    { reasoning_effort: "low" }
  );
  return { text, durationMs: Date.now() - start, provider: "above-glm53" };
}
