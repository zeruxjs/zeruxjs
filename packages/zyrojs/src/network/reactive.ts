/** Reactive protocol resources with explicit lifecycle (safe for SSR and component unmount). */
import { signal } from '../reactivity/signal.js';
import type { ReadonlySignal } from '../reactivity/types.js';
import { QueryCache, type CacheQueryOptions } from './cache.js';
import {
  readEventStream,
  type EventStreamOptions,
  type ServerEvent,
} from './events.js';

export interface RemoteResource<T> {
  /** Latest settled value, or undefined before the first successful load. */
  readonly data: ReadonlySignal<T | undefined>;
  /** Whether a refresh currently owns active loader work. */
  readonly loading: ReadonlySignal<boolean>;
  /** Most recent loader failure, or undefined after a successful load. */
  readonly error: ReadonlySignal<unknown>;
  refresh(options?: { signal?: AbortSignal }): Promise<T>;
  cancel(): void;
  dispose(): void;
}
/**
 * createRemoteResource.
 * @param {(signal: AbortSignal) => Promise<T>} loader - Input value for this operation.
 * @param {{
    cache?: QueryCache;
    key?: string;
    cacheOptions?: CacheQueryOptions;
  }} options - Input value for this operation.
 * @param {QueryCache} options.cache - Optional instance-owned cache.
 * @param {string} options.key - Optional stable cache key.
 * @param {CacheQueryOptions} options.cacheOptions - Optional cache policy.
 * @returns {RemoteResource<T>} Result produced by this operation.
 */
export function createRemoteResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options: {
    cache?: QueryCache;
    key?: string;
    cacheOptions?: CacheQueryOptions;
  } = {}
): RemoteResource<T> {
  /** Stores the data value used by this module. */
  const data = signal<T | undefined>(undefined);
  /** Stores the loading value used by this module. */
  const loading = signal(false);
  /** Stores the error value used by this module. */
  const error = signal<unknown>(undefined);
  let controller: AbortController | undefined;
  let active = true;
  let sequence = 0;
  /**
   * Application function cancel.
   * @returns {unknown} Result produced by this operation.
   */
  const cancel = () => {
    sequence++;
    controller?.abort();
    controller = undefined;
    loading.value = false;
  };
  return {
    data,
    loading,
    error,
    /**
     * refresh.
     * @param {unknown} root0 - Input value for this operation.
     * @param {unknown} root0.external - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    async refresh({ signal: external } = {}) {
      if (!active) {
        throw new Error('Resource disposed');
      }
      cancel();
      /** Stores the current value used by this module. */
      const current = sequence;
      controller = new AbortController();
      /** Stores the internal value used by this module. */
      const internal = controller;
      /**
       * Application function abort.
       * @returns {unknown} Result produced by this operation.
       */
      const abort = () => internal.abort(external?.reason);
      if (external?.aborted) {
        abort();
      } else {
        external?.addEventListener('abort', abort, { once: true });
      }
      loading.value = true;
      error.value = undefined;
      try {
        /**
         * Application function load.
         * @returns {unknown} Result produced by this operation.
         */
        const load = () => loader(internal.signal);
        /** Stores the result value used by this module. */
        const result =
          options.cache && options.key
            ? await options.cache.query(options.key, load, {
                ...options.cacheOptions,
                signal: internal.signal,
              })
            : await load();
        if (!active || current !== sequence || internal.signal.aborted) {
          throw Object.assign(new Error('Resource request cancelled'), {
            name: 'AbortError',
          });
        }
        data.value = result;
        return result;
      } catch (cause) {
        if (active && current === sequence && !internal.signal.aborted) {
          error.value = cause;
        }
        throw cause;
      } finally {
        external?.removeEventListener('abort', abort);
        if (active && current === sequence) {
          loading.value = false;
          controller = undefined;
        }
      }
    },
    cancel,
    /**
     * dispose.
     * @returns {unknown} Result produced by this operation.
     */
    dispose() {
      if (active) {
        active = false;
        cancel();
      }
    },
  };
}

