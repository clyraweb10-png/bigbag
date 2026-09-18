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
  providerId: string;
}

export type StatusCallback = (statusMessage: string) => void;

export interface RouterCompletionOptions {
  perProviderTimeoutMs?: number;
  totalTimeoutMs?: number;
  deprioritizeProviderId?: string;
  maxTokens?: number;
}

/** How many times to retry a single provider on transient errors (503, 429, timeout). */
const MAX_RETRIES = 2;
/** Delay in ms between retries. */
const RETRY_DELAY_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MultiModelRouter {
  // Provider-level concurrency locks (mutex) to avoid concurrent calls on single keys
  private providerQueues: Map<string, Promise<void>> = new Map();

  private enqueue<T>(
    providerId: string,
    task: () => Promise<T>,
    maxQueueWaitMs?: number
  ): Promise<T> {
    const prev = this.providerQueues.get(providerId) || Promise.resolve();
    let cancelled = false;
    let queueTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
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

    // 1. Telnyx AI (zai-org/GLM-5.3-Flash) — Primary Model (most reliable)
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

    // 2. Google Gemini (gemini-2.5-flash) — Fallback (occasionally returns 503)
    const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    if (geminiKey) {
      let geminiBase = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").trim();
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

    return providers;
  }

  /**
   * Try a single provider with automatic retries on transient errors
   * (503, 429, network timeouts). Returns the result or throws.
   */
  private async tryProvider(
    provider: ModelProviderConfig,
    messages: Array<{ role: string; content: string }>,
    onStatus: StatusCallback | undefined,
    options: {
      deadlineAt?: number;
      perProviderTimeoutMs: number;
      maxTokens?: number;
    }
  ): Promise<RouterCompletionResult> {
    const configuredMaxTokens = Number.isFinite(provider.maxTokens) && provider.maxTokens > 0
      ? provider.maxTokens
      : 16_384;
    const payload: Record<string, any> = {
      model: provider.model,
      messages,
      temperature: 0.2,
      max_tokens: Math.min(configuredMaxTokens, options.maxTokens ?? configuredMaxTokens),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {}),
    };

    let lastError = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let remainingMs = options.deadlineAt === undefined
        ? undefined
        : options.deadlineAt - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new Error("completion deadline exceeded");
      }

      if (attempt > 0) {
        const retryMsg = `🔄 Retrying ${provider.name} (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`;
        console.log(`[MultiModelRouter] ${retryMsg}`);
        onStatus?.(retryMsg);
        await sleep(RETRY_DELAY_MS);
        remainingMs = options.deadlineAt === undefined
          ? undefined
          : options.deadlineAt - Date.now();
        if (remainingMs !== undefined && remainingMs <= 0) {
          throw new Error("completion deadline exceeded");
        }
      }

      try {
        const res: Response = await this.enqueue(provider.id, () => {
          const remainingAtFetchMs = options.deadlineAt === undefined
            ? undefined
            : options.deadlineAt - Date.now();
          if (remainingAtFetchMs !== undefined && remainingAtFetchMs <= 0) {
            throw new Error("completion deadline exceeded");
          }
          const attemptTimeoutMs = Math.max(
            1,
            Math.min(
              options.perProviderTimeoutMs,
              remainingAtFetchMs ?? options.perProviderTimeoutMs
            )
          );
          return fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(attemptTimeoutMs),
          });
        }, remainingMs);

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
            providerId: provider.id,
          };
        }

        // Parse the error
        const rawErr = await res.text();
        let errMsg = rawErr;
        let isRetryable = false;

        try {
          const parsed = JSON.parse(rawErr);
          const code = String(parsed.error?.code || "");

          if (res.status === 503 || code === "1305") {
            isRetryable = true;
            errMsg = `Service unavailable/busy on ${provider.model} (503)`;
          } else if (res.status === 429 || code === "1302") {
            isRetryable = true;
            errMsg = `Rate limit reached on ${provider.model} (429)`;
          } else if (parsed.error?.message) {
            errMsg = parsed.error.message;
          }
        } catch {}

        lastError = `HTTP ${res.status}: ${errMsg}`;
        console.warn(`[MultiModelRouter] Provider [${provider.name}] ${lastError}`);

        // If NOT retryable (e.g. 401, 400), don't waste time retrying
        if (!isRetryable) break;

      } catch (err: any) {
        const isTimeout = err.name === "TimeoutError" || err.message?.includes("aborted") || err.message?.includes("timeout");
        lastError = `exception: ${err.message || String(err)}`;
        console.warn(`[MultiModelRouter] Provider [${provider.name}] ${lastError}`);

        // A timed-out model already consumed the provider budget; fail over now.
        if (isTimeout || !err.message?.includes("fetch")) break;
      }
    }

    throw new Error(`Provider [${provider.name}] ${lastError}`);
  }

  public async complete(
    messages: Array<{ role: string; content: string }>,
    onStatus?: StatusCallback,
    options: RouterCompletionOptions = {}
  ): Promise<RouterCompletionResult> {
    const configuredProviders = this.getProviders();

    if (configuredProviders.length === 0) {
      throw new Error(
        "No AI API keys configured. Please configure GEMINI_API_KEY or TELNYX_API_KEY."
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
    const deadlineAt = options.totalTimeoutMs === undefined
      ? undefined
      : startedAt + options.totalTimeoutMs;
    const perProviderTimeoutMs = options.perProviderTimeoutMs ?? 120_000;

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const isLast = i === providers.length - 1;

      console.log(`[MultiModelRouter] Attempting provider [${provider.name}] (${provider.model})...`);
      onStatus?.(`Generating with ${provider.name}...`);

      try {
        return await this.tryProvider(provider, messages, onStatus, {
          deadlineAt,
          perProviderTimeoutMs,
          maxTokens: options.maxTokens,
        });
      } catch (err: any) {
        const errMsg = err.message || String(err);
        errors.push(errMsg);

        if (!isLast) {
          const nextProvider = providers[i + 1];
          const failoverMsg = `⚡ Switching to ${nextProvider.name} after ${provider.name} failed...`;
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
