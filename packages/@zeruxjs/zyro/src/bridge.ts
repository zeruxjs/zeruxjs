import type { Observable } from './observable.js';
/** Adapt a borrowed observable without subscribing until the consumer requests it.
 * @param {Observable<T>} source - Borrowed synchronous observable.
 * @returns {{getSnapshot(): T, subscribe(listener: () => void): () => void}} Snapshot adapter whose subscribers own their disposers.
 */
export function toExternalStore<T>(source: Observable<T>) {
  return {
    getSnapshot: () => source.get(),
    subscribe(listener: () => void) {
      return source.subscribe(() => listener());
    },
  };
}
/** Expose an external store through the observable contract without changing its ownership.
 * @param {{getSnapshot(): T, subscribe(listener: () => void): () => void}} store - Borrowed synchronous store.
 * @param {() => T} store.getSnapshot - Read the current borrowed state.
 * @param {(listener: () => void) => () => void} store.subscribe - Register changes and return a disposer.
 * @returns {Observable<T>} Borrowed observable adapter without an eager subscription.
 */
export function fromExternalStore<T>(store: {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}): Observable<T> {
  return {
    get: () => store.getSnapshot(),
    subscribe(listener) {
      return store.subscribe(() => listener(store.getSnapshot()));
    },
  };
}
/** Subscribes until a predicate matches, aborts, or the timeout expires. Handles synchronous subscribe callbacks.
 * @param {Observable<T>} source - Borrowed source; only this wait's subscription is owned.
 * @param {(value: T) => boolean} predicate - Trusted synchronous acceptance test.
 * @param {{signal?: AbortSignal, timeoutMs?: number}} options - Optional cancellation and finite nonnegative timeout.
 * @param {AbortSignal} options.signal - Borrowed cancellation signal.
 * @param {number} options.timeoutMs - Optional native timer delay; no forced interruption of callbacks.
 * @returns {Promise<T>} Matching snapshot or rejection; no source destruction is performed.
 */
export function awaitObservable<T>(
  source: Observable<T>,
  predicate: (value: T) => boolean,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  ) {
    return Promise.reject(new RangeError('Invalid timeout'));
  }
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined,
      done = false,
      mustStop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Complete once and release this wait's timer/listener/registration.
     * @param {T | unknown} result - Matching value or private failure.
     * @param {boolean} failed - Select rejection instead of resolution.
     * @returns {void} Settles the wait once; trusted disposer failures retain legacy behavior.
     */
    const finish = (result: T | unknown, failed: boolean) => {
      if (done) {
        return;
      }
      done = true;
      if (stop) {
        stop();
      } else {
        mustStop = true;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', aborted);
      if (failed) {
        reject(result);
      } else {
        resolve(result as T);
      }
    };
    /** Translate a borrowed signal into this wait's fixed abort error.
     * @returns {void} Finish this wait without canceling the underlying observable.
     */
    const aborted = () => finish(new Error('Observable wait aborted'), true);
    if (options.signal?.aborted) {
      aborted();
      return;
    }
    options.signal?.addEventListener('abort', aborted, { once: true });
    try {
      /** Check the current snapshot before creating a listener or timer. */
      const current = source.get();
      if (predicate(current)) {
        finish(current, false);
        return;
      }
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(
          () => finish(new Error('Observable wait timed out'), true),
          options.timeoutMs
        );
      }
      stop = source.subscribe((value) => {
        try {
          if (predicate(value)) {
            finish(value, false);
          }
        } catch (e) {
          finish(e, true);
        }
      });
      if (mustStop) {
        stop();
      }
    } catch (e) {
      finish(e, true);
    }
  });
}
