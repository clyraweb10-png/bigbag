export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}

export interface RouterCompletionResult {
  text: string;
  usedModel: string;
  providerName: string;
}

export type StatusCallback = (statusMessage: string) => void;

class MultiModelRouter {
  // Provider-level concurrency locks (mutex) to avoid concurrent calls on single keys
  private providerQueues: Map<string, Promise<void>> = new Map();

  private enqueue(providerId: string, task: () => Promise<any>): Promise<any> {
    const prev = this.providerQueues.get(providerId) || Promise.resolve();
    let res: any;
    const next = prev
      .catch(() => {})
      .then(async () => {
        res = await task();
      });
    this.providerQueues.set(providerId, next);
    return next.then(() => res);
  }

  public getProviders(): ModelProviderConfig[] {
    const providers: ModelProviderConfig[] = [];

    // 1. Google Gemini (gemini-2.5-flash) - Primary Model
    const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    if (geminiKey) {
      let geminiBase = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").trim();
      // Normalize Google endpoint to OpenAI-compatible base URL if needed
      if (geminiBase.includes("generativelanguage.googleapis.com") && !geminiBase.includes("/openai")) {
        geminiBase = "https://generativelanguage.googleapis.com/v1beta/openai";
      }

      providers.push({
        id: "gemini-flash",
        name: "Google Gemini (gemini-2.5-flash)",
        baseUrl: geminiBase,
        apiKey: geminiKey,
        model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
        maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS || "16384", 10),
      });
    }

    // 2. Telnyx AI / Custom OpenAI (zai-org/GLM-5.3-Flash) - Secondary / Fallback Model
    const telnyxKey = (process.env.TELNYX_API_KEY || process.env.CUSTOM_OPENAI_API_KEY || "").trim();
    if (telnyxKey) {
      providers.push({
        id: "telnyx-glm",
        name: "Telnyx AI (zai-org/GLM-5.3-Flash)",
        baseUrl: (process.env.TELNYX_BASE_URL || process.env.CUSTOM_OPENAI_BASE_URL || "https://api.telnyx.com/v2/ai/openai").trim(),
        apiKey: telnyxKey,
        model: (process.env.TELNYX_MODEL || process.env.CUSTOM_OPENAI_MODEL || "zai-org/GLM-5.3-Flash").trim(),
        maxTokens: parseInt(process.env.TELNYX_MAX_TOKENS || "32768", 10),
      });
    }

    return providers;
  }

  public async complete(
    messages: Array<{ role: string; content: string }>,
    onStatus?: StatusCallback
  ): Promise<RouterCompletionResult> {
    const providers = this.getProviders();

    if (providers.length === 0) {
      throw new Error(
        "No AI API keys configured. Please configure GEMINI_API_KEY or TELNYX_API_KEY."
      );
    }

    const errors: string[] = [];

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const isLast = i === providers.length - 1;

      console.log(`[MultiModelRouter] Attempting provider [${provider.name}] (${provider.model})...`);

      try {
        const payload: Record<string, any> = {
          model: provider.model,
          messages,
          temperature: 0.2,
          max_tokens: provider.maxTokens,
        };

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
          ...(provider.extraHeaders || {}),
        };

        const res: Response = await this.enqueue(provider.id, () =>
          fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(180_000),
          })
        );

        if (res.ok) {
          const json = await res.json();
          const choice = json.choices?.[0];
          const text = choice?.message?.content || choice?.message?.reasoning_content || "";
          if (!text || text.trim().length === 0) {
            throw new Error("Received empty response body from provider");
          }

          console.log(`[MultiModelRouter] Provider [${provider.name}] succeeded! Generated ${text.length} chars.`);
          return {
            text,
            usedModel: provider.model,
            providerName: provider.name,
          };
        }

        // Handle error responses
        const rawErr = await res.text();
        let errMsg = rawErr;
        let isTrafficSpike = false;
        let isRateLimit = false;

        try {
          const parsed = JSON.parse(rawErr);
          const code = String(parsed.error?.code || "");
          const msg = String(parsed.error?.message || "");

          if (code === "1305" || res.status === 503) {
            isTrafficSpike = true;
            errMsg = `Service unavailable/busy on ${provider.model} (503)`;
          } else if (code === "1302" || res.status === 429) {
            isRateLimit = true;
            errMsg = `Rate limit reached on ${provider.model} (429)`;
          } else if (parsed.error?.message) {
            errMsg = parsed.error.message;
          }
        } catch {}

        const errSummary = `Provider [${provider.name}] HTTP ${res.status}: ${errMsg}`;
        console.warn(`[MultiModelRouter] ${errSummary}`);
        errors.push(errSummary);

        if (!isLast) {
          const nextProvider = providers[i + 1];
          const reason = isTrafficSpike
            ? "traffic spike / busy"
            : isRateLimit
            ? "rate limit"
            : "busy server";

          const failoverMsg = `⚡ Switched from ${provider.name} (${reason}) to ${nextProvider.name}...`;
          console.log(`[MultiModelRouter] ${failoverMsg}`);
          onStatus?.(failoverMsg);
        }
      } catch (err: any) {
        const netErr = `Provider [${provider.name}] exception: ${err.message || String(err)}`;
        console.warn(`[MultiModelRouter] ${netErr}`);
        errors.push(netErr);

        if (!isLast) {
          const nextProvider = providers[i + 1];
          const failoverMsg = `⚡ Network retry: connecting to ${nextProvider.name}...`;
          console.log(`[MultiModelRouter] ${failoverMsg}`);
          onStatus?.(failoverMsg);
        }
      }
    }

    throw new Error(
      `All configured AI providers failed:\n` + errors.map((e) => `• ${e}`).join("\n")
    );
  }
}

export const multiModelRouter = new MultiModelRouter();
