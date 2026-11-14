import type {
  AiProvider,
  ChatMessage,
  ChatOptions,
  AiContentMessage,
  AiContentOptions,
} from './types.js';
import { AiProviderError } from './types.js';

/**
 * Provide prompt conveniences over a borrowed text provider without owning transport.
 * @param {AiProvider} provider - Explicit authorized provider; no discovery or close is added.
 * @returns {object} Buffered/streaming text methods forwarding caller options unchanged.
 */
export function createAiClient(provider: AiProvider) {
  return {
    /**
     * Delegate buffered generation under this wrapper’s explicit policy.
     * @param {string} prompt - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {Promise<string>} Provider output; failures remain observable to the caller.
     */
    complete: (prompt: string, options?: ChatOptions) =>
      provider.chat([{ role: 'user', content: prompt }], options),
    /**
     * Delegate buffered generation under this wrapper’s explicit policy.
     * @param {ChatMessage[]} messages - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {Promise<string>} Provider output; failures remain observable to the caller.
     */
    chat: (messages: ChatMessage[], options?: ChatOptions) =>
      provider.chat(messages, options),
    /**
     * Forward streaming without retry; consumers must close abandoned iterators.
     * @param {ChatMessage[]} messages - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {AsyncIterable<string>} Provider output; failures remain observable to the caller.
     */
    stream: (
      messages: ChatMessage[],
      options?: ChatOptions
    ): AsyncIterable<string> =>
      provider.stream
        ? provider.stream(messages, options)
        : (async function* () {
            yield await provider.chat(messages, options);
          })(),
    /**
     * Forward streaming without retry; consumers must close abandoned iterators.
     * @param {string} prompt - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {AsyncIterable<string>} Provider output; failures remain observable to the caller.
     */
    streamComplete: (
      prompt: string,
      options?: ChatOptions
    ): AsyncIterable<string> =>
      provider.stream
        ? provider.stream([{ role: 'user', content: prompt }], options)
        : (async function* () {
            yield await provider.chat(
              [{ role: 'user', content: prompt }],
              options
            );
          })(),
  };
}
/**
 * Opt into cross-provider fallback before any streamed text has been emitted.
 * @param {AiProvider} primary - First borrowed provider; no calls occur on construction.
 * @param {AiProvider} secondary - Authorized fallback; host approves disclosure to both providers.
 * @returns {AiProvider} Legacy text-only projection, not a single-attempt or rich-usage provider.
 */
export function withFallback(
  primary: AiProvider,
  secondary: AiProvider
): AiProvider {
  return {
    capabilities: Object.freeze({
      /** Text chat is supplied by this legacy projection. */
      chat: true,
      /** A buffered provider can still supply a single yielded text result. */
      stream: true,
      tools:
        primary.capabilities?.tools === true ||
        secondary.capabilities?.tools === true,
      usage: false,
      jsonOutput: false,
      singleAttempt: false,
    }),
    /**
     * Delegate buffered generation under this wrapper’s explicit policy.
     * @param {ChatMessage[]} messages - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {Promise<string>} Provider output; failures remain observable to the caller.
     */
    async chat(messages, options) {
      try {
        return await primary.chat(messages, options);
      } catch (error) {
        if (options?.signal?.aborted) {
          throw error;
        }
        return secondary.chat(messages, options);
      }
    },
    /**
     * Forward streaming without retry; consumers must close abandoned iterators.
     * @param {ChatMessage[]} messages - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {AsyncIterable<string>} Provider output; failures remain observable to the caller.
     */
    async *stream(messages, options) {
      if (!primary.stream) {
        // A provider without streaming still needs the same pre-output
        // failover as chat(). Never switch providers after bytes are emitted.
        try {
          yield await primary.chat(messages, options);
        } catch (error) {
          if (options?.signal?.aborted) {
            throw error;
          }
          if (secondary.stream) {
            yield* secondary.stream(messages, options);
          } else {
            yield await secondary.chat(messages, options);
          }
        }
        return;
      }
      let emitted = false;
      try {
        // The first yielded chunk permanently fences cross-provider stream fallback.
        for await (const chunk of primary.stream(messages, options)) {
          emitted = true;
          yield chunk;
        }
      } catch (error) {
        // Never switch providers after output: this would duplicate parts of an answer.
        if (emitted || options?.signal?.aborted) {
          throw error;
        }
        if (secondary.stream) {
          yield* secondary.stream(messages, options);
        } else {
          yield await secondary.chat(messages, options);
        }
      }
    },
  };
}
/**
 * Retry only explicitly retryable buffered failures within a finite attempt budget.
 * @param {AiProvider} provider - Borrowed transport; never wrap tool side effects in retries.
 * @param {object} config - Optional retry policy; streams are forwarded without replay.
 * @param {number} [config.attempts=3] - Total attempts, integer from 1 through 10.
 * @param {number} [config.delayMs=200] - Nonnegative base exponential delay in milliseconds.
 * @param {number} [config.maxDelayMs=10000] - Nonnegative cap including Retry-After delay.
 * @returns {AiProvider} Wrapper retaining optional rich methods and declared capabilities.
 * @throws {RangeError} On invalid policy; original failures propagate when retry is denied.
 */
