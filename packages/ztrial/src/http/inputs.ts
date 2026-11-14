/** Snapshot a bounded deterministic fixture sequence independent of global randomness; never use it for tokens or cryptographic entropy.
 * @param {readonly number[]} values - One through1024 finite fixture numbers in the half-open range zero to one.
 * @returns {() => number} One-shot-per-value fixture source that rejects exhaustion rather than repeating a value.
 */
export function createSequenceRandom(values: readonly number[]): () => number {
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 1024 ||
    values.some((value) => !Number.isFinite(value) || value < 0 || value >= 1)
  ) {
    throw new TypeError('Invalid random sequence');
  }
  /** Detached deterministic fixture numbers; source-array changes cannot alter future values. */
  const snapshot = [...values];
  let index = 0;
  return () => {
    if (index === snapshot.length) {
      throw new Error('Test random sequence exhausted');
    }
    return snapshot[index++];
  };
}
/** Create an inert manual fixture clock with bounded cooperative sleepers; global Date/native safety timers remain untouched.
 * @param {number} initial - Nonnegative safe-integer fixture epoch, default zero.
 * @returns {object} Owned manual clock; close rejects retained waiters and detaches their abort listeners.
 */
export function createTestClock(initial = 0) {
  if (!Number.isSafeInteger(initial) || initial < 0) {
    throw new TypeError('Invalid test clock');
  }
  let time = initial,
    closed = false;
  /** At most128 owned manual-clock waiters with explicit per-waiter listener cleanup. */
  const pending = new Set<{
    /** Fixture-clock deadline in milliseconds. */
    due: number;
    /** Owned waiter success continuation, invoked after removing its listener. */
    resolve: () => void;
    /** Owned waiter failure continuation for abort/clock close. */
    reject: (error: unknown) => void;
    /** Remove this waiter’s own abort listener before terminal settlement. */
    unlink: () => void;
  }>();
  return {
    now: () => time,
    /** Register one bounded cooperative manual-clock sleep without starting a native timer.
     * @param {number} ms - Nonnegative safe-integer fixture delay, at most ten minutes.
     * @param {AbortSignal} signal - Explicit native cancellation signal; abort removes this waiter.
     * @returns {Promise<void>} Settles when advance reaches its deadline, rejects on abort/close/full waiter capacity.
     */
    sleep(ms: number, signal: AbortSignal): Promise<void> {
      if (
        !(signal instanceof AbortSignal) ||
        !Number.isSafeInteger(ms) ||
        ms < 0 ||
        ms > 600000 ||
        !Number.isSafeInteger(time + ms)
      ) {
        throw new RangeError('Invalid test delay');
      }
      if (closed) {
        return Promise.reject(new Error('Test clock closed'));
      }
      if (signal.aborted) {
        return Promise.reject(signal.reason);
      }
      if (!ms) {
        return Promise.resolve();
      }
      if (pending.size >= 128) {
        return Promise.reject(new Error('Test clock waiter limit'));
      }
      return new Promise((resolve, reject) => {
        /** Remove this waiter/listener and reject with its explicit cancellation reason.
         * @returns {void} Cancels only this manual-clock wait, never global timers. */
        const abort = () => {
          pending.delete(entry);
          entry.unlink();
          reject(signal.reason);
        };
        /** Owned waiter record inserted only after signal and capacity checks. */
        const entry = {
          due: time + ms,
          resolve,
          reject,
          unlink: () => signal.removeEventListener('abort', abort),
        };
        pending.add(entry);
        signal.addEventListener('abort', abort, { once: true });
      });
    },
    /** Move the open fixture clock forward and resolve due sleepers in deadline order.
     * @param {number} ms - Nonnegative safe-integer delta whose resulting clock remains safe.
     * @returns {void} Resolves only this fixture’s due waiters; it never changes global timers.
     */
    advance(ms: number) {
      if (
        closed ||
        !Number.isSafeInteger(ms) ||
        ms < 0 ||
        !Number.isSafeInteger(time + ms)
      ) {
        throw new RangeError('Invalid clock advance');
      }
      time += ms;
      for (const entry of [...pending].sort((a, b) => a.due - b.due)) {
        if (entry.due <= time) {
          pending.delete(entry);
          entry.unlink();
          entry.resolve();
        }
      }
    },
    /** Idempotently close this manual clock, detach listeners and reject every remaining owned sleep.
     * @returns {void} No borrowed/global clocks or unrelated timers are modified.
     */
    close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const entry of pending) {
        entry.unlink();
        entry.reject(new Error('Test clock closed'));
      }
      pending.clear();
    },
    pending: () => pending.size,
  };
}
