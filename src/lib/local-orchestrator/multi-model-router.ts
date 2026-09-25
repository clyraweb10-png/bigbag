import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { GLM_53_PROVIDER_ID, glm53Config } from "./ai-provider-config";

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
  reasoningFormat?: "hidden";
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
  /** Internal qualification telemetry; never include provider credentials or response content. */
  failureCategories: ProviderErrorCategory[];
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
  /** Keep the user's request intact while fitting provider-specific input limits. */
  /** Return null when a provider cannot receive the complete context required for a safe repair. */
  providerMessageTransform?: (providerId: string, messages: ModelMessage[]) => ModelMessage[] | null;
}

/** Additional bounded attempts for transient GLM 5.3 Flash failures. */
export const GLM_53_MAX_RETRIES = 2;
/** Maximum number of follow-up requests used to finish a token-limited response. */
export const MAX_OUTPUT_CONTINUATIONS = 4;
/** Delay in ms between retries. */
const RETRY_DELAY_MS = 3_000;
const providerCooldowns = new Map<string, { fingerprint: string; until: number; category: ProviderErrorCategory }>();

function providerFingerprint(provider: ModelProviderConfig): string {
  return createHash("sha256")
    .update(`${provider.baseUrl}\0${provider.model}\0${provider.apiKey}`)
    .digest("hex");
}

function providerCooldown(provider: ModelProviderConfig): ProviderErrorCategory | null {
  const cooldown = providerCooldowns.get(provider.id);
  if (!cooldown || cooldown.fingerprint !== providerFingerprint(provider) || cooldown.until <= Date.now()) {
    providerCooldowns.delete(provider.id);
    return null;
  }
  return cooldown.category;
}

function recordProviderFailure(provider: ModelProviderConfig, category: ProviderErrorCategory, retryAfterMs = 0): void {
  const duration = category === "authentication" || category === "invalid_model" ? 5 * 60_000
    : category === "rate_limit" ? Math.max(30_000, Math.min(120_000, retryAfterMs))
      : 0;
  if (duration > 0) providerCooldowns.set(provider.id, {
    fingerprint: providerFingerprint(provider), until: Date.now() + duration, category,
  });
}

function actionableProviderFailure(errors: ProviderRequestError[]): ProviderRequestError | undefined {
  // A configured account can be invalid while the only usable account is
  // temporarily rate-limited. Report the condition that can actually recover.
  return errors.findLast((error) => error.category === "rate_limit") ||
    errors.findLast((error) => error.category === "request_too_large" || error.category === "context_limit") ||
    errors.at(-1);
}

function resetDelayMs(value: string | null, retryAfter = false): number {
  if (!value) return 0;
  const text = value.trim().toLowerCase();
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, Math.ceil(seconds * 1_000));
  const milliseconds = /^(\d+(?:\.\d+)?)ms$/.exec(text);
  if (milliseconds) return Math.min(120_000, Math.ceil(Number(milliseconds[1])));
  const duration = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(text);
  if (duration && (duration[1] || duration[2])) {
    return Math.min(120_000, Math.ceil((Number(duration[1] || 0) * 60 + Number(duration[2] || 0)) * 1_000));
  }
  if (retryAfter) {
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) return Math.min(120_000, Math.max(0, dateMs - Date.now()));
  }
  return 0;
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

async function readStreamedCompletion(response: Response, onText: (text: string) => void): Promise<{
  text: string; reasoning: string; finishReason: string;
}> {
  if (!response.body) throw new Error("Provider returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let reasoning = "";
  let finishReason = "";
  let doneMarker = false;
  const readLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") { doneMarker = true; return; }
    let parsed: { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }> };
    try { parsed = JSON.parse(data); } catch { return; }
    const choice = parsed.choices?.[0];
    const delta = completionText(choice?.delta?.content);
    if (delta) { text += delta; onText(text); }
    reasoning += completionText(choice?.delta?.reasoning_content);
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason.toLowerCase();
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) readLine(line);
      if (done) { if (pending) readLine(pending); break; }
    }
  } finally {
    reader.releaseLock();
  }
  if (!doneMarker) throw new Error("Network stream ended before completion");
  return { text, reasoning, finishReason };
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

