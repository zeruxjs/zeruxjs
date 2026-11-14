import {
  createContentEncoder,
  prepareJsonOutput,
  validateJsonOutput,
} from './content.js';
import type { AiContentMessage, AiContentOptions } from './types.js';
import {
  AiProviderError,
  type AiProvider,
  type AiChatResult,
  type AiStreamEvent,
  type AiUsage,
  type ChatMessage,
  type ChatOptions,
  type ModelProviderConfig,
} from './types.js';
import { parseAiSseEvents } from './sse.js';
import { withConcurrencyLimit } from './concurrency.js';
/** Native Messages configuration with an explicit supported wire version; no automatic upgrades. */
export interface AnthropicProviderConfig extends ModelProviderConfig {
  /** Explicit supported Anthropic wire version; no automatic migration or discovery occurs. */
  apiVersion: '2023-06-01' | '2026-10-21';
}

/**
 * Validate an optional provider-reported token count without inventing missing usage.
 * @param {unknown} value - Candidate value; validation failures do not echo private content.
 * @returns {number | undefined} Validated nonnegative integer token count, or undefined when not reported.
 */
function number(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AiProviderError('Invalid provider usage');
  }
  return value;
}
/**
 * Map only known token counters, retaining missing or vendor-specific accounting as unknown.
 * @param {any} raw - Bounded provider data; unknown fields remain private metadata.
 * @param {'anthropic' | 'gemini'} kind - Selected native provider wire format.
 * @returns {AiUsage} Whether this attempt supplied complete consistent input/output counts.
 */
function usage(raw: any, kind: 'anthropic' | 'gemini'): AiUsage {
  return kind === 'anthropic'
    ? {
        inputTokens: number(raw?.input_tokens),
        outputTokens: number(raw?.output_tokens),
      }
    : {
        inputTokens: number(raw?.promptTokenCount),
        outputTokens: number(raw?.candidatesTokenCount),
        totalTokens: number(raw?.totalTokenCount),
      };
}
/**
 * Map known stop categories without discarding unknown provider metadata.
 * @param {unknown} value - Candidate value; validation failures do not echo private content.
 * @returns {AiChatResult['finishReason']} Known normalized stop category, otherwise unknown.
 */
function finish(value: unknown): AiChatResult['finishReason'] {
  if (['end_turn', 'stop_sequence', 'STOP'].includes(value as string)) {
    return 'stop';
  }
  if (['max_tokens', 'MAX_TOKENS'].includes(value as string)) {
    return 'length';
  }
  if (
    [
      'refusal',
      'SAFETY',
      'RECITATION',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
    ].includes(value as string)
  ) {
    return 'blocked';
  }
  if (value === 'tool_use') {
    return 'tool';
  }
  return 'unknown';
}
/**
 * Parse strict provider JSON with a fixed public error instead of echoing response text.
 * @param {string} text - Untrusted text inspected as data, never evaluated.
 * @returns {any} Parsed provider JSON; malformed text throws a fixed AiProviderError.
 */
function json(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError('Invalid provider JSON');
  }
}
/**
 * Project the supported first-candidate text/usage subset while retaining private raw metadata.
 * @param {any} raw - Bounded provider data; unknown fields remain private metadata.
 * @param {'anthropic' | 'gemini'} kind - Selected native provider wire format.
 * @returns {AiChatResult} Text and normalized usage/finish with bounded private raw metadata retained.
 */
