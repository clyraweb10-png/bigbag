export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
  isZhipu?: boolean;
}

export interface RouterCompletionResult {
  text: string;
  usedModel: string;
  providerName: string;
}

export type StatusCallback = (statusMessage: string) => void;

class MultiModelRouter {
  // Provider-level concurrency locks (mutex) to avoid concurrent calls on single free keys
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

    // 1. Zhipu Account 1 (GLM-4.5-Flash: Rock solid, high stability)
    const zhipuKey1 = process.env.GLM_API_KEY || "";
    if (zhipuKey1) {
      providers.push({
        id: "zhipu-acc-1",
        name: "Zhipu AI (GLM-4.5-Flash)",
        baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        apiKey: zhipuKey1,
        model: process.env.GLM_MODEL || "glm-4.5-flash",
        maxTokens: parseInt(process.env.GLM_MAX_TOKENS || "16384", 10),
        isZhipu: true,
      });
    }

    // 2. Zhipu Account 2 (GLM-4.7-Flash: Fast reasoning tier)
    const zhipuKey2 = process.env.GLM_API_KEY_2 || "";
    if (zhipuKey2) {
      providers.push({
        id: "zhipu-acc-2",
        name: "Zhipu AI (GLM-4.7-Flash / Acc 2)",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: zhipuKey2,
        model: "glm-4.7-flash",
        maxTokens: parseInt(process.env.GLM_MAX_TOKENS || "16384", 10),
        isZhipu: true,
      });
    }

    // 3. Groq Cloud (Qwen 3.8-27B: 300+ tokens/sec hyper-speed)
    const groqKey = process.env.GROQ_API_KEY || "";
    if (groqKey) {
      providers.push({
        id: "groq-qwen",
        name: "Groq Cloud (Qwen 3.8-27B)",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
        model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
        maxTokens: 8192,
      });
    }

    // 4. OpenRouter (inclusionai/ling-3.0-flash-vl:free)
    const openRouterKey = process.env.OPENROUTER_API_KEY || "";
    if (openRouterKey) {
      providers.push({
        id: "openrouter-ling",
        name: "OpenRouter (Ling 3.0 Flash VL)",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: openRouterKey,
        model: process.env.OPENROUTER_MODEL || "inclusionai/ling-3.0-flash-vl:free",
        maxTokens: 8192,
        extraHeaders: {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "BigBag AI App Builder",
        },
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
        "No AI API keys configured. Please configure GLM_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY."
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

        if (provider.isZhipu) {
          payload.thinking = { type: "disabled" };
        }

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
          })
        );

        if (res.ok) {
          const json = await res.json();
          const text = json.choices?.[0]?.message?.content || "";
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

          if (code === "1305" || msg.includes("访问量过大") || res.status === 503) {
            isTrafficSpike = true;
            errMsg = `Traffic spike on ${provider.model} (1305: 该模型当前访问量过大)`;
          } else if (code === "1302" || res.status === 429) {
            isRateLimit = true;
            errMsg = `Rate limit reached on ${provider.model} (429/1302)`;
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
            ? "traffic spike"
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
