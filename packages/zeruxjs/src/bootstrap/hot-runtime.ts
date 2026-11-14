/**
 * Serializes development rebuilds and swaps only fully prepared application
 * generations. A failed prepare leaves the previous generation available.
 */
export interface HotRuntimeStatus {
  /** Successful active generation number, starting at one. */
  generation: number;
  /** Attempted queued replacements. */
  attempts: number;
  /** Failed replacement attempts. */
  failures: number;
  /** Whether an actual replacement attempt is unsettled. */
  rebuilding: boolean;
  /** Whether new replacement admission has ended. */
  closed: boolean;
  /** Fixed safe failure summary, never raw private causes. */
  lastError: string | null;
}

/** Own serialized generation replacement; failed preparation preserves the current generation and cleanup failure never silently rolls activation back.
 * @param {T} initial - Already prepared/activated initial generation.
 * @param {{ prepare: () => Promise<T>; activate: (next: T) => void; dispose: (generation: T) => Promise<void> | void; }} options - Trusted preparation, activation and disposal operations.
 * @param {() => Promise<T>} options.prepare - Prepare an independent candidate.
 * @param {(next: T) => void} options.activate - Publish only a complete candidate.
 * @param {(generation: T) => Promise<void> | void} options.dispose - Dispose owned generations after retirement.
 * @returns {object} Explicit reload/close/status/current operations with no server binding.
 */
export function createHotRuntime<T>(
  initial: T,
  options: {
    prepare: () => Promise<T>;
    activate: (next: T) => void;
    dispose: (generation: T) => Promise<void> | void;
  }
) {
  let current = initial;
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let generation = 1;
  let attempts = 0;
  let failures = 0;
  let rebuilding = false;
  let lastError: string | null = null;
  /** Snapshot fixed generation counters and safe failure summaries.
   * @returns {HotRuntimeStatus} Current process-local generation status.
   */
  const status = (): HotRuntimeStatus => ({
    generation,
    attempts,
    failures,
    rebuilding,
    closed,
    lastError,
  });
  /** Serialize one complete candidate preparation/activation before retiring the previous generation.
   * @returns {Promise<HotRuntimeStatus>} Activated status or a preparation failure.
   */
  const reload = (): Promise<HotRuntimeStatus> => {
    if (closed) {
      return Promise.reject(new Error('Development runtime has closed'));
    }
    /** Run one queued replacement while retaining the current generation on preparation/activation failure.
     * @returns {Promise<void>} Actual preparation/cleanup settlement.
     */
    const attempt = async () => {
      if (closed) {
        return;
      }
      attempts++;
      rebuilding = true;
      try {
        /** Prepared candidate or serialized attempt promise, never exposed before activation succeeds. */
        const next = await options.prepare();
        if (closed) {
          await options.dispose(next);
          return;
        }
        try {
          options.activate(next);
        } catch (error) {
          await options.dispose(next);
          throw error;
        }
        /** Previously active generation disposed only after the new candidate becomes current. */
        const previous = current;
        current = next;
        generation++;
        lastError = null;
        // Dispose failures must not roll back a successfully activated generation.
        try {
          await options.dispose(previous);
        } catch (error) {
          lastError = 'Previous generation cleanup failed';
        }
      } catch (error) {
        failures++;
        lastError = 'Application generation preparation failed';
        throw error;
      } finally {
        rebuilding = false;
      }
    };
    /** Prepared candidate or serialized attempt promise, never exposed before activation succeeds. */
    const next = queue.then(attempt, attempt);
    queue = next.catch(() => {});
    return next.then(status);
  };
  /** Stop admission and dispose the current generation after queued replacement work settles.
   * @returns {Promise<void>} Shared idempotent cleanup promise.
   */
  const close = (): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }
    closed = true;
    closePromise = queue.then(() => options.dispose(current));
    return closePromise;
  };
  return { reload, close, status, current: () => current };
}
