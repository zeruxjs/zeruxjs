import { AiProviderError } from './types.js';
import type {
  AiProvider,
  ChatMessage,
  ChatOptions,
  ProviderConfig,
} from './types.js';
import { parseAiSse } from './sse.js';

/**
 * Validate the legacy text envelope before serialization or transport admission.
 * @param {ChatMessage[]} messages - Between one and 256 known-role text messages.
 * @returns {void} No mutation; this legacy subset does not negotiate native tool execution.
 * @throws {TypeError} When a message role/content or message count is invalid.
 */
function validateMessages(messages: ChatMessage[]): void {
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 256 ||
    messages.some(
      (m) =>
        !m ||
        !['system', 'user', 'assistant', 'tool'].includes(m.role) ||
        typeof m.content !== 'string'
    )
  ) {
    throw new TypeError('Invalid messages');
  }
}
/**
 * Validate supplied legacy generation options before creating request resources.
 * @param {ChatOptions} options - Optional response cap and model sampling/token limits.
 * @returns {void} The per-call response ceiling is narrowed again against provider policy.
 * @throws {RangeError} On invalid response bytes, sampling values or token ceiling.
 */
function validateChatOptions(options: ChatOptions): void {
  if (
    options.maxResponseBytes !== undefined &&
    (!Number.isSafeInteger(options.maxResponseBytes) ||
      options.maxResponseBytes < 1 ||
      options.maxResponseBytes > 67108864)
  ) {
    throw new RangeError('Invalid response budget');
  }
  if (
    options.temperature !== undefined &&
    (!Number.isFinite(options.temperature) ||
      options.temperature < 0 ||
      options.temperature > 2)
  ) {
    throw new RangeError('Invalid temperature');
  }
  if (
    options.topP !== undefined &&
    (!Number.isFinite(options.topP) || options.topP < 0 || options.topP > 1)
  ) {
    throw new RangeError('Invalid topP');
  }
  if (
    options.maxTokens !== undefined &&
    (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1)
  ) {
    throw new RangeError('Invalid maxTokens');
  }
}
/**
 * Interpret Retry-After as seconds or an HTTP date, bounded to one minute.
 * @param {Headers} headers - Provider response headers; no body content is inspected.
 * @returns {number | undefined} Positive capped milliseconds, or undefined if absent/invalid.
 */
function retryAfter(headers: Headers): number | undefined {
  /** Header syntax is parsed locally; no endpoint or timing request is performed. */
  const raw = headers.get('retry-after');
  if (!raw) {
    return undefined;
  }
  /** Numeric syntax takes precedence over date parsing for compatibility. */
  const seconds = Number(raw);
  /** Dates are relative to the current clock; expired values request no wait. */
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) && delay > 0
    ? Math.min(delay, 60000)
    : undefined;
}

/**
 * Construct the bounded Chat Completions text transport without starting requests.
 * @param {ProviderConfig} config - Private host endpoint, credential and borrowed Fetch policy.
 * @returns {AiProvider} Single-attempt buffered/text-stream provider; no usage/tool SDK parity.
 * @throws {TypeError} On invalid endpoint, scheme or missing credentials/model.
 * @throws {RangeError} On invalid timeout, request or response budgets.
 */
