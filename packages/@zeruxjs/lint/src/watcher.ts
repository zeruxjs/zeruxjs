import { startWatcher } from 'zwatch';
import path from 'node:path';
/** Debounced and serialized watcher with a disposer. */
export function watchFiles(callback: () => Promise<void> | void, options: { cwd?: string; debounceMs?: number; onError?: (error: Error) => void } = {}): () => void {
  let busy = false, dirty = false, disposed = false;
  const trigger = async (): Promise<void> => {
    if (disposed) return;
    if (busy) { dirty = true; return; }
    busy = true;
    try {
      do {
        dirty = false;
        try { await callback(); } catch (error) { options.onError?.(error instanceof Error ? error : new Error(String(error))); }
      } while (dirty && !disposed);
    } finally { busy = false; }
  };
  const unsubscribe = startWatcher(path.resolve(options.cwd ?? process.cwd()), () => { void trigger(); }, { debounceMs: options.debounceMs ?? 150, onError: options.onError });
  return () => { disposed = true; unsubscribe(); };
}
