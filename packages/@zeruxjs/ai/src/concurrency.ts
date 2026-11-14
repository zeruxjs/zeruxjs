import type {
  AiProvider,
  ChatOptions,
  ChatMessage,
  AiContentMessage,
  AiContentOptions,
} from './types.js';

/** FIFO admission limits shared by text and rich provider methods. */
export interface AiConcurrencyOptions {
  /** Maximum unsettled calls/iterators, an integer from 1 through 1000. */
  maxConcurrent: number;
  /** Maximum pending FIFO waiters, default 100, between 0 and 100000. */
  maxQueued?: number;
}
/**
 * Wrap a borrowed provider with one FIFO admission owner for all supported methods.
 * @param {AiProvider} provider - Borrowed provider; this wrapper never closes it.
 * @param {AiConcurrencyOptions} options - Active/queued budgets validated before use.
 * @returns {AiProvider & {status(): {active: number, queued: number}}} Provider wrapper and path-free counters.
 * @throws {RangeError} When limits are invalid; calls reject on overload or cancellation.
 */
export function withConcurrencyLimit(
  provider: AiProvider,
  options: AiConcurrencyOptions
): AiProvider & { status(): { active: number; queued: number } } {
  /** Shared active ceiling includes unsettled work after a cooperative abort. */
  const max = options.maxConcurrent;
  /** Waiter ceiling is independent of the active budget; zero disables queuing. */
  const maxQueued = options.maxQueued ?? 100;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 1000 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 0 ||
    maxQueued > 100000
  ) {
    throw new RangeError('Invalid concurrency limits');
  }
  let active = 0;
  /** Pending callers own abort listeners only until admission or cancellation. */
  const queue: Array<{
    resolve: () => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
    onAbort: () => void;
  }> = [];
  /**
   * Return a settled call's slot and admit the oldest noncancelled waiter.
   * @returns {void} Called exactly once from an admitted method's finally block.
   */
  const release = () => {
    active--;
    while (queue.length) {
      /** Remove before resolving so later admission observes consistent FIFO state. */
      const item = queue.shift()!;
      item.signal?.removeEventListener('abort', item.onAbort);
      if (item.signal?.aborted) {
        item.reject(item.signal.reason ?? new Error('Aborted'));
        continue;
      }
      active++;
      item.resolve();
      break;
    }
  };
  /**
   * Reserve a slot now or wait with an individually removable abort listener.
   * @param {AbortSignal | undefined} signal - Optional cancellation for this caller only.
   * @returns {Promise<() => void>} Release callback, owned by the admitted call.
   * @throws {Error} Rejects on queue overload or with the caller's abort reason.
   */
  const acquire = async (signal?: AbortSignal): Promise<() => void> => {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted');
    }
    if (active < max && queue.length === 0) {
      active++;
      return release;
    }
    if (queue.length >= maxQueued) {
      throw new Error('AI request queue is full');
    }
    await new Promise<void>((resolve, reject) => {
      /** Stable queue identity allows cancellation without disturbing other waiters. */
      const item = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          /** Remove only this pending request; admitted work owns its release. */
          const index = queue.indexOf(item);
          if (index >= 0) {
            queue.splice(index, 1);
          }
          signal?.removeEventListener('abort', item.onAbort);
          reject(signal?.reason ?? new Error('Aborted'));
        },
      };
      queue.push(item);
      signal?.addEventListener('abort', item.onAbort, { once: true });
    });
    return release;
  };
  return {
    /**
     * Read counters without provider names, paths or private request values.
     * @returns {{active: number, queued: number}} Snapshot of unsettled calls and waiters.
     */
    status: () => ({ active, queued: queue.length }),
    capabilities: provider.capabilities,
    ...(provider.chatResult
      ? {
          /**
           * Admit chatResult within the shared budget and release in finally.
           * @param {ChatMessage[]} messages - Conversation forwarded unchanged to the borrowed provider.
           * @param {ChatOptions | undefined} opts - Generation settings and optional cancellation.
           * @returns {Promise<AiChatResult>} Provider result; admission releases after resolve/reject.
           */
          async chatResult(messages: ChatMessage[], opts?: ChatOptions) {
            /** This call owns one release, retained through actual settlement. */
            const done = await acquire(opts?.signal);
            try {
              return await provider.chatResult!(messages, opts);
            } finally {
              done();
            }
          },
        }
      : {}),
    ...(provider.streamEvents
      ? {
          /**
           * Admit streamEvents within the shared budget and release in finally.
           * @param {ChatMessage[]} messages - Conversation forwarded unchanged to the borrowed provider.
           * @param {ChatOptions | undefined} opts - Generation settings and optional cancellation.
           * @returns {AsyncIterable<AiStreamEvent>} Provider result; iterator return also releases admission.
           */
          async *streamEvents(messages: ChatMessage[], opts?: ChatOptions) {
            /** This call owns one release, retained through actual settlement. */
            const done = await acquire(opts?.signal);
            try {
              yield* provider.streamEvents!(messages, opts);
            } finally {
              done();
            }
          },
        }
      : {}),
    ...(provider.chatContent
      ? {
          /**
           * Admit chatContent within the shared budget and release in finally.
           * @param {AiContentMessage[]} messages - Conversation forwarded unchanged to the borrowed provider.
           * @param {AiContentOptions | undefined} opts - Generation settings and optional cancellation.
           * @returns {Promise<AiChatResult>} Provider result; admission releases after resolve/reject.
           */
          async chatContent(
            messages: AiContentMessage[],
            opts?: AiContentOptions
          ) {
            /** This call owns one release, retained through actual settlement. */
            const done = await acquire(opts?.signal);
            try {
              return await provider.chatContent!(messages, opts);
            } finally {
              done();
            }
          },
        }
      : {}),
    ...(provider.streamContent
      ? {
          /**
           * Admit streamContent within the shared budget and release in finally.
           * @param {AiContentMessage[]} messages - Conversation forwarded unchanged to the borrowed provider.
           * @param {ChatOptions | undefined} opts - Generation settings and optional cancellation.
           * @returns {AsyncIterable<AiStreamEvent>} Provider result; iterator return also releases admission.
           */
          async *streamContent(
            messages: AiContentMessage[],
            opts?: ChatOptions
          ) {
            /** This call owns one release, retained through actual settlement. */
            const done = await acquire(opts?.signal);
            try {
              yield* provider.streamContent!(messages, opts);
            } finally {
              done();
            }
          },
        }
      : {}),
    /**
     * Admit chat within the shared budget and release in finally.
     * @param {ChatMessage[]} messages - Conversation forwarded unchanged to the borrowed provider.
     * @param {ChatOptions | undefined} opts - Generation settings and optional cancellation.
     * @returns {Promise<string>} Provider result; admission releases after resolve/reject.
     */
    async chat(messages, opts?: ChatOptions) {
      /** This call owns one release, retained through actual settlement. */
      const done = await acquire(opts?.signal);
      try {
        return await provider.chat(messages, opts);
      } finally {
        done();
      }
    },
    /**
     * Admit stream within the shared budget and release in finally.
     * @param {ChatMessage[]} messages - Conversation forwarded unchanged to the borrowed provider.
     * @param {ChatOptions | undefined} opts - Generation settings and optional cancellation.
     * @returns {AsyncIterable<string>} Provider result; iterator return also releases admission.
     */
    async *stream(messages, opts?: ChatOptions) {
      /** This call owns one release, retained through actual settlement. */
      const done = await acquire(opts?.signal);
      try {
        if (provider.stream) {
          yield* provider.stream(messages, opts);
        } else {
          yield await provider.chat(messages, opts);
        }
      } finally {
        done();
      }
    },
  };
}