function continuationMessages(original: ModelMessage[], accumulated: string, requestLabel: string): ModelMessage[] {
  const instruction = "Continue exactly where the previous response stopped. Return only the missing remainder. Do not repeat completed content. If the response stopped inside a fenced code block, continue the code directly without opening a new fence. Finish every remaining file block and the complete requested result.";
  if (requestLabel !== "code_generation") {
    return [...original, { role: "assistant", content: accumulated }, { role: "user", content: instruction }];
  }
  const lastUser = [...original].reverse().find((message) => message.role === "user");
  const task = (typeof lastUser?.content === "string"
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? lastUser.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n")
      : "").slice(0, 8_000);
  const paths = [...accumulated.matchAll(/^###\s+(?:File|Delete):\s*(.+)$/gm)]
    .map((match) => match[1].trim()).slice(-50).join(", ");
  return [
    { role: "system", content: "Continue the existing generated-app response. Preserve its file-block format and working implementation. Output only the missing code; never restart the project or claim success." },
    { role: "user", content: `Original request (abridged):\n${task}\n\nAlready emitted file paths: ${paths || "none"}\n\nResponse tail:\n${accumulated.slice(-12_000)}\n\n${instruction}` },
  ];
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
    public readonly attempts = 0,
    public readonly retryAfterMs = 0
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
  let safe = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)$/i.test(name) && secret && secret.length >= 8) {
      safe = safe.replaceAll(secret, "[redacted]");
    }
  }
  return safe
    .replace(/\b(?:gsk_|sk[-_]|e2b_|fc-|sb_secret_|ghp_|glpat-|xoxb-|AIza|KEY[0-9a-f]{24}_)[a-z0-9._-]{8,}\b/gi, "[redacted]")
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
    const config = glm53Config();
    if (!config) return [];
    return [{
      id: GLM_53_PROVIDER_ID,
      name: "GLM 5.3 Flash",
      ...config,
      // Bound the first response so a long reasoning phase cannot consume the
      // entire request timeout before any usable source arrives. Continuation
      // requests retain the ability to emit larger applications.
      maxTokens: 8_192,
      maxRetries: GLM_53_MAX_RETRIES,
      reasoningEffort: "low",
    }];
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
    const failureCategories: ProviderErrorCategory[] = [];
    let recoverablePartialText = "";

    for (let attempt = 0; attempt <= provider.maxRetries; attempt++) {
      options.signal?.throwIfAborted();
      let remainingMs = options.deadlineAt === undefined
        ? undefined
        : options.deadlineAt - Date.now();
      if (remainingMs !== undefined && remainingMs <= 0) {
        throw new ProviderRequestError("Completion deadline exceeded", "network_timeout", true, recoverablePartialText, "", requestAttempts);
      }

      if (attempt > 0) {
        const retryMsg = `Still working… (attempt ${attempt + 1}/${provider.maxRetries + 1})`;
        console.log(`[MultiModelRouter] Retrying ${provider.name} (attempt ${attempt + 1}/${provider.maxRetries + 1})...`);
        onStatus?.(retryMsg);
        const delayMs = Math.max(options.retryDelayMs, lastError.retryAfterMs);
        if (remainingMs !== undefined && delayMs >= remainingMs) throw lastError;
        await sleep(delayMs, undefined, { signal: options.signal });
        options.signal?.throwIfAborted();
        remainingMs = options.deadlineAt === undefined
          ? undefined
          : options.deadlineAt - Date.now();
        if (remainingMs !== undefined && remainingMs <= 0) {
          throw new ProviderRequestError("Completion deadline exceeded", "network_timeout", true, recoverablePartialText, "", requestAttempts);
        }
      }

      let accumulatedText = recoverablePartialText;
      let inFlightText = "";
      try {
        let requestMessages = accumulatedText
          ? continuationMessages(messages, accumulatedText, options.requestLabel)
          : messages;

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
          const stream = (options.requestLabel === "code_generation" || options.requestLabel === "code_repair") && !options.responseFormat;
          if (stream) payload.stream = true;
          if (provider.reasoningEffort) payload.reasoning_effort = provider.reasoningEffort;
          if (provider.reasoningFormat) payload.reasoning_format = provider.reasoningFormat;
          if (options.responseFormat) payload.response_format = { type: options.responseFormat };

          requestAttempts += 1;
          const size = messageSize(requestMessages);
          console.info(`[MultiModelRouter] ${JSON.stringify({
            event: "model_request_created",
            requestLabel: options.requestLabel,
            model: provider.model,
            providerId: provider.id,
            stream,
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
            const retryAfterMs = res.status === 429 ? Math.max(
              resetDelayMs(res.headers.get("retry-after"), true),
              resetDelayMs(res.headers.get("x-ratelimit-reset-tokens")),
            ) + 250 : 0;
            throw new ProviderRequestError(
              `HTTP ${res.status} (${failure.category})`,
              failure.category,
              failure.retryable,
              accumulatedText,
              "",
              requestAttempts,
              retryAfterMs
            );
          }

          inFlightText = "";
          const streamed = stream && res.headers.get("content-type")?.includes("text/event-stream")
            ? await readStreamedCompletion(res, (value) => { inFlightText = value; })
            : null;
          const json = streamed ? null : await res.json().catch(() => {
            throw new ProviderRequestError("Provider returned malformed JSON", "invalid_response_schema", false,
              accumulatedText, "", requestAttempts);
          });
          const choice = json?.choices?.[0];
          const text = streamed?.text ?? completionText(choice?.message?.content);
          if (!text || text.trim().length === 0) {
            const hasReasoning = (streamed?.reasoning || completionText(choice?.message?.reasoning_content)).trim().length > 0;
            const finishReason = streamed?.finishReason || (typeof choice?.finish_reason === "string" ? choice.finish_reason.toLowerCase() : "");
            const reasoningHitLimit = hasReasoning && ["length", "max_tokens", "max_output_tokens"].includes(finishReason);
            throw new ProviderRequestError(
              hasReasoning
                ? "Provider returned reasoning without a final answer"
                : "Received empty response body from provider",
              reasoningHitLimit ? "output_limit" : "empty_response",
              reasoningHitLimit,
              accumulatedText,
              finishReason,
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
          const finishReason = streamed?.finishReason || (typeof choice?.finish_reason === "string"
            ? choice.finish_reason.toLowerCase()
            : "");
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
              failureCategories,
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
          requestMessages = continuationMessages(messages, accumulatedText, options.requestLabel);
        }
      } catch (err: any) {
        if (options.signal?.aborted) {
          throw new ProviderRequestError("Generation cancelled", "cancelled", false, "", "", requestAttempts);
        }
        const message = err?.message || String(err);
        const partialResponse = appendContinuationChunk(accumulatedText, inFlightText);
        const isTimeout = err?.name === "TimeoutError" || /aborted|timeout/i.test(message);
        const isNetworkFailure = /fetch|network|socket/i.test(message);
        lastError = err instanceof ProviderRequestError
          ? err
          : new ProviderRequestError(
              safeProviderMessage(message),
              isTimeout ? "network_timeout" : isNetworkFailure ? "network_error" : "unknown",
              isTimeout || isNetworkFailure,
              partialResponse,
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
        failureCategories.push(lastError.category);

        // A transport failure can resume a valid partial answer. A repeated
        // continuation is an output-shape failure: restart from the original
        // request so a fresh answer is never appended to a stale fragment.
        recoverablePartialText = lastError.partialText && lastError.retryable &&
          ["network_timeout", "network_error", "provider_unavailable", "rate_limit"].includes(lastError.category)
          ? lastError.partialText
          : "";

        // A long provider reset cannot be repaired by an immediate retry.
        // Preserve the account's cooldown and give another provider the run.
        if (!lastError.retryable || (lastError.category === "rate_limit" && lastError.retryAfterMs > 30_000)) break;
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
        "GLM 5.3 Flash is not configured. Set ABOVE_API_KEY on the server."
      );
    }

    const eligibleProviders = options.onlyProviderId
      ? configuredProviders.filter((provider) => provider.id === options.onlyProviderId)
      : configuredProviders;
    if (eligibleProviders.length === 0) {
      throw new Error("The required AI capability is not configured.");
    }

    const initialProviders = [...eligibleProviders];
    const routedProviders = options.deprioritizeProviderId
      ? [
          ...initialProviders.filter((provider) => provider.id !== options.deprioritizeProviderId),
          ...initialProviders.filter((provider) => provider.id === options.deprioritizeProviderId),
        ]
      : initialProviders;
    const skipped = routedProviders.flatMap((provider) => {
      const category = providerCooldown(provider);
      return category ? [{ provider, category }] : [];
    });
    const providers = routedProviders.filter((provider) => !skipped.some((entry) => entry.provider.id === provider.id));
    const errors: ProviderRequestError[] = skipped.map(({ category }) =>
      new ProviderRequestError("Provider is in a temporary health cooldown", category, category === "rate_limit"));
    if (providers.length === 0) {
      const blockingError = actionableProviderFailure(errors);
      throw new ProviderExhaustedError(blockingError?.category || "provider_unavailable", Boolean(blockingError?.retryable), "", "", 0,
        "Configured AI providers are temporarily unavailable; check their credentials or rate limits.");
    }
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

      try {
        const transformed = options.providerMessageTransform?.(provider.id, messages);
        if (transformed === null) {
          throw new ProviderRequestError("Complete affected source exceeds this provider's repair context limit", "context_limit", false);
        }
        const providerMessages = transformed ?? messages;
        console.log(`[MultiModelRouter] Attempting provider [${provider.name}] (${provider.model})...`);
        // Model inference is still code generation, not a running build. Build
        // status is emitted separately when validation starts.
        onStatus?.("Generating the implementation…");
        const result = await this.tryProvider(provider, providerMessages, onStatus, {
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
        providerCooldowns.delete(provider.id);
        return {
          ...result,
          failureCategories: [
            ...errors.map((error) => error.category),
            ...result.failureCategories,
          ],
        };
      } catch (err: any) {
        const providerError = err instanceof ProviderRequestError
          ? err
          : new ProviderRequestError(safeProviderMessage(err?.message || String(err)), "unknown", false);
        errors.push(providerError);
        recordProviderFailure(provider, providerError.category, providerError.retryAfterMs);

        if (!isLast) {
          const nextProvider = providers[i + 1];
          const failoverMsg = "Continuing generation…";
          console.log(`[MultiModelRouter] Switching to ${nextProvider.name} after ${provider.name} failed.`);
          onStatus?.(failoverMsg);
        }
      }
    }

    const finalError = actionableProviderFailure(errors) || new ProviderRequestError("No provider completed the request", "unknown", false);
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
