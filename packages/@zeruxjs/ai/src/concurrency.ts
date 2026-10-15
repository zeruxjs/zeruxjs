import type { AiProvider, ChatOptions } from './types.js';

export interface AiConcurrencyOptions { maxConcurrent: number; maxQueued?: number }
/** Fair FIFO admission for chat and streaming; a streaming slot is held until iterator closes. */
export function withConcurrencyLimit(provider: AiProvider, options: AiConcurrencyOptions): AiProvider & { status(): { active: number; queued: number } } {
  const max = options.maxConcurrent, maxQueued = options.maxQueued ?? 100;
  if (!Number.isSafeInteger(max) || max < 1 || max > 1000 || !Number.isSafeInteger(maxQueued) || maxQueued < 0 || maxQueued > 100000) throw new RangeError('Invalid concurrency limits');
  let active = 0;
  const queue: Array<{resolve: () => void; reject: (reason: unknown) => void; signal?: AbortSignal; onAbort: () => void}> = [];
  const release = () => {
    active--;
    while (queue.length) {
      const item = queue.shift()!;
      item.signal?.removeEventListener('abort', item.onAbort);
      if (item.signal?.aborted) { item.reject(item.signal.reason ?? new Error('Aborted')); continue; }
      active++; item.resolve(); break;
    }
  };
  const acquire = async (signal?: AbortSignal): Promise<() => void> => {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    if (active < max && queue.length === 0) { active++; return release; }
    if (queue.length >= maxQueued) throw new Error('AI request queue is full');
    await new Promise<void>((resolve,reject) => {
      const item = { resolve, reject, signal, onAbort: () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index,1);
        signal?.removeEventListener('abort', item.onAbort);
        reject(signal?.reason ?? new Error('Aborted'));
      } };
      queue.push(item);
      signal?.addEventListener('abort', item.onAbort, { once: true });
    });
    return release;
  };
  return {
    status: () => ({ active, queued: queue.length }),
    async chat(messages, opts?: ChatOptions) {
      const done = await acquire(opts?.signal);
      try { return await provider.chat(messages, opts); } finally { done(); }
    },
    async *stream(messages, opts?: ChatOptions) {
      const done = await acquire(opts?.signal);
      try {
        if (provider.stream) yield* provider.stream(messages, opts);
        else yield await provider.chat(messages,opts);
      } finally { done(); }
    },
  };
}