export function createOpenAICompatibleProvider(
  config: ProviderConfig
): AiProvider {
  /** Host-selected endpoint is parsed once; credentials/query/fragments reject. */
  const endpoint = new URL(config.baseUrl);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search
  ) {
    throw new TypeError('Invalid endpoint URL');
  }
  if (
    endpoint.protocol !== 'https:' &&
    !(
      endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    )
  ) {
    throw new TypeError('AI endpoint must use HTTPS');
  }
  if (!config.model?.trim() || !config.apiKey?.trim()) {
    throw new TypeError('Model and API key required');
  }
  /** Request lifetime in milliseconds, including response consumption. */
  const timeout = config.timeoutMs ?? 30000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300000) {
    throw new RangeError('Invalid timeout');
  }
  /** Configured aggregate response ceiling, independent of Content-Length claims. */
  const maxBytes = config.maxResponseBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864) {
    throw new RangeError('Invalid maximum response size');
  }
  /** Serialized request ceiling includes messages and JSON overhead. */
  const maxRequest = config.maxRequestBytes ?? 1048576;
  if (
    !Number.isSafeInteger(maxRequest) ||
    maxRequest < 1 ||
    maxRequest > 16777216
  ) {
    throw new RangeError('Invalid maximum request size');
  }
  /** Borrowed Fetch implementation; closing application pools remains host-owned. */
  const request = config.fetch ?? fetch;
  /** Fixed chat path is derived from approved origin, never from generated data. */
  const url = new URL(
    `${endpoint.pathname.replace(/\/$/, '')}/chat/completions`,
    endpoint.origin
  );
  /**
   * Dispatch one fixed-endpoint request and transfer a cleanup lease on success.
   * @param {ChatMessage[]} messages - Validated text envelope, bounded before dispatch.
   * @param {ChatOptions} options - Per-call generation settings and cancellation.
   * @param {boolean} stream - Select buffered JSON or SSE wire response.
   * @returns {Promise<object>} Response, effective signal/byte limit and required release callback.
   * @throws {AiProviderError} On HTTP failure, excessive declared length or absent response body.
   */
  async function send(
    messages: ChatMessage[],
    options: ChatOptions,
    stream: boolean
  ): Promise<{
    response: Response;
    release: () => Promise<void>;
    signal: AbortSignal;
    responseLimit: number;
  }> {
    validateMessages(messages);
    validateChatOptions(options);
    /** Caller override can narrow this request but never enlarge provider policy. */
    const responseLimit = Math.min(
      maxBytes,
      options.maxResponseBytes ?? maxBytes
    );
    /** Serialize only the declared legacy fields; no tool/command evaluation occurs. */
    const body = JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stream,
    });
    if (new TextEncoder().encode(body).length > maxRequest) {
      throw new AiProviderError('Provider request is too large');
    }
    let response: Response | undefined;
    /** Request-local cancellation owner combines caller abort and deadline cleanup. */
    const controller = new AbortController();
    /**
     * Forward the caller's reason into this request-local cancellation owner.
     * @returns {void} Does not close borrowed transport pools.
     */
    const cancel = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) {
      cancel();
    } else {
      options.signal?.addEventListener('abort', cancel, { once: true });
    }
    /** Deadline timer remains live until the response owner calls release. */
    const timer = setTimeout(
      () => controller.abort(new Error('AI request timed out')),
      timeout
    );
    /**
     * Remove request listeners/timers and cancel an unconsumed unlocked body.
     * @returns {Promise<void>} Completes after body cancellation; repeated cleanup is safe.
     */
    const release = async () => {
      controller.abort();
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => {});
      }
    };
    try {
      /** Fresh headers prevent mutation of host configuration across requests. */
      const headers = new Headers(config.headers);
      // Never allow caller-supplied headers to replace the configured credential.
      headers.set('Authorization', `Bearer ${config.apiKey}`);
      headers.set('Content-Type', 'application/json');
      if (stream) {
        headers.set('Accept', 'text/event-stream');
      }
      response = await request(url, {
        method: 'POST',
        headers,
        redirect: 'error',
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AiProviderError(
          `AI provider returned HTTP ${response.status}`,
          response.status,
          [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status),
          retryAfter(response.headers)
        );
      }
      if (Number(response.headers.get('content-length')) > responseLimit) {
        throw new AiProviderError('Provider response is too large');
      }
      if (!response.body) {
        throw new AiProviderError('Empty AI response');
      }
      return { response, release, signal: controller.signal, responseLimit };
    } catch (error) {
      await release();
      throw error;
    }
  }
  return {
    capabilities: Object.freeze({
      chat: true,
      stream: true,
      tools: false,
      usage: false,
      singleAttempt: true,
    }),
    /**
     * Consume one bounded JSON response and always release request resources.
     * @param {ChatMessage[]} messages - Conversation authorized by the host.
     * @param {ChatOptions} options - Optional generation settings, default empty.
     * @returns {Promise<string>} Untrusted text; validation, transport and abort failures propagate.
     */
    async chat(messages, options = {}) {
      /** Buffered response transfers its cleanup lease to this call’s finally block. */
      const { response, release, responseLimit } = await send(
        messages,
        options,
        false
      );
      try {
        /** The buffered reader owns its lock until nested finally cancels and unlocks. */
        const reader = response.body!.getReader();
        /** Bounded received fragments; cumulative byte enforcement precedes retention. */
        const parts: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            /** Native stream read may settle after cancellation for a borrowed transport. */
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            length += value.byteLength;
            if (length > responseLimit) {
              throw new AiProviderError('Provider response is too large');
            }
            parts.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        /** Allocate a single payload only after aggregate received length was validated. */
        const raw = new Uint8Array(length);
        let cursor = 0;
        // Copy only validated fragments in arrival order; no source parsing occurs here.
        for (const part of parts) {
          raw.set(part, cursor);
          cursor += part.byteLength;
        }
        let data: { choices?: Array<{ message?: { content?: unknown } }> };
        try {
          data = JSON.parse(new TextDecoder().decode(raw));
        } catch {
          throw new AiProviderError('Invalid JSON from AI provider');
        }
        /** Expose only the first legacy choice’s string content, never arbitrary objects. */
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new AiProviderError('Invalid AI response shape');
        }
        return content;
      } finally {
        await release();
      }
    },
    /**
     * Consume one SSE text stream and always release request resources.
     * @param {ChatMessage[]} messages - Conversation authorized by the host.
     * @param {ChatOptions} options - Optional generation settings, default empty.
     * @returns {AsyncIterable<string>} Untrusted text; validation, transport and abort failures propagate.
     */
    async *stream(messages, options = {}) {
      /** Streaming call retains its cleanup lease until consumption or early iterator return. */
      const { response, release, signal, responseLimit } = await send(
        messages,
        options,
        true
      );
      try {
        /** Only SSE enters the stream parser; failure still releases the body. */
        const contentType = response.headers.get('content-type') ?? '';
        if (!/^text\/event-stream(?:;|$)/i.test(contentType)) {
          throw new AiProviderError('Expected text/event-stream');
        }
        yield* parseAiSse(response.body!, responseLimit, signal);
      } finally {
        await release();
      }
    },
  };
}