export interface EventChannel {
  /** Whether the channel currently owns an active stream reader. */
  readonly connected: ReadonlySignal<boolean>;
  /** Most recent event received from the stream. */
  readonly latest: ReadonlySignal<ServerEvent | undefined>;
  /** Most recent stream failure, if any. */
  readonly error: ReadonlySignal<unknown>;
  /** Start the explicitly controlled event stream. */
  start(): Promise<void>;
  /** Stop the stream and release its reader. */
  stop(): void;
}
/** Controlled SSE subscription. No connection starts during SSR/render; call start() explicitly. */
/**
 * createEventChannel.
 * @param {string} url - Input value for this operation.
 * @param {EventStreamOptions & {
    reconnectMs?: number;
    maxReconnects?: number;
  }} options - Input value for this operation.
 * @returns {EventChannel} Result produced by this operation.
 */
export function createEventChannel(
  url: string,
  options: EventStreamOptions & {
    reconnectMs?: number;
    maxReconnects?: number;
  } = {}
): EventChannel {
  /** Stores the connected value used by this module. */
  const connected = signal(false);
  /** Stores the latest value used by this module. */
  const latest = signal<ServerEvent | undefined>(undefined);
  /** Stores the error value used by this module. */
  const error = signal<unknown>(undefined);
  let controller: AbortController | undefined;
  let currentTask: { promise: Promise<void> } | undefined;
  let cursor = options.lastEventId;
  /** Stores the reconnectMs value used by this module. */
  const reconnectMs = options.reconnectMs ?? 1000;
  /** Stores the maxReconnects value used by this module. */
  const maxReconnects = options.maxReconnects ?? 0;
  if (
    !Number.isSafeInteger(reconnectMs) ||
    reconnectMs < 100 ||
    reconnectMs > 120000 ||
    !Number.isSafeInteger(maxReconnects) ||
    maxReconnects < 0 ||
    maxReconnects > 10000
  ) {
    throw new RangeError('Invalid event reconnect policy');
  }
  /**
   * Application function stop.
   * @returns {unknown} Result produced by this operation.
   */
  const stop = () => {
    controller?.abort();
    controller = undefined;
    connected.value = false;
  };
  return {
    connected,
    latest,
    error,
    /**
     * start.
     * @returns {unknown} Result produced by this operation.
     */
    async start() {
      if (currentTask) {
        return currentTask.promise;
      }
      controller = new AbortController();
      /** Stores the active value used by this module. */
      const active = controller;
      /** Stores the external value used by this module. */
      const external = options.signal;
      /**
       * Application function abort.
       * @returns {unknown} Result produced by this operation.
       */
      const abort = () => active.abort(external?.reason);
      if (external?.aborted) {
        abort();
      } else {
        external?.addEventListener('abort', abort, { once: true });
      }
      /** Stores the task value used by this module. */
      const task = (async () => {
        let attempts = 0;
        try {
          while (!active.signal.aborted) {
            try {
              for await (const event of readEventStream(url, {
                ...options,
                signal: active.signal,
                lastEventId: cursor,
              })) {
                connected.value = true;
                latest.value = event;
                if (event.id !== undefined) {
                  cursor = event.id;
                }
              }
              connected.value = false;
              if (attempts >= maxReconnects) {
                break;
              }
            } catch (cause) {
              connected.value = false;
              if (active.signal.aborted) {
                break;
              }
              error.value = cause;
              if (attempts >= maxReconnects) {
                throw cause;
              }
            }
            attempts++;
            await new Promise<void>((resolve) => {
              /** Stores the timer value used by this module. */
              const timer = setTimeout(resolve, reconnectMs);
              active.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                { once: true }
              );
            });
          }
        } finally {
          connected.value = false;
          external?.removeEventListener('abort', abort);
          if (controller === active) {
            controller = undefined;
          }
        }
      })();
      /** Stores the slot value used by this module. */
      const slot = { promise: task };
      currentTask = slot;
      try {
        await slot.promise;
      } finally {
        if (currentTask === slot) {
          currentTask = undefined;
        }
      }
    },
    stop,
  };
}
