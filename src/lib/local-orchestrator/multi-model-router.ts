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
  providerId: string;
}

export type StatusCallback = (statusMessage: string) => void;

export interface RouterCompletionOptions {
  /** Maximum network time for one provider attempt. */
  perProviderTimeoutMs?: number;
  /** Maximum wall-clock time across queueing and all provider attempts. */
  totalTimeoutMs?: number;
  /** Move a provider to the end after it produced an unusable response. */
  deprioritizeProviderId?: string;
  /** Lower response budget for short conversational requests. */
  maxTokens?: number;
}

class MultiModelRouter {
  // Provider-level concurrency locks (mutex) to avoid concurrent calls on single free keys
  private providerQueues: Map<string, Promise<void>> = new Map();

  private enqueue<T>(
    providerId: string,
    task: () => Promise<T>,
    maxQueueWaitMs?: number
  ): Promise<T> {
    const prev = this.providerQueues.get(providerId) || Promise.resolve();

    let cancelled = false;
    let queueTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveResult!: (result: T) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    if (maxQueueWaitMs !== undefined) {
      queueTimer = setTimeout(() => {
        cancelled = true;
        rejectResult(new Error("Provider queue wait exceeded the completion deadline"));
      }, Math.max(1, maxQueueWaitMs));
    }

    const next = prev
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        if (queueTimer) clearTimeout(queueTimer);
        try {
          resolveResult(await task());
        } catch (error) {
          rejectResult(error);
        }
      });
    this.providerQueues.set(providerId, next);
    return result;
  }

  public getProviders(): ModelProviderConfig[] {
    const providers: ModelProviderConfig[] = [];

    // Prefer the newer account/model. In real generation tests it completed a
    // complex design prompt while the older flash endpoint timed out.
    const zhipuKey2 = process.env.GLM_API_KEY_2 || "";
    if (zhipuKey2) {
      const model = process.env.GLM_MODEL_2 || "glm-4.7-flash";
      providers.push({
        id: "zhipu-acc-2",
        name: `Zhipu AI (${model} / Acc 2)`,
        baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        apiKey: zhipuKey2,
        model,
        maxTokens: parseInt(process.env.GLM_MAX_TOKENS || "16384", 10),
        isZhipu: true,
      });
    }

    // Fallback Zhipu account/model.
    const zhipuKey1 = process.env.GLM_API_KEY || "";
    if (zhipuKey1) {
      const model = process.env.GLM_MODEL || "glm-4.7-flash";
      providers.push({
        id: "zhipu-acc-1",
        name: `Zhipu AI (${model} / Acc 1)`,
        baseUrl: process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
        apiKey: zhipuKey1,
        model,
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
    onStatus?: StatusCallback,
    options: RouterCompletionOptions = {}
  ): Promise<RouterCompletionResult> {
    const configuredProviders = this.getProviders();

    if (configuredProviders.length === 0) {
      throw new Error(
        "No AI API keys configured. Please configure GLM_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY."
      );
    }

    const providers = options.deprioritizeProviderId
      ? [
          ...configuredProviders.filter((provider) => provider.id !== options.deprioritizeProviderId),
          ...configuredProviders.filter((provider) => provider.id === options.deprioritizeProviderId),
        ]
      : configuredProviders;
    const errors: string[] = [];
    const startedAt = Date.now();
    const totalTimeoutMs = options.totalTimeoutMs;
    const perProviderTimeoutMs = options.perProviderTimeoutMs ?? 120_000;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const isLast = i === providers.length - 1;
      const remainingTotalMs = totalTimeoutMs === undefined
        ? undefined
        : totalTimeoutMs - (Date.now() - startedAt);

      if (remainingTotalMs !== undefined && remainingTotalMs <= 0) {
        errors.push(`Completion deadline exceeded after ${totalTimeoutMs}ms`);
        break;
      }

      console.log(`[MultiModelRouter] Attempting provider [${provider.name}] (${provider.model})...`);
      let attemptTimeoutMs = perProviderTimeoutMs;

      try {
        const payload: Record<string, any> = {
          model: provider.model,
          messages,
          temperature: 0.2,
          max_tokens: Math.min(provider.maxTokens, options.maxTokens ?? provider.maxTokens),
        };

        if (provider.isZhipu) {
          payload.thinking = { type: "disabled" };
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
          ...(provider.extraHeaders || {}),
        };

        const res: Response = await this.enqueue(provider.id, () => {
          const remainingAtStartMs = totalTimeoutMs === undefined
            ? undefined
            : totalTimeoutMs - (Date.now() - startedAt);
          if (remainingAtStartMs !== undefined && remainingAtStartMs <= 0) {
            throw new Error(`Completion deadline exceeded after ${totalTimeoutMs}ms`);
          }
          attemptTimeoutMs = Math.max(
            1,
            Math.min(perProviderTimeoutMs, remainingAtStartMs ?? perProviderTimeoutMs)
          );
          return fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(attemptTimeoutMs),
          });
        }, remainingTotalMs);

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
            providerId: provider.id,
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
        const errorMessage = err?.name === "TimeoutError"
          ? `request timed out after ${attemptTimeoutMs}ms`
          : err?.message || String(err);
        const netErr = `Provider [${provider.name}] exception: ${errorMessage}`;
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