export function withRetry(
  provider: AiProvider,
  config: { attempts?: number; delayMs?: number; maxDelayMs?: number } = {}
): AiProvider {
  /** Total call budget includes the initial buffered attempt. */
  const attempts = config.attempts ?? 3;
  /** Base delay applies only after a typed retryable failure. */
  const delay = config.delayMs ?? 200;
  /** The host caps both exponential waiting and server-requested Retry-After. */
  const cap = config.maxDelayMs ?? 10000;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 10 ||
    !Number.isFinite(delay) ||
    delay < 0 ||
    !Number.isFinite(cap) ||
    cap < 0
  ) {
    throw new RangeError('Invalid retry configuration');
  }
  /**
   * Run a buffered call with abortable waits, preserving the original terminal failure.
   * @template T
   * @param {() => Promise<T>} run - Buffered provider operation; never a stream or tool action.
   * @param {ChatOptions | undefined} options - Optional signal consulted before another attempt.
   * @returns {Promise<T>} First successful result or the terminal operation/abort failure.
   */
  const retry = async <T>(
    run: () => Promise<T>,
    options?: ChatOptions
  ): Promise<T> => {
    for (let i = 0; ; i++) {
      try {
        return await run();
      } catch (error) {
        if (
          i >= attempts - 1 ||
          options?.signal?.aborted ||
          !(error instanceof AiProviderError && error.retryable)
        ) {
          throw error;
        }
        /** Choose a bounded wait without assuming a retry can undo an earlier mutation. */
        const time = Math.min(
          cap,
          Math.max(error.retryAfterMs ?? 0, delay * 2 ** i)
        );
        await new Promise<void>((resolve, reject) => {
          /**
           * Cancel only this wait and reject with the caller's cancellation reason.
           * @returns {void} The one-shot abort listener removes itself when fired.
           */
          const abort = () => {
            clearTimeout(timer);
            reject(options?.signal?.reason ?? new Error('Aborted'));
          };
          /** Timer owns the abort listener until it resolves; abort clears the timer. */
          const timer = setTimeout(() => {
            options?.signal?.removeEventListener('abort', abort);
            resolve();
          }, time);
          if (options?.signal?.aborted) {
            abort();
          } else {
            options?.signal?.addEventListener('abort', abort, { once: true });
          }
        });
      }
    }
  };
  return {
    capabilities: provider.capabilities
      ? Object.freeze({
          ...provider.capabilities,
          singleAttempt:
            attempts === 1 ? provider.capabilities.singleAttempt : false,
        })
      : undefined,
    ...(provider.chatContent
      ? {
          /**
           * Delegate buffered generation under this wrapper’s explicit policy.
           * @param {AiContentMessage[]} messages - Authorized inert conversation input.
           * @param {AiContentOptions | undefined} options - Optional generation settings and cancellation.
           * @returns {Promise<AiChatResult>} Provider output; failures remain observable to the caller.
           */
          chatContent: (
            messages: AiContentMessage[],
            options?: AiContentOptions
          ) => retry(() => provider.chatContent!(messages, options), options),
        }
      : {}),
    ...(provider.streamContent
      ? {
          /**
           * Forward streaming without retry; consumers must close abandoned iterators.
           * @param {AiContentMessage[]} messages - Authorized inert conversation input.
           * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
           * @returns {AsyncIterable<AiStreamEvent>} Provider output; failures remain observable to the caller.
           */
          streamContent: (
            messages: AiContentMessage[],
            options?: ChatOptions
          ) => provider.streamContent!(messages, options),
        }
      : {}),
    /**
     * Delegate buffered generation under this wrapper’s explicit policy.
     * @param {ChatMessage[]} messages - Authorized inert conversation input.
     * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
     * @returns {Promise<string>} Provider output; failures remain observable to the caller.
     */
    chat: (messages, options) =>
      retry(() => provider.chat(messages, options), options),
    ...(provider.chatResult
      ? {
          /**
           * Delegate buffered generation under this wrapper’s explicit policy.
           * @param {ChatMessage[]} messages - Authorized inert conversation input.
           * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
           * @returns {Promise<AiChatResult>} Provider output; failures remain observable to the caller.
           */
          chatResult: (messages: ChatMessage[], options?: ChatOptions) =>
            retry(() => provider.chatResult!(messages, options), options),
        }
      : {}),
    ...(provider.stream
      ? {
          /**
           * Forward streaming without retry; consumers must close abandoned iterators.
           * @param {ChatMessage[]} messages - Authorized inert conversation input.
           * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
           * @returns {AsyncIterable<string>} Provider output; failures remain observable to the caller.
           */
          stream: (messages: ChatMessage[], options?: ChatOptions) =>
            provider.stream!(messages, options),
        }
      : {}),
    ...(provider.streamEvents
      ? {
          /**
           * Forward streaming without retry; consumers must close abandoned iterators.
           * @param {ChatMessage[]} messages - Authorized inert conversation input.
           * @param {ChatOptions | undefined} options - Optional generation settings and cancellation.
           * @returns {AsyncIterable<AiStreamEvent>} Provider output; failures remain observable to the caller.
           */
          streamEvents: (messages: ChatMessage[], options?: ChatOptions) =>
            provider.streamEvents!(messages, options),
        }
      : {}),
  };
}
