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
 * Create inert reactive state; refresh explicitly starts work and dispose fences future commits.
 * @param {(signal: AbortSignal) => Promise<T>} loader - Trusted loader receiving a cooperative signal; arbitrary promises cannot be forcibly cancelled.
 * @param {{
    cache?: QueryCache;
    key?: string;
    cacheOptions?: CacheQueryOptions;
  }} options - Explicit borrowed cache or stream policy; no work starts until refresh/start.
 * @param {QueryCache} options.cache - Optional instance-owned cache.
 * @param {string} options.key - Optional stable cache key.
 * @param {CacheQueryOptions} options.cacheOptions - Optional cache policy.
 * @returns {RemoteResource<T>} Inert per-owner state with explicit refresh, cancellation and disposal.
 */
export function createRemoteResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options: {
    cache?: QueryCache;
    key?: string;
    cacheOptions?: CacheQueryOptions;
  } = {}
): RemoteResource<T> {
  /** Last successful value; cancellation leaves this visible while fencing future stale commits. */
  const data = signal<T | undefined>(undefined);
  /** Observable wait state, not proof that a noncooperative loader has physically stopped. */
  const loading = signal(false);
  /** Latest current-generation failure; aborted/stale work cannot overwrite it. */
  const error = signal<unknown>(undefined);
  let controller: AbortController | undefined;
  let active = true;
  let sequence = 0;
  /**
   * Invalidate the generation and signal cancellation without erasing the last successful value.
   * @returns {void} Fences stale commits and signals the current loader.
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
     * Supersede the prior generation and reject stale results instead of publishing them.
     * @param {unknown} root0 - Optional per-refresh cancellation options.
     * @param {unknown} root0.external - Borrowed AbortSignal forwarded to this refresh controller.
     * @returns {Promise<T>} Current result, or rejection on failure/cancellation/stale settlement.
     */
    async refresh({ signal: external } = {}) {
      if (!active) {
        throw new Error('Resource disposed');
      }
      cancel();
      /** Captured generation token; cancellation or a newer refresh invalidates this commit. */
      const current = sequence;
      controller = new AbortController();
      /** Refresh-owned controller; external cancellation is forwarded without owning the external signal. */
      const internal = controller;
      /**
       * Forward borrowed-signal cancellation to this invocation’s own controller.
       * @returns {void} Forwards borrowed cancellation to the invocation-owned controller.
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
         * Invoke the configured loader with this refresh’s cancellation signal.
         * @returns {Promise<T>} Actual loader promise; cancellation remains cooperative.
         */
        const load = () => loader(internal.signal);
        /** Loader result commits only after active-generation and abort checks succeed. */
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
     * Permanently disable refresh and signal cancellation; the borrowed cache remains host-owned.
     * @returns {void} Permanently fences future refreshes without destroying a borrowed cache.
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
 * Create an inert SSE owner with explicit start/stop and finite reconnection policy.
 * @param {string} url - Explicit host-approved SSE endpoint; server-side egress policy remains host-owned.
 * @param {EventStreamOptions & {
    reconnectMs?: number;
    maxReconnects?: number;
  }} options - Explicit borrowed cache or stream policy; no work starts until refresh/start.
 * @returns {EventChannel} Inert event state with explicit start/stop ownership.
 */
export function createEventChannel(
  url: string,
  options: EventStreamOptions & {
    reconnectMs?: number;
    maxReconnects?: number;
  } = {}
): EventChannel {
  /** Becomes true after an event is yielded; it is not an HTTP-handshake status. */
  const connected = signal(false);
  /** Last yielded event retained independently of connection state. */
  const latest = signal<ServerEvent | undefined>(undefined);
  /** Latest current-generation failure; aborted/stale work cannot overwrite it. */
  const error = signal<unknown>(undefined);
  let controller: AbortController | undefined;
  let currentTask: { promise: Promise<void> } | undefined;
  let cursor = options.lastEventId;
  /** Validated fixed idle delay; server retry fields do not override this configured policy. */
  const reconnectMs = options.reconnectMs ?? 1000;
  /** Finite retry allowance across this start invocation; zero disables reconnection. */
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
   * Signal the active stream to stop; actual reader settlement remains asynchronous.
   * @returns {void} Signals cancellation; start’s promise observes actual task settlement.
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
     * Join the current stream task or start one explicitly; retain ownership through its settlement.
     * @returns {Promise<void>} Stream/reconnect task settlement, shared by concurrent starts.
     */
    async start() {
      if (currentTask) {
        return currentTask.promise;
      }
      controller = new AbortController();
      /** Controller for this start generation, retained until its stream task settles. */
      const active = controller;
      /** Borrowed host signal; its forwarding listener is removed when the task ends. */
      const external = options.signal;
      /**
       * Forward borrowed-signal cancellation to this invocation’s own controller.
       * @returns {void} Forwards borrowed cancellation to the invocation-owned controller.
       */
      const abort = () => active.abort(external?.reason);
      if (external?.aborted) {
        abort();
      } else {
        external?.addEventListener('abort', abort, { once: true });
      }
      /** Actual stream/reconnect settlement; overlapping starts share this promise. */
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
              /** Owned idle reconnect delay; abort clears it and wakes the loop. */
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
      /** Exact task identity prevents an older finally block from clearing a newer start. */
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
