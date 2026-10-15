/** Reactive protocol resources with explicit lifecycle (safe for SSR and component unmount). */
import { signal } from '../reactivity/signal.js';
import type { ReadonlySignal } from '../reactivity/types.js';
import { QueryCache, type CacheQueryOptions } from './cache.js';
import { readEventStream, type EventStreamOptions, type ServerEvent } from './events.js';

export interface RemoteResource<T> {
  readonly data: ReadonlySignal<T | undefined>;
  readonly loading: ReadonlySignal<boolean>;
  readonly error: ReadonlySignal<unknown>;
  refresh(options?: { signal?: AbortSignal }): Promise<T>;
  cancel(): void;
  dispose(): void;
}
export function createRemoteResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options: { cache?: QueryCache; key?: string; cacheOptions?: CacheQueryOptions } = {}
): RemoteResource<T> {
  const data = signal<T | undefined>(undefined);
  const loading = signal(false);
  const error = signal<unknown>(undefined);
  let controller: AbortController | undefined;
  let active = true;
  let sequence = 0;
  const cancel = () => { sequence++; controller?.abort(); controller = undefined; loading.value = false; };
  return {
    data, loading, error,
    async refresh({ signal: external } = {}) {
      if (!active) throw new Error('Resource disposed');
      cancel(); const current = sequence;
      controller = new AbortController();
      const internal = controller;
      const abort = () => internal.abort(external?.reason);
      if (external?.aborted) abort(); else external?.addEventListener('abort', abort, { once: true });
      loading.value = true; error.value = undefined;
      try {
        const load = () => loader(internal.signal);
        const result = options.cache && options.key
          ? await options.cache.query(options.key, load, { ...options.cacheOptions, signal: internal.signal })
          : await load();
        if (!active || current !== sequence || internal.signal.aborted) throw Object.assign(new Error('Resource request cancelled'), { name: 'AbortError' });
        data.value = result;
        return result;
      } catch (cause) {
        if (active && current === sequence && !internal.signal.aborted) error.value = cause;
        throw cause;
      } finally {
        external?.removeEventListener('abort', abort);
        if (active && current === sequence) { loading.value = false; controller = undefined; }
      }
    },
    cancel,
    dispose() { if (active) { active = false; cancel(); } }
  };
}

export interface EventChannel {
  readonly connected: ReadonlySignal<boolean>;
  readonly latest: ReadonlySignal<ServerEvent | undefined>;
  readonly error: ReadonlySignal<unknown>;
  start(): Promise<void>;
  stop(): void;
}
/** Controlled SSE subscription. No connection starts during SSR/render; call start() explicitly. */
export function createEventChannel(url: string, options: EventStreamOptions & { reconnectMs?: number; maxReconnects?: number } = {}): EventChannel {
  const connected = signal(false);
  const latest = signal<ServerEvent | undefined>(undefined);
  const error = signal<unknown>(undefined);
  let controller: AbortController | undefined;
  let currentTask: Promise<void> | undefined;
  let cursor = options.lastEventId;
  const reconnectMs = options.reconnectMs ?? 1000;
  const maxReconnects = options.maxReconnects ?? 0;
  if (!Number.isSafeInteger(reconnectMs) || reconnectMs < 100 || reconnectMs > 120000 || !Number.isSafeInteger(maxReconnects) || maxReconnects < 0 || maxReconnects > 10000) throw new RangeError('Invalid event reconnect policy');
  const stop = () => { controller?.abort(); controller = undefined; connected.value = false; };
  return {
    connected, latest, error,
    async start() {
      if (currentTask) return currentTask;
      controller = new AbortController();
      const active = controller;
      const external = options.signal;
      const abort = () => active.abort(external?.reason);
      if (external?.aborted) abort(); else external?.addEventListener('abort', abort, { once: true });
      const task = (async () => {
        let attempts = 0;
        try {
          while (!active.signal.aborted) {
            try {
              for await (const event of readEventStream(url, { ...options, signal: active.signal, lastEventId: cursor })) {
                connected.value = true; latest.value = event;
                if (event.id !== undefined) cursor = event.id;
              }
              connected.value = false;
              if (attempts >= maxReconnects) break;
            } catch (cause) {
              connected.value = false;
              if (active.signal.aborted) break;
              error.value = cause;
              if (attempts >= maxReconnects) throw cause;
            }
            attempts++;
            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, reconnectMs);
              active.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
            });
          }
        } finally { connected.value = false; external?.removeEventListener('abort', abort); if (controller === active) controller = undefined; }
      })();
      currentTask = task;
      try { await task; } finally { if (currentTask === task) currentTask = undefined; }
    },
    stop
  };
}
