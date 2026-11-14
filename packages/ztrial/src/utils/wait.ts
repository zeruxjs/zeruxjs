/** Poll a trusted condition sequentially until truthy, deadline or explicit abort; an already-running condition must cooperate with cancellation.
 * @param {() => T | Promise<T>} condition - Trusted explicit predicate, invoked sequentially without parallel overlap.
 * @param {{ timeoutMs?: number; intervalMs?: number; signal?: AbortSignal }} options - Positive finite timing policy and optional cancellation signal.
 * @param {number | undefined} options.timeoutMs - Explicit positive observation deadline in milliseconds; this API retains its documented direct/CLI bounds.
 * @param {number | undefined} options.intervalMs - Positive finite delay between completed predicate attempts.
 * @param {AbortSignal | undefined} options.signal - Optional cooperative parent cancellation; noncooperative callback work may continue.
 * @returns {Promise<T>} First truthy result or explicit cause-preserving timeout/abort rejection.
 */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  /** Validated positive overall observation budget in milliseconds. */
  const timeoutMs = options.timeoutMs ?? 1000;
  /** Validated positive delay between completed predicate attempts. */
  const interval = options.intervalMs ?? 20;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    throw new RangeError('Invalid waitFor timing');
  }
  /** Host-clock observation cutoff; predicate settlement may exceed it if noncooperative. */
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('Aborted');
    }
    try {
      /** Actual trusted predicate result, returned only when truthy. */
      const value = await condition();
      if (value) {
        return value;
      }
      lastError = new Error('Condition not satisfied');
    } catch (e) {
      lastError = e;
    }
    /** Remaining local wait budget after a completed unsuccessful observation. */
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await new Promise<void>((resolve, reject) => {
      /** Owned one-shot poll delay, cancelled on abort and resolved through its listener cleanup. */
      const timer = setTimeout(done, Math.min(interval, remaining));
      /** Release this poll sleep’s abort listener before resolving.
       * @returns {void} Completes only the owned one-shot sleep.
       */
      function done() {
        options.signal?.removeEventListener('abort', abort);
        resolve();
      }
      /** Cancel this owned poll timer and detach its abort listener before rejecting.
       * @returns {void} Does not force-cancel a predicate already running.
       */
      function abort() {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        reject(options.signal?.reason ?? new Error('Aborted'));
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) {
        abort();
      }
    });
  }
  throw lastError instanceof Error
    ? new Error(`waitFor timed out: ${lastError.message}`, { cause: lastError })
    : new Error('waitFor timed out');
}
