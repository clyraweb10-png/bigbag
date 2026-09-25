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
  finishReason: string;
  responseSize: number;
  durationMs: number;
  attempts: number;
  continuationAttempts: number;
}

export type ProviderErrorCategory =
  | "cancelled"
  | "rate_limit"
  | "provider_unavailable"
  | "network_timeout"
  | "network_error"
  | "authentication"
  | "invalid_image"
  | "request_too_large"
  | "unsupported_multimodal"
  | "malformed_request"
  | "context_limit"
  | "invalid_model"
  | "invalid_response_schema"
  | "empty_response"
  | "output_limit"
  | "unknown";

export type StatusCallback = (statusMessage: string) => void;

export type ModelMessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
>;

export interface ModelMessage {
  role: string;
  content: ModelMessageContent;
}

export interface RouterCompletionOptions {
  signal?: AbortSignal;
  perProviderTimeoutMs?: number;
  totalTimeoutMs?: number;
  deprioritizeProviderId?: string;
  maxTokens?: number;
  /** Test/embedding override; production uses the bounded default backoff. */
  retryDelayMs?: number;
  /** Restrict a specialized request (for example vision analysis) to one provider. */
  onlyProviderId?: string;
  /** Structured requests must be retried with a smaller input, not continued as fragments. */
  maxOutputContinuations?: number;
  /** Request provider-side JSON mode when the OpenAI-compatible endpoint supports it. */
  responseFormat?: "json_object";
  /** Safe diagnostic label; never include user content or credentials. */
  requestLabel?: string;
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
  void providerId;
  return "AI";
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
  constructor(
    public readonly category: ProviderErrorCategory = "unknown",
    public readonly retryable = false,
    public readonly partialText = "",
    public readonly finishReason = "",
    public readonly attempts = 0,
    public readonly providerMessage = ""
  ) {
    super(`AI request failed (${category}).${providerMessage ? ` ${providerMessage}` : ""}`);
    this.name = "ProviderExhaustedError";
  }
}

class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly category: ProviderErrorCategory,
    public readonly retryable: boolean,
    public readonly partialText = "",
    public readonly finishReason = "",
    public readonly attempts = 0
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

function messageSize(messages: ModelMessage[]): { textChars: number; imageCount: number } {
  let textChars = 0;
  let imageCount = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      textChars += message.content.length;
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") textChars += part.text.length;
      else imageCount += 1;
    }
  }
  return { textChars, imageCount };
}

