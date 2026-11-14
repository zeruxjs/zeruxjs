import { startWatcher } from 'zlook';
import path from 'node:path';
/** Observe files with debounced serialized callbacks and return the owned registration disposer.
 * @param {() => Promise<void> | void} callback - Host-owned async work; disposal cannot force-stop an already active callback.
 * @param {{ cwd?: string; debounceMs?: number; onError?: (error: Error) => void; }} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @param {string} [options.cwd] - Project watch directory; defaults to process.cwd().
 * @param {number} [options.debounceMs=150] - Debounce forwarded to the owned zlook registration.
 * @param {(error: Error) => void} [options.onError] - Callback for observed check/watch failures; must handle its own errors.
 * @returns {() => void} Owned disposer; stops new observation but does not force-cancel active work.
 * @throws {Error} For registration failures; disposal stops new observation, not already-running callback code.
 */
export function watchFiles(
  callback: () => Promise<void> | void,
  options: {
    cwd?: string;
    debounceMs?: number;
    onError?: (error: Error) => void;
  } = {}
): () => void {
  let busy = false,
    dirty = false,
    disposed = false;
  /** Serialized callback dispatcher; bursts set dirty rather than overlap owned work.
   * @returns {Promise<void>} Resolves after serialized checks finish; callback failures go to the host error handler.
   */
  const trigger = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    try {
      do {
        dirty = false;
        try {
          await callback();
        } catch (error) {
          options.onError?.(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      } while (dirty && !disposed);
    } finally {
      busy = false;
    }
  };
  /** Owned zlook registration; disposal stops observation without force-cancelling active JavaScript. */
  const unsubscribe = startWatcher(
    path.resolve(options.cwd ?? process.cwd()),
    () => {
      void trigger();
    },
    { debounceMs: options.debounceMs ?? 150, onError: options.onError }
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}
