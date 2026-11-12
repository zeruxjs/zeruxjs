import type { ExternalStore } from './store.js';
/** Adapt a borrowed observable structurally without a runtime dependency or implicit server snapshot. Retain each unsubscribe separately.
 * @param {object} source - Borrowed structural observable.
 * @param {function} source.get - Read the current immutable value.
 * @param {function} source.subscribe - Register a listener and return unsubscribe.
 * @returns {ExternalStore<T>} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function observableToReactStore<T>(source: {
  /** Read the borrowed observable snapshot without taking ownership of its source.
   * @returns {T} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  get(): T;
  /** Borrow one source subscription and return its unsubscribe; adapters do not own source destruction.
   * @param {function} listener - Borrowed synchronous change/value listener; retain and call the returned unsubscribe on owner teardown.
   * @returns {function} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  subscribe(listener: (value: T) => void): () => void;
}): ExternalStore<T> {
  return {
    getSnapshot: () => source.get(),
    /** Borrow one source subscription and return its unsubscribe; adapters do not own source destruction.
     * @param {function} listener - Borrowed synchronous change/value listener; retain and call the returned unsubscribe on owner teardown.
     * @returns {function} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    subscribe(listener) {
      return source.subscribe(() => listener());
    },
  };
}
/** Expose a borrowed external store through the observable read/subscribe shape without assuming its destruction.
 * @param {ExternalStore<T>} store - Borrowed external store with explicit subscription/server-read contract.
 * @returns {object} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function reactStoreToObservable<T>(store: ExternalStore<T>) {
  return {
    get: store.getSnapshot,
    /** Borrow one source subscription and return its unsubscribe; adapters do not own source destruction.
     * @param {function} listener - Borrowed synchronous change/value listener; retain and call the returned unsubscribe on owner teardown.
     * @returns {function} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    subscribe(listener: (value: T) => void) {
      return store.subscribe(() => listener(store.getSnapshot()));
    },
  };
}
