export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Additional attempts after the first request for transient failures. */
  maxRetries: number;
  reasoningEffort?: "low" | "high" | "max";
  extraHeaders?: Record<string, string>;
}

export interface RouterCompletionResult {
  text: string;
  usedModel: string;
  /** Privacy-safe label intended for customer-visible status and completion copy. */
  publicModelName: string;
  providerName: string;
  providerId: string;
}

export type StatusCallback = (statusMessage: string) => void;

export interface RouterCompletionOptions {
  perProviderTimeoutMs?: number;
  totalTimeoutMs?: number;
  deprioritizeProviderId?: string;
  maxTokens?: number;
  /** Test/embedding override; production uses the bounded default backoff. */
  retryDelayMs?: number;
}

/** Product policy: Gemini gets five recovery attempts before provider failover. */
export const GEMINI_MAX_RETRIES = 5;
/** Maximum number of follow-up requests used to finish a token-limited response. */
export const MAX_OUTPUT_CONTINUATIONS = 4;
const DEFAULT_MAX_RETRIES = 2;
/** Delay in ms between retries. */
const RETRY_DELAY_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function completionText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { type?: unknown; text?: unknown };
      return (record.type === undefined || record.type === "text") && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}

export function publicModelName(providerId: string): string {
  if (providerId === "gemini-flash") return "Model A";
  if (providerId === "telnyx-glm") return "Model B";
  return "AI model";
}

/**
 * Join a continuation without duplicating a repeated tail. Some OpenAI-compatible
 * providers repeat the last few tokens even when explicitly asked not to.
 */
export function appendContinuationChunk(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  if (next.startsWith(current)) return next;

  const maxOverlap = Math.min(4_096, current.length, next.length);
  for (let overlap = maxOverlap; overlap >= 16; overlap -= 1) {
    if (current.endsWith(next.slice(0, overlap))) {
      return current + next.slice(overlap);
    }
  }
  return current + next;
}

export class ProviderExhaustedError extends Error {
  constructor() {
    super("The generation models could not complete the response after automatic retries and continuation attempts.");
    this.name = "ProviderExhaustedError";
  }
}