function normalize(raw: any, kind: 'anthropic' | 'gemini'): AiChatResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.error) {
    throw new AiProviderError('Invalid provider response');
  }
  /** Only the first candidate text subset enters the text projection; raw metadata stays private. */
  const blocks =
    kind === 'anthropic' ? raw.content : raw.candidates?.[0]?.content?.parts;
  let text = '';
  if (blocks !== undefined) {
    if (!Array.isArray(blocks)) {
      throw new AiProviderError('Invalid provider content');
    }
    // Project supported text only; Gemini thought text remains in private metadata.
    for (const block of blocks) {
      if (!block || typeof block !== 'object') {
        throw new AiProviderError('Invalid provider content');
      }
      if (
        (kind === 'anthropic' && block.type !== 'text') ||
        (kind === 'gemini' &&
          Object.keys(block).some(
            (key) => !['text', 'thought', 'thoughtSignature'].includes(key)
          ))
      ) {
        throw new AiProviderError('Unsupported non-text provider content');
      }
      if (block.text !== undefined && typeof block.text !== 'string') {
        throw new AiProviderError('Invalid provider text');
      }
      if (block.thought !== true) {
        text += block.text ?? '';
      }
    }
  }
  /** Provider stopping reason retained without inventing semantic equivalence for unknown values. */
  const reason =
    kind === 'anthropic'
      ? raw.stop_reason
      : (raw.candidates?.[0]?.finishReason ?? raw.promptFeedback?.blockReason);
  if (blocks === undefined && reason === undefined && !raw.usageMetadata) {
    throw new AiProviderError('Invalid provider response shape');
  }
  return {
    text,
    usage: usage(kind === 'anthropic' ? raw.usage : raw.usageMetadata, kind),
    finishReason:
      kind === 'gemini' && raw.promptFeedback?.blockReason
        ? 'blocked'
        : finish(reason),
    providerMetadata: raw,
  };
}
/**
 * Construct one bounded native provider with shared admission and fixed host credentials.
 * @param {'anthropic' | 'gemini'} kind - Selected native provider wire format.
 * @param {ModelProviderConfig} config - Private host credential/endpoint/budget configuration.
 * @param {string | undefined} version - Explicit wire version where required; never automatically upgraded.
 * @returns {AiProvider} One-attempt native provider sharing FIFO admission across text and rich methods.
 * @throws {TypeError | RangeError} On invalid policy/input or the documented fixed failure/budget state.
 */
