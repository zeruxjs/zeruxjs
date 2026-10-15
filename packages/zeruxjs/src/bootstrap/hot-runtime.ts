/**
 * Serializes development rebuilds and swaps only fully prepared application
 * generations. A failed prepare leaves the previous generation available.
 */
export interface HotRuntimeStatus {
  generation: number;
  attempts: number;
  failures: number;
  rebuilding: boolean;
  closed: boolean;
  lastError: string | null;
}

export function createHotRuntime<T>(initial: T, options: {
  prepare: () => Promise<T>;
  activate: (next: T) => void;
  dispose: (generation: T) => Promise<void> | void;
}) {
  let current = initial;
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let generation = 1;
  let attempts = 0;
  let failures = 0;
  let rebuilding = false;
  let lastError: string | null = null;
  const status = (): HotRuntimeStatus => ({ generation, attempts, failures, rebuilding, closed, lastError });
  const reload = (): Promise<HotRuntimeStatus> => {
    if (closed) return Promise.reject(new Error('Development runtime has closed'));
    const attempt = async () => {
      if (closed) return;
      attempts++;
      rebuilding = true;
      try {
        const next = await options.prepare();
        if (closed) { await options.dispose(next); return; }
        try { options.activate(next); }
        catch (error) { await options.dispose(next); throw error; }
        const previous = current;
        current = next;
        generation++;
        lastError = null;
        // Dispose failures must not roll back a successfully activated generation.
        try { await options.dispose(previous); }
        catch (error) { lastError = `Previous generation cleanup: ${String(error)}`; }
      } catch (error) {
        failures++;
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally { rebuilding = false; }
    };
    const next = queue.then(attempt, attempt);
    queue = next.catch(() => {});
    return next.then(status);
  };
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = queue.then(() => options.dispose(current));
    return closePromise;
  };
  return { reload, close, status, current: () => current };
}