class RetryableProviderError extends Error {}
class FinalProviderError extends Error {}

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

    // 1. Google Gemini — primary by product policy.
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
        maxRetries: GEMINI_MAX_RETRIES,
      });
    }

    // 2. Telnyx GLM-5.3-Flash — fallback when Gemini is unavailable.
    const telnyxKey = (process.env.TELNYX_API_KEY || process.env.CUSTOM_OPENAI_API_KEY || "").trim();
    if (telnyxKey) {
      const telnyxModel = (process.env.TELNYX_MODEL || process.env.CUSTOM_OPENAI_MODEL || "zai-org/GLM-5.3-Flash").trim();
      providers.push({
        id: "telnyx-glm",
        name: "Telnyx AI (zai-org/GLM-5.3-Flash)",
        baseUrl: (process.env.TELNYX_BASE_URL || process.env.CUSTOM_OPENAI_BASE_URL || "https://api.telnyx.com/v2/ai/openai").trim(),
        apiKey: telnyxKey,
        model: telnyxModel,
        maxTokens: parseInt(process.env.TELNYX_MAX_TOKENS || "16384", 10),
        maxRetries: DEFAULT_MAX_RETRIES,
        reasoningEffort: /(?:^|\/)glm-5\.3(?:-|$)/i.test(telnyxModel) ? "low" : undefined,
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
      retryDelayMs: number;
    }
  ): Promise<RouterCompletionResult> {
    const configuredMaxTokens = Number.isFinite(provider.maxTokens) && provider.maxTokens > 0
      ? provider.maxTokens
      : 16_384;
    const maxTokens = Math.min(configuredMaxTokens, options.maxTokens ?? configuredMaxTokens);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {}),
    };

    let lastError = "";

    for (let attempt = 0; attempt <= provider.maxRetries; attempt++) {
      let remainingMs = options.deadlineAt === undefined
        ? undefined
        : options.deadlineAt - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new Error("completion deadline exceeded");
      }

      if (attempt > 0) {
        const retryMsg = `Retrying ${publicModelName(provider.id)} (attempt ${attempt + 1}/${provider.maxRetries + 1})...`;
        console.log(`[MultiModelRouter] Retrying ${provider.name} (attempt ${attempt + 1}/${provider.maxRetries + 1})...`);
        onStatus?.(retryMsg);
        await sleep(options.retryDelayMs);
        remainingMs = options.deadlineAt === undefined
          ? undefined
          : options.deadlineAt - Date.now();
        if (remainingMs !== undefined && remainingMs <= 0) {
          throw new Error("completion deadline exceeded");
        }
      }

      try {
        let accumulatedText = "";
        let requestMessages = messages;

        for (let continuation = 0; continuation <= MAX_OUTPUT_CONTINUATIONS; continuation += 1) {
          remainingMs = options.deadlineAt === undefined
            ? undefined
            : options.deadlineAt - Date.now();
          if (remainingMs !== undefined && remainingMs <= 0) {
            throw new FinalProviderError("completion deadline exceeded");
          }

          const payload: Record<string, any> = {
            model: provider.model,
            messages: requestMessages,
            temperature: 0.2,
            max_tokens: maxTokens,
          };
          if (provider.reasoningEffort) payload.reasoning_effort = provider.reasoningEffort;

          const res: Response = await this.enqueue(provider.id, () => {
            const remainingAtFetchMs = options.deadlineAt === undefined
              ? undefined
              : options.deadlineAt - Date.now();
            if (remainingAtFetchMs !== undefined && remainingAtFetchMs <= 0) {
              throw new FinalProviderError("completion deadline exceeded");
            }
            const attemptTimeoutMs = Math.max(
              1,
              Math.min(options.perProviderTimeoutMs, remainingAtFetchMs ?? options.perProviderTimeoutMs)
            );
            return fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(attemptTimeoutMs),
            });
          }, remainingMs);

          if (!res.ok) {
            const rawErr = await res.text();
            let errMsg = rawErr;
            // Upstreams and edge proxies sometimes return HTML/plain text for
            // overload responses. Status alone must preserve retry behavior even
            // when the body cannot be parsed as provider JSON.
            let isRetryable = res.status === 429 || res.status === 503;

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

            const message = `HTTP ${res.status}: ${errMsg}`;
            throw isRetryable
              ? new RetryableProviderError(message)
              : new FinalProviderError(message);
          }

          const json = await res.json();
          const choice = json.choices?.[0];
          const text = completionText(choice?.message?.content);
          if (!text || text.trim().length === 0) {
            const hasReasoning = completionText(choice?.message?.reasoning_content).trim().length > 0;
            throw new FinalProviderError(
              hasReasoning
                ? "Provider returned reasoning without a final answer"
                : "Received empty response body from provider"
            );
          }

          const previousAccumulatedText = accumulatedText;
          accumulatedText = appendContinuationChunk(accumulatedText, text);
          if (continuation > 0 && accumulatedText === previousAccumulatedText) {
            throw new RetryableProviderError("Continuation returned no new content");
          }
          const finishReason = typeof choice?.finish_reason === "string"
            ? choice.finish_reason.toLowerCase()
            : "";
          const wasTruncated = ["length", "max_tokens", "max_output_tokens"].includes(finishReason);

          if (!wasTruncated) {
            console.log(`[MultiModelRouter] Provider [${provider.name}] succeeded! Generated ${accumulatedText.length} chars.`);
            return {
              text: accumulatedText,
              usedModel: provider.model,
              publicModelName: publicModelName(provider.id),
              providerName: provider.name,
              providerId: provider.id,
            };
          }

          if (continuation === MAX_OUTPUT_CONTINUATIONS) {
            throw new FinalProviderError(
              `Provider output remained truncated after ${MAX_OUTPUT_CONTINUATIONS} continuation requests`
            );
          }

          const alias = publicModelName(provider.id);
          const continuationMsg = `${alias} reached an output boundary; continuing automatically...`;
          console.log(`[MultiModelRouter] ${provider.name} reached ${finishReason}; requesting continuation ${continuation + 1}/${MAX_OUTPUT_CONTINUATIONS}.`);
          onStatus?.(continuationMsg);
          requestMessages = [
            ...messages,
            { role: "assistant", content: accumulatedText },
            {
              role: "user",
              content: "Continue exactly where the previous response stopped. Return only the missing remainder. Do not repeat completed content. If the response stopped inside a fenced code block, continue the code directly without opening a new fence. Finish every remaining file block and the complete requested result.",
            },
          ];
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        const isTimeout = err?.name === "TimeoutError" || message.includes("aborted") || message.includes("timeout");
        const isNetworkFailure = message.includes("fetch");
        const isRetryable = err instanceof RetryableProviderError || isTimeout || isNetworkFailure;
        lastError = `exception: ${message}`;
        console.warn(`[MultiModelRouter] Provider [${provider.name}] ${lastError}`);

        if (!isRetryable) break;
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
      // Reserve a fair share of the remaining wall-clock budget for every
      // configured fallback. A slow primary must not consume the entire run and
      // make the fallback path unreachable.
      const providersRemaining = providers.length - i;
      const remainingTotalMs = deadlineAt === undefined ? undefined : deadlineAt - Date.now();
      const providerDeadlineAt = remainingTotalMs === undefined
        ? undefined
        : Date.now() + Math.max(1, Math.floor(remainingTotalMs / providersRemaining));

      console.log(`[MultiModelRouter] Attempting provider [${provider.name}] (${provider.model})...`);
      onStatus?.(`Generating with ${publicModelName(provider.id)}...`);

      try {
        return await this.tryProvider(provider, messages, onStatus, {
          deadlineAt: providerDeadlineAt,
          perProviderTimeoutMs,
          maxTokens: options.maxTokens,
          retryDelayMs: options.retryDelayMs ?? RETRY_DELAY_MS,
        });
      } catch (err: any) {
        const errMsg = err.message || String(err);
        errors.push(errMsg);

        if (!isLast) {
          const nextProvider = providers[i + 1];
          const failoverMsg = `Continuing with ${publicModelName(nextProvider.id)}...`;
          console.log(`[MultiModelRouter] Switching to ${nextProvider.name} after ${provider.name} failed.`);
          onStatus?.(failoverMsg);
        }
      }
    }

    console.warn(`[MultiModelRouter] All configured providers failed: ${errors.join(" | ")}`);
    throw new ProviderExhaustedError();
  }
}

export const multiModelRouter = new MultiModelRouter();