function safeProviderMessage(value: string): string {
  return value
    .replace(/(bearer|api[-_ ]?key|authorization)\s*[:=]?\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/https?:\/\/[^\s"']+/g, "[url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function classifyProviderFailure(status: number, message: string): {
  category: ProviderErrorCategory;
  retryable: boolean;
} {
  const normalized = message.toLowerCase();
  if (status === 429) return { category: "rate_limit", retryable: true };
  if (status >= 500) return { category: "provider_unavailable", retryable: true };
  if (status === 401 || status === 403) return { category: "authentication", retryable: false };
  if (/context(?: window| length| limit)|too many tokens|maximum context/.test(normalized)) {
    return { category: "context_limit", retryable: false };
  }
  if (/payload too large|request too large|entity too large|content length|413/.test(normalized) || status === 413) {
    return { category: "request_too_large", retryable: false };
  }
  if (/image/.test(normalized) && /invalid|format|decode|fetch|download|mime|content.type/.test(normalized)) {
    return { category: "invalid_image", retryable: false };
  }
  if (/image_url|multimodal|vision/.test(normalized) && /unsupported|not support|invalid|unknown/.test(normalized)) {
    return { category: "unsupported_multimodal", retryable: false };
  }
  if (/model/.test(normalized) && /not found|invalid|unknown|does not exist|unsupported/.test(normalized)) {
    return { category: "invalid_model", retryable: false };
  }
  if (status >= 400 && status < 500) return { category: "malformed_request", retryable: false };
  return { category: "unknown", retryable: false };
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

    // 2. Above.dev GLM-5.3-Flash
    const aboveKey = (process.env.ABOVE_API_KEY || process.env.TELNYX_API_KEY || process.env.CUSTOM_OPENAI_API_KEY || "sk-gw-a5f52c91f5de63ab96868e83cea9d61760c9b56b0db0369d").trim();
    if (aboveKey) {
      const aboveModel = (process.env.ABOVE_MODEL || process.env.TELNYX_MODEL || process.env.CUSTOM_OPENAI_MODEL || "glm-5.3-flash-modal").trim();
      const aboveBaseUrl = (process.env.ABOVE_BASE_URL || process.env.TELNYX_BASE_URL || process.env.CUSTOM_OPENAI_BASE_URL || "https://api.above.dev/v1").trim().replace(/\/$/, "");
      providers.push({
        id: "above-glm53",
        name: "Above.dev (GLM-5.3-Flash)",
        baseUrl: aboveBaseUrl,
        apiKey: aboveKey,
        model: aboveModel,
        maxTokens: parseInt(process.env.ABOVE_MAX_TOKENS || process.env.TELNYX_MAX_TOKENS || "8192", 10),
        maxRetries: DEFAULT_MAX_RETRIES,
        reasoningEffort: "low",
      });
      // Backwards-compatible alias for existing references
      providers.push({
        id: "telnyx-glm",
        name: "Above.dev (GLM-5.3-Flash)",
        baseUrl: aboveBaseUrl,
        apiKey: aboveKey,
        model: aboveModel,
        maxTokens: parseInt(process.env.ABOVE_MAX_TOKENS || process.env.TELNYX_MAX_TOKENS || "8192", 10),
        maxRetries: DEFAULT_MAX_RETRIES,
        reasoningEffort: "low",
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
    messages: ModelMessage[],
    onStatus: StatusCallback | undefined,
    options: {
      deadlineAt?: number;
      perProviderTimeoutMs: number;
      maxTokens?: number;
      retryDelayMs: number;
      maxOutputContinuations: number;
      responseFormat?: "json_object";
      requestLabel: string;
      signal?: AbortSignal;
    }
  ): Promise<RouterCompletionResult> {
    const startedAt = Date.now();
    const configuredMaxTokens = Number.isFinite(provider.maxTokens) && provider.maxTokens > 0
      ? provider.maxTokens
      : 16_384;
    const maxTokens = Math.min(configuredMaxTokens, options.maxTokens ?? configuredMaxTokens);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {}),
    };

    let requestAttempts = 0;
    let lastError = new ProviderRequestError("Provider request failed", "unknown", false);

    for (let attempt = 0; attempt <= provider.maxRetries; attempt++) {
      options.signal?.throwIfAborted();
      let remainingMs = options.deadlineAt === undefined
        ? undefined
        : options.deadlineAt - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new ProviderRequestError("Completion deadline exceeded", "network_timeout", true, "", "", requestAttempts);
      }

      if (attempt > 0) {
        const retryMsg = `Still working… (attempt ${attempt + 1}/${provider.maxRetries + 1})`;
        console.log(`[MultiModelRouter] Retrying ${provider.name} (attempt ${attempt + 1}/${provider.maxRetries + 1})...`);
        onStatus?.(retryMsg);
        await sleep(options.retryDelayMs);
        options.signal?.throwIfAborted();
        remainingMs = options.deadlineAt === undefined
          ? undefined
          : options.deadlineAt - Date.now();
        if (remainingMs !== undefined && remainingMs <= 0) {
          throw new ProviderRequestError("Completion deadline exceeded", "network_timeout", true, "", "", requestAttempts);
        }
      }

      try {
        let accumulatedText = "";
        let requestMessages = messages;

        for (let continuation = 0; continuation <= options.maxOutputContinuations; continuation += 1) {
          options.signal?.throwIfAborted();
          remainingMs = options.deadlineAt === undefined
            ? undefined
            : options.deadlineAt - Date.now();
          if (remainingMs !== undefined && remainingMs <= 0) {
            throw new ProviderRequestError(
              "Completion deadline exceeded",
              "network_timeout",
              true,
              accumulatedText,
              "",
              requestAttempts
            );
          }

          const payload: Record<string, any> = {
            model: provider.model,
            messages: requestMessages,
            temperature: 0.2,
            max_tokens: maxTokens,
          };
          if (provider.reasoningEffort) payload.reasoning_effort = provider.reasoningEffort;
          if (options.responseFormat) payload.response_format = { type: options.responseFormat };

          requestAttempts += 1;
          const size = messageSize(requestMessages);
          console.info(`[MultiModelRouter] ${JSON.stringify({
            event: "model_request_created",
            requestLabel: options.requestLabel,
            model: provider.model,
            providerId: provider.id,
            stream: false,
            textChars: size.textChars,
            imageCount: size.imageCount,
            maxTokens,
            attempt: requestAttempts,
            continuation,
          })}`);

          const res: Response = await this.enqueue(provider.id, () => {
            options.signal?.throwIfAborted();
            const remainingAtFetchMs = options.deadlineAt === undefined
              ? undefined
              : options.deadlineAt - Date.now();
            if (remainingAtFetchMs !== undefined && remainingAtFetchMs <= 0) {
              throw new ProviderRequestError(
                "Completion deadline exceeded",
                "network_timeout",
                true,
                accumulatedText,
                "",
                requestAttempts
              );
            }
            const attemptTimeoutMs = Math.max(
              1,
              Math.min(options.perProviderTimeoutMs, remainingAtFetchMs ?? options.perProviderTimeoutMs)
            );
            return fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify(payload),
              signal: options.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(attemptTimeoutMs)])
                : AbortSignal.timeout(attemptTimeoutMs),
            });
          }, remainingMs);

          if (!res.ok) {
            const rawErr = await res.text();
            let errMsg = rawErr;

            try {
              const parsed = JSON.parse(rawErr);
              const code = String(parsed.error?.code || "");
              if (res.status === 503 || code === "1305") {
                errMsg = `Service unavailable/busy on ${provider.model} (503)`;
              } else if (res.status === 429 || code === "1302") {
                errMsg = `Rate limit reached on ${provider.model} (429)`;
              } else if (parsed.error?.message) {
                errMsg = parsed.error.message;
              }
            } catch {}

            const failure = classifyProviderFailure(res.status, errMsg);
            throw new ProviderRequestError(
              `HTTP ${res.status}: ${safeProviderMessage(errMsg)}`,
              failure.category,
              failure.retryable,
              accumulatedText,
              "",
              requestAttempts
            );
          }

          const json = await res.json().catch(() => {
            throw new ProviderRequestError(
              "Provider returned malformed JSON",
              "invalid_response_schema",
              false,
              accumulatedText,
              "",
              requestAttempts
            );
          });
          const choice = json.choices?.[0];
          const text = completionText(choice?.message?.content);
          if (!text || text.trim().length === 0) {
            const hasReasoning = completionText(choice?.message?.reasoning_content).trim().length > 0;
            throw new ProviderRequestError(
              hasReasoning
                ? "Provider returned reasoning without a final answer"
                : "Received empty response body from provider",
              "empty_response",
              false,
              accumulatedText,
              typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
              requestAttempts
            );
          }

          const previousAccumulatedText = accumulatedText;
          accumulatedText = appendContinuationChunk(accumulatedText, text);
          if (continuation > 0 && accumulatedText === previousAccumulatedText) {
            throw new ProviderRequestError(
              "Continuation returned no new content",
              "output_limit",
              true,
              accumulatedText,
              "length",
              requestAttempts
            );
          }
          const finishReason = typeof choice?.finish_reason === "string"
            ? choice.finish_reason.toLowerCase()
            : "";
          const wasTruncated = ["length", "max_tokens", "max_output_tokens"].includes(finishReason);
          console.info(`[MultiModelRouter] ${JSON.stringify({
            event: continuation === 0 ? "model_first_response" : "model_continuation_response",
            requestLabel: options.requestLabel,
            model: provider.model,
            finishReason: finishReason || "unspecified",
            responseLength: text.length,
            accumulatedResponseLength: accumulatedText.length,
            attempt: requestAttempts,
          })}`);

          if (!wasTruncated) {
            console.log(`[MultiModelRouter] Provider [${provider.name}] succeeded! Generated ${accumulatedText.length} chars.`);
            return {
              text: accumulatedText,
              usedModel: provider.model,
              publicModelName: publicModelName(provider.id),
              providerName: provider.name,
              providerId: provider.id,
              finishReason: finishReason || "unspecified",
              responseSize: accumulatedText.length,
              durationMs: Date.now() - startedAt,
              attempts: requestAttempts,
              continuationAttempts: continuation,
            };
          }

          if (continuation === options.maxOutputContinuations) {
            throw new ProviderRequestError(
              options.maxOutputContinuations === 0
                ? "Provider output reached its configured limit"
                : `Provider output remained truncated after ${options.maxOutputContinuations} continuation requests`,
              "output_limit",
              false,
              accumulatedText,
              finishReason,
              requestAttempts
            );
          }

          const continuationMsg = "Continuing generation…";
          console.log(`[MultiModelRouter] ${provider.name} reached ${finishReason}; requesting continuation ${continuation + 1}/${options.maxOutputContinuations}.`);
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
        if (options.signal?.aborted) {
          throw new ProviderRequestError("Generation cancelled", "cancelled", false, "", "", requestAttempts);
        }
        const message = err?.message || String(err);
        const isTimeout = err?.name === "TimeoutError" || /aborted|timeout/i.test(message);
        const isNetworkFailure = /fetch|network|socket/i.test(message);
        lastError = err instanceof ProviderRequestError
          ? err
          : new ProviderRequestError(
              safeProviderMessage(message),
              isTimeout ? "network_timeout" : isNetworkFailure ? "network_error" : "unknown",
              isTimeout || isNetworkFailure,
              "",
              "",
              requestAttempts
            );
        console.warn(`[MultiModelRouter] ${JSON.stringify({
          event: "model_request_failed",
          requestLabel: options.requestLabel,
          model: provider.model,
          category: lastError.category,
          retryable: lastError.retryable,
          attempt: requestAttempts,
          finishReason: lastError.finishReason || undefined,
          partialResponseLength: lastError.partialText.length,
          reason: safeProviderMessage(lastError.message),
        })}`);

        if (!lastError.retryable) break;
      }
    }

    throw lastError;
  }

  public async complete(
    messages: ModelMessage[],
    onStatus?: StatusCallback,
    options: RouterCompletionOptions = {}
  ): Promise<RouterCompletionResult> {
    const configuredProviders = this.getProviders();

    if (configuredProviders.length === 0) {
      throw new Error(
        "No AI API keys configured. Please configure ABOVE_API_KEY or GEMINI_API_KEY."
      );
    }

    const eligibleProviders = options.onlyProviderId
      ? configuredProviders.filter((provider) => provider.id === options.onlyProviderId)
      : configuredProviders;
    if (eligibleProviders.length === 0) {
      throw new Error("The required AI capability is not configured.");
    }

    const providers = options.deprioritizeProviderId
      ? [
          ...eligibleProviders.filter((provider) => provider.id !== options.deprioritizeProviderId),
          ...eligibleProviders.filter((provider) => provider.id === options.deprioritizeProviderId),
        ]
      : eligibleProviders;
    const errors: ProviderRequestError[] = [];
    const startedAt = Date.now();
    const deadlineAt = options.totalTimeoutMs === undefined
      ? undefined
      : startedAt + options.totalTimeoutMs;
    const perProviderTimeoutMs = options.perProviderTimeoutMs ?? 120_000;

    for (let i = 0; i < providers.length; i++) {
      options.signal?.throwIfAborted();
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
      // Model inference is still code generation, not a running build. Build
      // status is emitted separately when validation starts.
      onStatus?.("Generating the implementation…");

      try {
        return await this.tryProvider(provider, messages, onStatus, {
          deadlineAt: providerDeadlineAt,
          perProviderTimeoutMs,
          maxTokens: options.maxTokens,
          retryDelayMs: options.retryDelayMs ?? RETRY_DELAY_MS,
          maxOutputContinuations: Math.max(
            0,
            Math.min(MAX_OUTPUT_CONTINUATIONS, options.maxOutputContinuations ?? MAX_OUTPUT_CONTINUATIONS)
          ),
          responseFormat: options.responseFormat,
          signal: options.signal,
          requestLabel: options.requestLabel?.trim() || "generation",
        });
      } catch (err: any) {
        const providerError = err instanceof ProviderRequestError
          ? err
          : new ProviderRequestError(safeProviderMessage(err?.message || String(err)), "unknown", false);
        errors.push(providerError);

        if (!isLast) {
          const nextProvider = providers[i + 1];
          const failoverMsg = "Continuing generation…";
          console.log(`[MultiModelRouter] Switching to ${nextProvider.name} after ${provider.name} failed.`);
          onStatus?.(failoverMsg);
        }
      }
    }

    const finalError = errors.at(-1) || new ProviderRequestError("No provider completed the request", "unknown", false);
    console.warn(`[MultiModelRouter] ${JSON.stringify({
      event: "all_providers_failed",
      requestLabel: options.requestLabel?.trim() || "generation",
      categories: errors.map((error) => error.category),
      attempts: errors.reduce((total, error) => total + error.attempts, 0),
      finalReason: safeProviderMessage(finalError.message),
    })}`);
    throw new ProviderExhaustedError(
      finalError.category,
      finalError.retryable,
      finalError.partialText,
      finalError.finishReason,
      errors.reduce((total, error) => total + error.attempts, 0),
      safeProviderMessage(finalError.message)
    );
  }
}

export const multiModelRouter = new MultiModelRouter();