function adapter(
  kind: 'anthropic' | 'gemini',
  config: ModelProviderConfig,
  version?: string
): AiProvider {
  if (typeof window !== 'undefined') {
    throw new Error('Model credentials require a server runtime');
  }
  if (
    !config ||
    typeof config.apiKey !== 'string' ||
    !config.apiKey.trim() ||
    config.apiKey.length > 8192 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f]/.test(config.apiKey) ||
    typeof config.model !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(config.model)
  ) {
    throw new TypeError('Invalid model credentials/configuration');
  }
  /** Host-approved endpoint is validated once; redirects and URL credentials are disallowed. */
  const endpoint = new URL(
    config.baseUrl ??
      (kind === 'anthropic'
        ? 'https://api.anthropic.com/v1'
        : 'https://generativelanguage.googleapis.com/v1beta')
  );
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search ||
    (endpoint.protocol !== 'https:' &&
      !(
        endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
      ))
  ) {
    throw new TypeError('Invalid provider endpoint');
  }
  /** Per-native-call deadline in milliseconds, including response consumption/validation. */
  const timeout = config.timeoutMs ?? 30000;
  /** Aggregate native response byte ceiling including envelopes and provider metadata. */
  const maxResponse = config.maxResponseBytes ?? 4194304;
  /** Aggregate serialized request ceiling, including base64 media overhead. */
  const maxRequest = config.maxRequestBytes ?? 1048576;
  // Validate all configured budget ceilings before creating a provider instance.
  for (const [value, max] of [
    [timeout, 300000],
    [maxResponse, 67108864],
    [maxRequest, 16777216],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new RangeError('Invalid provider budget');
    }
  }
  /** Inert provider-specific content encoder; no local codecs, file reads or remote media fetching. */
  const encoder = createContentEncoder(kind, config.content, maxRequest);
  /** Frozen declared wire features; selected model/account support must still be qualified. */
  const capabilities = Object.freeze({
    chat: true,
    stream: true,
    tools: false,
    usage: true,
    inputs: encoder.inputs,
    jsonOutput: true,
    singleAttempt: true,
  });
  /** Private captured credential, never copied into public result or logging fields. */
  const key = config.apiKey;
  /** Explicit host-selected model identifier; no model discovery or silent migration. */
  const model = config.model;
  /** Borrowed Fetch transport; host owns connection pools and deployment egress policy. */
  const transport = config.fetch ?? fetch;
  /** Private configured headers reject credential/host/length overrides before first dispatch. */
  const extra = new Headers(config.headers);
  if (
    extra.has('authorization') ||
    extra.has('x-api-key') ||
    extra.has('x-goog-api-key') ||
    extra.has('host') ||
    extra.has('content-length')
  ) {
    throw new TypeError('Reserved provider header');
  }
  /** Validated fixed base URL; request arguments cannot select another origin. */
  const base = endpoint.href.replace(/\/$/, '');
  /**
   * Validate declared options/messages and serialize the supported provider wire envelope.
   * @param {(ChatMessage | AiContentMessage)[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
   * @param {AiContentOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
   * @param {boolean} stream - Whether to request SSE rather than buffered JSON.
   * @param {unknown} contentMode - Enable the explicit inert multipart input path; defaults false.
   * @param {ReturnType<typeof prepareJsonOutput> | undefined} output - Output token count used by this accounting step.
   * @returns {string} Serialized native envelope within the configured request-byte ceiling.
   */
  function body(
    messages: (ChatMessage | AiContentMessage)[],
    options: AiContentOptions,
    stream: boolean,
    contentMode = false,
    output?: ReturnType<typeof prepareJsonOutput>
  ): string {
    if (
      !options ||
      typeof options !== 'object' ||
      Object.keys(options).some(
        (k) =>
          !(
            contentMode
              ? [
                  'signal',
                  'temperature',
                  'maxTokens',
                  'topP',
                  'maxResponseBytes',
                  'output',
                ]
              : [
                  'signal',
                  'temperature',
                  'maxTokens',
                  'topP',
                  'maxResponseBytes',
                ]
          ).includes(k)
      )
    ) {
      throw new TypeError('Unsupported chat options');
    }
    if (!Array.isArray(messages) || !messages.length || messages.length > 256) {
      throw new TypeError('Invalid messages');
    }
    /** Validated text or encoded content snapshot used to build the native envelope. */
    const copied = contentMode
      ? encoder.encode(messages as AiContentMessage[])
      : messages.map((m) => {
          if (
            !m ||
            !['system', 'user', 'assistant'].includes(m.role) ||
            typeof m.content !== 'string' ||
            ('name' in m && m.name !== undefined)
          ) {
            throw new TypeError('Unsupported message role/name');
          }
          return { role: m.role, content: m.content };
        });
    let seen = false;
    // Reject interleaved system messages rather than silently changing conversational order.
    for (const m of copied) {
      if (m.role !== 'system') {
        seen = true;
      } else if (seen) {
        throw new TypeError('System messages must lead conversation');
      }
    }
    if (!seen) {
      throw new TypeError('Conversation required');
    }
    if (
      options.signal !== undefined &&
      !(options.signal instanceof AbortSignal)
    ) {
      throw new TypeError('Invalid cancellation signal');
    }
    if (
      options.maxTokens !== undefined &&
      (!Number.isSafeInteger(options.maxTokens) ||
        options.maxTokens < 1 ||
        options.maxTokens > 1000000)
    ) {
      throw new TypeError('Invalid maxTokens');
    }
    if (
      (options.temperature !== undefined &&
        (!Number.isFinite(options.temperature) ||
          options.temperature < 0 ||
          options.temperature > (kind === 'anthropic' ? 1 : 2))) ||
      (options.topP !== undefined &&
        (!Number.isFinite(options.topP) ||
          options.topP < 0 ||
          options.topP > 1))
    ) {
      throw new TypeError('Invalid sampling');
    }
    if (
      kind === 'anthropic' &&
      version === '2026-10-21' &&
      (options.temperature !== undefined || options.topP !== undefined)
    ) {
      throw new TypeError(
        'Sampling options unavailable in Anthropic API 2026-10-21'
      );
    }
    /** Leading system text merged for the wire version that uses separate system fields. */
    const systems = copied
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    /** Non-system conversation retained in order; no generated tool calls are executed. */
    const turns = copied.filter((m) => m.role !== 'system');
    /** Provider-specific declared wire fields; unknown request options were rejected earlier. */
    const payload: any =
      kind === 'anthropic'
        ? {
            model,
            messages: version === '2026-10-21' ? copied : turns,
            system: version === '2023-06-01' && systems ? systems : undefined,
            max_tokens: options.maxTokens ?? 1024,
            temperature: options.temperature,
            top_p: options.topP,
            stream,
          }
        : {
            contents: turns.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts:
                typeof m.content === 'string'
                  ? [{ text: m.content }]
                  : m.content,
            })),
            systemInstruction: systems
              ? { parts: [{ text: systems }] }
              : undefined,
            generationConfig: {
              maxOutputTokens: options.maxTokens,
              temperature: options.temperature,
              topP: options.topP,
              candidateCount: 1,
            },
          };
    if (output) {
      if (kind === 'anthropic') {
        payload.output_config = {
          format: { type: 'json_schema', schema: output.schema },
        };
      } else {
        payload.generationConfig.responseMimeType = 'application/json';
        payload.generationConfig.responseJsonSchema = output.schema;
      }
    }
    /** Final JSON serialization is byte-checked after all media/schema overhead. */
    const encoded = JSON.stringify(payload);
    if (new TextEncoder().encode(encoded).length > maxRequest) {
      throw new RangeError('Provider request exceeds size limit');
    }
    return encoded;
  }
  /**
   * Dispatch once and transfer a response cleanup lease only after status/MIME/budget validation.
   * @param {(ChatMessage | AiContentMessage)[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
   * @param {AiContentOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
   * @param {boolean} stream - Whether to request SSE rather than buffered JSON.
   * @param {unknown} contentMode - Enable the explicit inert multipart input path; defaults false.
   * @returns {Promise<object>} Validated response lease, effective signal and limits; every consumer must release it.
   */
  async function send(
    messages: (ChatMessage | AiContentMessage)[],
    options: AiContentOptions,
    stream: boolean,
    contentMode = false
  ) {
    if (
      options.maxResponseBytes !== undefined &&
      (!Number.isSafeInteger(options.maxResponseBytes) ||
        options.maxResponseBytes < 1 ||
        options.maxResponseBytes > 67108864)
    ) {
      throw new TypeError('Invalid response budget');
    }
    /** Per-call override can only narrow the configured native response budget. */
    const responseLimit = Math.min(
      maxResponse,
      options.maxResponseBytes ?? maxResponse
    );
    /** Validated buffered JSON configuration; streams cannot claim validated structured output. */
    const output = contentMode
      ? prepareJsonOutput(options.output, stream)
      : undefined;
    /** Final JSON serialization is byte-checked after all media/schema overhead. */
    const encoded = body(messages, options, stream, contentMode, output);
    /** Request-local cancellation owner joins caller cancellation and the native deadline. */
    const controller = new AbortController();
    /**
     * Request cancellation of owned request/reader work; final cleanup retains settlement ownership.
     * @returns {void} No value; only requests cancellation and never forces native settlement.
     */
    const abort = () => controller.abort();
    options.signal?.throwIfAborted();
    options.signal?.addEventListener('abort', abort, { once: true });
    /** Owned request deadline is cleared only when the response lease is released. */
    const timer = setTimeout(abort, timeout);
    let response: Response | undefined;
    /**
     * Abort this request and remove its timer/listener before cancelling an unlocked body.
     * @returns {Promise<void>} Resolves after owned response cancellation; no borrowed pools are closed.
     */
    const release = async () => {
      controller.abort();
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => {});
      }
    };
    try {
      /** Fresh credential headers preserve the configured API version and reject redirect disclosure. */
      const headers = new Headers(extra);
      headers.set('content-type', 'application/json');
      headers.set('accept', stream ? 'text/event-stream' : 'application/json');
      headers.set(kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key', key);
      if (kind === 'anthropic') {
        headers.set('anthropic-version', version!);
      }
      /** Fixed native operation URL built from validated base/model, never from model-produced data. */
      const url =
        kind === 'anthropic'
          ? `${base}/messages`
          : `${base}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
      response = await transport(url, {
        method: 'POST',
        headers,
        body: encoded,
        signal: controller.signal,
        redirect: 'error',
      });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        /** Untrusted Retry-After header is parsed and bounded; no retry occurs in this adapter. */
        const retry = response.headers.get('retry-after');
        /** Parsed server-requested wait; the exposed retry hint is capped at one minute. */
        let delay: number | undefined;
        if (retry !== null) {
          if (Number.isFinite(Number(retry))) {
            delay = Number(retry) * 1000;
          } else {
            delay = Date.parse(retry) - Date.now();
          }
        }
        throw new AiProviderError(
          `${kind} provider returned HTTP ${response.status}`,
          response.status,
          [408, 429, 500, 502, 503, 504, 529].includes(response.status),
          delay !== undefined && delay > 0 ? Math.min(delay, 60000) : undefined,
          {
            provider: kind,
            apiVersion: version,
            requestId: (
              response.headers.get('request-id') ??
              response.headers.get('x-request-id') ??
              ''
            ).slice(0, 128),
          }
        );
      }
      if (
        !response.body ||
        Number(response.headers.get('content-length')) > responseLimit
      ) {
        throw new AiProviderError('Invalid or oversized provider response');
      }
      if (
        stream &&
        !/^text\/event-stream(?:;|$)/i.test(
          response.headers.get('content-type') ?? ''
        )
      ) {
        throw new AiProviderError('Expected text/event-stream');
      }
      return {
        response,
        signal: controller.signal,
        release,
        output,
        responseLimit,
      };
    } catch (error) {
      /** Snapshot cancellation before cleanup aborts the controller, preserving the failure category. */
      const cancelled = controller.signal.aborted;
      await release();
      if (error instanceof AiProviderError) {
        throw error;
      }
      throw new AiProviderError(
        cancelled ? 'AI request cancelled or timed out' : 'AI transport failed'
      );
    }
  }
  /**
   * Read bounded UTF-8 JSON, normalize metadata and independently validate requested output.
   * @param {(ChatMessage | AiContentMessage)[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
   * @param {AiContentOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
   * @param {unknown} contentMode - Enable the explicit inert multipart input path; defaults false.
   * @returns {Promise<AiChatResult>} Bounded normalized response, with data only after requested independent validation.
   */
  async function chatResult(
    messages: (ChatMessage | AiContentMessage)[],
    options: AiContentOptions = {},
    contentMode = false
  ): Promise<AiChatResult> {
    /** Owned response lease; every buffered/streaming exit awaits its cleanup. */
    const req = await send(messages, options, false, contentMode);
    try {
      /** Exclusive buffered reader is cancelled/unlocked in finally before response-lease release. */
      const reader = req.response.body!.getReader();
      /** Fatal incremental UTF-8 decoding preserves fragmented code points without replacement. */
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0,
        text = '';
      /**
       * Request cancellation of owned request/reader work; final cleanup retains settlement ownership.
       * @returns {void} No value; only requests cancellation and never forces native settlement.
       */
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      req.signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          req.signal.throwIfAborted();
          /** One native response read; cumulative bytes are charged before decoded text is appended. */
          const item = await reader.read();
          req.signal.throwIfAborted();
          if (item.done) {
            break;
          }
          bytes += item.value.length;
          if (bytes > req.responseLimit) {
            throw new AiProviderError('Provider response exceeds size limit');
          }
          text += decoder.decode(item.value, { stream: true });
        }
        text += decoder.decode();
        return await validateJsonOutput(
          normalize(json(text), kind),
          req.output,
          maxResponse,
          req.signal
        );
      } finally {
        req.signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      throw new AiProviderError('AI response failed');
    } finally {
      await req.release();
    }
  }
  /**
   * Project bounded native frames into text/cumulative metadata without replaying partial output.
   * @param {(ChatMessage | AiContentMessage)[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
   * @param {ChatOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
   * @param {unknown} contentMode - Enable the explicit inert multipart input path; defaults false.
   * @returns {AsyncIterable<AiStreamEvent>} Text deltas and cumulative private metadata; early return releases response ownership.
   */
  async function* streamEvents(
    messages: (ChatMessage | AiContentMessage)[],
    options: ChatOptions = {},
    contentMode = false
  ): AsyncIterable<AiStreamEvent> {
    /** Owned response lease; every buffered/streaming exit awaits its cleanup. */
    const req = await send(messages, options, true, contentMode);
    /** Cumulative provider usage snapshots replace supplied counters rather than summing deltas. */
    const accumulated: AiUsage = {};
    let complete = false,
      started = false,
      finalReason: AiChatResult['finishReason'] = 'unknown';
    try {
      // Consume frames through the reader owner; partial output is never retried.
      for await (const frame of parseAiSseEvents(
        req.response.body!,
        req.responseLimit,
        req.signal
      )) {
        /** Parsed bounded event payload; unrecognized metadata is private data, never instructions. */
        const raw = json(frame);
        if (raw?.error || raw?.type === 'error') {
          throw new AiProviderError(
            `${kind} stream failed`,
            undefined,
            false,
            undefined,
            {
              provider: kind,
              code:
                typeof raw?.error?.type === 'string'
                  ? raw.error.type.slice(0, 64)
                  : undefined,
            }
          );
        }
        let text = '',
          normalized: AiChatResult;
        if (kind === 'anthropic') {
          if (raw?.type === 'message_start') {
            if (started) {
              throw new AiProviderError('Duplicate Anthropic stream start');
            }
            started = true;
            normalized = {
              text: '',
              usage: usage(raw.message?.usage, kind),
              finishReason: 'unknown',
              providerMetadata: raw,
            };
          } else {
            if (
              !started &&
              [
                'content_block_start',
                'content_block_delta',
                'message_delta',
                'message_stop',
              ].includes(raw?.type)
            ) {
              throw new AiProviderError('Invalid Anthropic stream ordering');
            }
            if (raw?.type === 'message_stop') {
              complete = true;
              yield {
                type: 'metadata',
                usage: { ...accumulated },
                finishReason: finalReason,
                providerMetadata: raw,
              };
              break;
            }
            if (
              (raw?.content_block?.type && raw.content_block.type !== 'text') ||
              raw?.delta?.type === 'input_json_delta'
            ) {
              throw new AiProviderError(
                'Unsupported non-text provider content'
              );
            }
            if (
              raw?.type === 'content_block_start' &&
              raw.content_block?.type === 'text'
            ) {
              if (typeof raw.content_block.text !== 'string') {
                throw new AiProviderError('Invalid streamed text');
              }
              text = raw.content_block.text;
            }
            if (
              raw?.type === 'content_block_delta' &&
              raw.delta?.type === 'text_delta'
            ) {
              if (typeof raw.delta.text !== 'string') {
                throw new AiProviderError('Invalid streamed text');
              }
              text = raw.delta.text;
            }
            normalized = {
              text,
              usage: usage(raw.usage, kind),
              finishReason: finish(raw.delta?.stop_reason),
              providerMetadata: raw,
            };
          }
        } else {
          normalized = normalize(raw, kind);
          text = normalized.text;
          if (
            raw.candidates?.[0]?.finishReason ||
            raw.promptFeedback?.blockReason
          ) {
            complete = true;
          }
        }
        // Provider usage is a cumulative snapshot: replace supplied fields, never add frame totals.
        for (const field of [
          'inputTokens',
          'outputTokens',
          'totalTokens',
        ] as const) {
          if (normalized.usage[field] !== undefined) {
            accumulated[field] = normalized.usage[field];
          }
        }
        if (normalized.finishReason !== 'unknown') {
          finalReason = normalized.finishReason;
        }
        if (text) {
          yield { type: 'text', text };
        }
        yield {
          type: 'metadata',
          usage: { ...accumulated },
          finishReason: finalReason,
          providerMetadata: raw,
        };
      }
      if (!complete) {
        throw new AiProviderError('Incomplete provider stream');
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      throw new AiProviderError('AI stream failed');
    } finally {
      await req.release();
    }
  }
  return withConcurrencyLimit(
    {
      capabilities,
      chatResult,
      streamEvents,
      /**
       * Use the inert multimodal encoding path with buffered optional JSON validation.
       * @param {ChatMessage[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
       * @param {ChatOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
       * @returns {Promise<AiChatResult>} Buffered native content result with optional independently validated JSON.
       */
      chatContent: (messages, options) => chatResult(messages, options, true),
      /**
       * Use the inert multimodal path for unvalidated text/metadata streaming.
       * @param {ChatMessage[]} messages - Authorized conversation data, snapshotted and bounded before dispatch.
       * @param {ChatOptions} options - Host-owned validated settings; see the associated option contract for limits and ownership.
       * @returns {AsyncIterable<AiStreamEvent>} Unvalidated partial text/metadata events, with owned iterator cleanup.
       */
      streamContent: (messages, options) =>
        streamEvents(messages, options, true),
      /**
       * Project the rich buffered response into the compatible text-only API.
       * @param {ChatMessage[]} m - Authorized text conversation forwarded to the rich buffered/streaming implementation.
       * @param {ChatOptions | undefined} o - Optional per-call generation controls and cancellation.
       * @returns {Promise<string>} Compatible buffered text projection, without automatic retry or tool execution.
       */
      async chat(m, o) {
        return (await chatResult(m, o)).text;
      },
      /**
       * Project text events only and propagate iterator cleanup to the native event stream.
       * @param {ChatMessage[]} m - Authorized text conversation forwarded to the rich buffered/streaming implementation.
       * @param {ChatOptions | undefined} o - Optional per-call generation controls and cancellation.
       * @returns {AsyncIterable<string>} Text-only deltas; iterator close also closes the native event iterator.
       */
      async *stream(m, o) {
        // Legacy streaming exposes text only while retaining native iterator cleanup.
        for await (const e of streamEvents(m, o)) {
          if (e.type === 'text') {
            yield e.text;
          }
        }
      },
    },
    {
      maxConcurrent: config.maxConcurrent ?? 4,
      maxQueued: config.maxQueued ?? 16,
    }
  );
}
/**
 * Construct the explicit-version Messages adapter without issuing requests.
 * @param {AnthropicProviderConfig} config - Private host credential/endpoint/budget configuration.
 * @returns {AiProvider} Explicit-version native provider; no request starts on construction.
 * @throws {TypeError | RangeError} On invalid credentials, wire version, endpoint or configured budget.
 */
export function createAnthropicProvider(
  config: AnthropicProviderConfig
): AiProvider {
  if (!config || !['2023-06-01', '2026-10-21'].includes(config.apiVersion)) {
    throw new TypeError('Explicit Anthropic API version required');
  }
  return adapter('anthropic', config, config.apiVersion);
}
/**
 * Construct the generateContent v1beta adapter without issuing requests.
 * @param {ModelProviderConfig} config - Private host credential/endpoint/budget configuration.
 * @returns {AiProvider} Native generateContent v1beta provider; no request starts on construction.
 * @throws {TypeError | RangeError} On invalid credentials, wire version, endpoint or configured budget.
 */
export function createGeminiProvider(config: ModelProviderConfig): AiProvider {
  return adapter('gemini', config);
}
