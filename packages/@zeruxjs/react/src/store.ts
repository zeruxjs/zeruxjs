export interface ExternalStore<T> {
  /** Read the current immutable snapshot by reference; never mutate it in place.
   * @returns {T} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  getSnapshot(): T;
  /** Borrow one source subscription and return its unsubscribe; adapters do not own source destruction.
   * @param {function} listener - Borrowed synchronous change/value listener; retain and call the returned unsubscribe on owner teardown.
   * @returns {function} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  subscribe(listener: () => void): () => void;
  /** Read the explicit pinned/derived server snapshot; it must match serialized public hydration state.
   * @returns {T} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  getServerSnapshot?(): T;
}
export type Updater<T> = T | ((previous: T) => T);
export interface WritableExternalStore<T> extends ExternalStore<T> {
  /** Apply a synchronous immutable update and notify only when Object.is detects a change. Calls after destroy remain inert.
   * @param {Updater<T>} value - Immutable next snapshot or synchronous updater; function-valued state follows the documented updater convention.
   * @returns {void} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  set(value: Updater<T>): void;
  /** Apply a synchronous immutable updater; batch notification policy remains store-owned.
   * @param {function} fn - Synchronous updater/batch callback; async work is not enclosed by a synchronous batch.
   * @returns {void} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  update(fn: (state: T) => T): void;
  /** Nest a synchronous notification batch; finally restores depth and flushes even if the callback throws. Async callback work is outside this batch.
   * @param {function} fn - Synchronous updater/batch callback; async work is not enclosed by a synchronous batch.
   * @returns {R} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  batch<R>(fn: () => R): R;
  /** Read the explicit pinned/derived server snapshot; it must match serialized public hydration state.
   * @returns {T} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  getServerSnapshot(): T;
  /** Idempotently stop notifications and clear owned listeners; retained snapshots remain readable. Never use React Strict Mode effect cleanup to destroy a borrowed shared store.
   * @returns {void} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
   */
  destroy(): void;
}
/** Own synchronous notifications over host-supplied immutable values. Pin the initial/explicit server value separately so client updates cannot silently alter SSR state.
 * @param {T} initial - Initial host-owned snapshot; values are not automatically cloned/frozen.
 * @param {object} options - Optional explicit server snapshot.
 * @param {T} [options.serverSnapshot] - Pinned server value, defaults to initial.
 * @returns {WritableExternalStore<T>} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function createReactStore<T>(
  initial: T,
  options: {
    /** Explicit pinned value/callback matching public SSR data; absence is not replaced by client state. */
    serverSnapshot?: T;
  } = {}
): WritableExternalStore<T> {
  let current = initial,
    active = true,
    depth = 0,
    pending = false,
    emitting = false;
  /** Owned notification registrations; unsubscribe/destroy removes them without owning user snapshots. */
  const listeners = new Set<() => void>();
  /** Read the current source/selected snapshot; references change only under the declared equality policy.
   * @returns {T} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const getSnapshot = () => current;
  /** Synchronously drain pending notifications, respecting nested batches, reentrant updates and removed listeners.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const flush = () => {
    if (depth || emitting || !pending || !active) {
      return;
    }
    emitting = true;
    try {
      // Preserve synchronous notification ownership; removed listeners are skipped and reentrant work stays pending.
      while (pending && !depth && active) {
        pending = false;
        // Preserve synchronous notification ownership; removed listeners are skipped and reentrant work stays pending.
        for (const listener of [...listeners]) {
          if (listeners.has(listener)) {
            listener();
          }
        }
      }
    } finally {
      emitting = false;
    }
  };
  /** Apply an immutable update only while active; no background work is scheduled.
   * @param {Updater<T>} value - Explicit immutable next value or caller-controlled policy input.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const set = (value: Updater<T>) => {
    if (!active) {
      return;
    }
    /** Proposed next/selected snapshot compared before committing cache state. */
    const next =
      typeof value === 'function' ? (value as (v: T) => T)(current) : value;
    if (Object.is(next, current)) {
      return;
    }
    current = next;
    pending = true;
    flush();
  };
  /** Pinned initial/explicit server snapshot independent of later client writes. */
  const serverValue =
    options.serverSnapshot === undefined ? initial : options.serverSnapshot;
  return {
    getSnapshot,
    getServerSnapshot: () => serverValue,
    /** Borrow one source subscription and return its unsubscribe; adapters do not own source destruction.
     * @param {function} listener - Borrowed synchronous change/value listener; retain and call the returned unsubscribe on owner teardown.
     * @returns {function} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    subscribe(listener) {
      if (!active) {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    update: set,
    /** Nest a synchronous notification batch; finally restores depth and flushes even if the callback throws. Async callback work is outside this batch.
     * @param {function} fn - Synchronous updater/batch callback; async work is not enclosed by a synchronous batch.
     * @returns {R} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    batch(fn) {
      depth++;
      try {
        return fn();
      } finally {
        depth--;
        flush();
      }
    },
    /** Idempotently stop notifications and clear owned listeners; retained snapshots remain readable. Never use React Strict Mode effect cleanup to destroy a borrowed shared store.
     * @returns {void} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    destroy() {
      active = false;
      pending = false;
      listeners.clear();
    },
  };
}
/** Borrow the source and memoize client/server projections independently. Equality keeps selected references stable; no source lifetime or React runtime is acquired.
 * @param {object} source - Borrowed structural store/observable; this adapter never destroys it.
 * @param {(value: A) => B} selector - Pure stable projection; exceptions leave the previous cache available for a later read.
 * @param {(a: B, b: B) => boolean} equal - Equality for selected snapshots, default Object.is; retain references for equal values.
 * @returns {ExternalStore<B>} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function selectReactStore<A, B>(
  source: ExternalStore<A>,
  selector: (value: A) => B,
  equal: (a: B, b: B) => boolean = Object.is
): ExternalStore<B> {
  let lastSource = source.getSnapshot(),
    lastSelected = selector(lastSource);
  /** Read the current source/selected snapshot; references change only under the declared equality policy.
   * @returns {B} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const getSnapshot = () => {
    /** Current borrowed source snapshot; callers must update immutably. */
    const current = source.getSnapshot();
    if (!Object.is(lastSource, current)) {
      /** Successful pure selector result; failed projections must not poison the prior cache. */
      const selected = selector(current);
      /** Explicit equality receipt controlling selected-reference retention. */
      const same = equal(lastSelected, selected);
      lastSource = current;
      if (!same) {
        lastSelected = selected;
      }
    }
    return lastSelected;
  };
  let lastServerSource = source.getServerSnapshot?.();
  let lastServerSelected = source.getServerSnapshot
    ? selector(lastServerSource as A)
    : undefined;
  /** Project only an actually supplied server-read contract; absence remains explicit.
   * @returns {B} Stable selected server snapshot when the source declares a server read.
   */
  const getServerSnapshot = source.getServerSnapshot
    ? () => {
        /** Current borrowed source snapshot; callers must update immutably. */
        const current = source.getServerSnapshot!();
        if (!Object.is(lastServerSource, current)) {
          /** Successful pure selector result; failed projections must not poison the prior cache. */
          const selected = selector(current);
          /** Explicit equality receipt controlling selected-reference retention. */
          const same = equal(lastServerSelected as B, selected);
          lastServerSource = current;
          if (!same) {
            lastServerSelected = selected;
          }
        }
        return lastServerSelected as B;
      }
    : undefined;
  return {
    getSnapshot,
    getServerSnapshot,
    /** Borrow one source subscription and return its unsubscribe; adapters do not own source destruction.
     * @param {function} listener - Borrowed synchronous change/value listener; retain and call the returned unsubscribe on owner teardown.
     * @returns {function} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    subscribe(listener) {
      let previous = getSnapshot();
      return source.subscribe(() => {
        /** Proposed next/selected snapshot compared before committing cache state. */
        const next = getSnapshot();
        if (!equal(previous, next)) {
          previous = next;
          listener();
        }
      });
    },
  };
}
