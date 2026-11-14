/** Borrowed synchronous snapshot/change contract; each subscriber owns its unsubscribe function. */
export interface Observable<T> {
  /** Read the current snapshot without cloning referenced values. */
  get(): T;
  /** Observe future synchronous changes; returned function releases this registration only. */
  subscribe(listener: (value: T) => void): () => void;
}
/** Mutable source with explicit whole-source teardown ownership. */
export interface MutableObservable<T> extends Observable<T> {
  /** Publish a distinct value or compute it synchronously from the current snapshot. */
  set(value: T | ((old: T) => T)): void;
  /** Stop notifications and future writes; retained snapshots remain readable. */
  destroy(): void;
}
/** Mutable source with synchronous notification coalescing; batching is not database atomicity. */
export interface BatchedObservable<T> extends MutableObservable<T> {
  /** Run trusted synchronous work; flush on exit even when the callback throws. */
  batch<R>(fn: () => R): R;
}
/** Notifications are coalesced during a synchronous transaction; snapshots always reflect the latest write.
 * @param {T} initial - Initial value retained by reference.
 * @returns {BatchedObservable<T>} Owned mutable source; destroy clears listeners without destroying values.
 */
export function createObservable<T>(initial: T): BatchedObservable<T> {
  let state = initial,
    disposed = false,
    depth = 0,
    pending = false,
    emitting = false;
  /** Active synchronous listeners; snapshot iteration tolerates removal during dispatch. */
  const listeners = new Set<(value: T) => void>();
  /** Drain reentrant writes after synchronous batches without recursively emitting.
   * @returns {void} Delivers pending current snapshots while the source remains active.
   */
  const flush = () => {
    if (emitting || depth || !pending || disposed) {
      return;
    }
    emitting = true;
    try {
      while (pending && !depth && !disposed) {
        pending = false;
        for (const fn of [...listeners]) {
          if (listeners.has(fn)) {
            fn(state);
          }
        }
      }
    } finally {
      emitting = false;
    }
  };
  return {
    get: () => state,
    set(input) {
      if (disposed) {
        return;
      }
      /** Evaluate an updater once before comparing identity and publishing. */
      const next =
        typeof input === 'function' ? (input as (v: T) => T)(state) : input;
      if (Object.is(next, state)) {
        return;
      }
      state = next;
      pending = true;
      flush();
    },
    subscribe(listener) {
      if (disposed) {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    batch(fn) {
      if (disposed) {
        return fn();
      }
      depth++;
      try {
        return fn();
      } finally {
        depth--;
        flush();
      }
    },
    destroy() {
      disposed = true;
      pending = false;
      listeners.clear();
    },
  };
}
/** Memoizes a selected snapshot for consumers such as React useSyncExternalStore.
 * @param {Observable<A>} source - Borrowed synchronous source.
 * @param {(value: A) => B} selector - Trusted synchronous projection.
 * @param {(a: B, b: B) => boolean} equal - Equality policy for retaining projected snapshot identity.
 * @returns {Observable<B>} Borrowed memoized projection; each subscriber owns its registration disposer.
 */
export function mapObservable<A, B>(
  source: Observable<A>,
  selector: (value: A) => B,
  equal: (a: B, b: B) => boolean = Object.is
): Observable<B> {
  let input = source.get(),
    selected = selector(input);
  /** Recompute only when the borrowed source snapshot changes identity.
   * @returns {B} Stable selected snapshot; selector/equality failures propagate.
   */
  const read = () => {
    /** Read once; unchanged input identity reuses the previous selected snapshot. */
    const next = source.get();
    if (!Object.is(next, input)) {
      /** Trusted projection; cache state changes only after projection and equality succeed. */
      const projected = selector(next);
      /** Compare before committing either cached input or selected value. */
      const same = equal(selected, projected);
      input = next;
      if (!same) {
        selected = projected;
      }
    }
    return selected;
  };
  return {
    get: read,
    subscribe(listener) {
      let previous = read(),
        installing = true,
        failed = false,
        failure: unknown;
      /** Notify this registration only when its selected value changes.
       * @returns {void} Delivers a synchronous projected snapshot.
       */
      const notify = () => {
        /** Read once for this listener before updating its last-delivered snapshot. */
        const next = read();
        if (!equal(previous, next)) {
          previous = next;
          listener(next);
        }
      };
      /** Capture installation callback failures until the source returns a rollback handle. */
      const stop = source.subscribe(() => {
        if (installing) {
          try {
            notify();
          } catch (error) {
            failed = true;
            failure = error;
          }
        } else {
          notify();
        }
      });
      installing = false;
      if (typeof stop !== 'function') {
        throw new TypeError('Observable subscribe must return a disposer');
      }
      if (failed) {
        try {
          stop();
        } catch (cleanup) {
          throw new AggregateError(
            [failure, cleanup],
            'Observable subscription rollback failed'
          );
        }
        throw failure;
      }
      return stop;
    },
  };
}
/** Combine borrowed snapshots with deterministic tuple ordering and stable unchanged identity.
 * @param {{[K in keyof T]: Observable<T[K]>}} sources - Fixed ordered borrowed sources.
 * @returns {Observable<T>} Tuple view; subscriptions own source registrations, never the sources.
 */
export function combineObservables<T extends readonly unknown[]>(sources: {
  [K in keyof T]: Observable<T[K]>;
}): Observable<T> {
  let previous = sources.map((source) => source.get()) as unknown as T;
  /** Preserve the previous tuple when all current source slots are unchanged.
   * @returns {T} Stable ordered tuple snapshot.
   */
  const read = () => {
    /** Ordered tuple of current borrowed values, compared by per-slot identity. */
    const current = sources.map((source) => source.get()) as unknown as T;
    if (
      current.length !== previous.length ||
      current.some((v, i) => !Object.is(v, previous[i]))
    ) {
      previous = current;
    }
    return previous;
  };
  return {
    get: read,
    subscribe(listener) {
      let last = read();
      /** One unsubscribe per source; legacy teardown invokes them in source order. */
      const stops = sources.map((source) =>
        source.subscribe(() => {
          /** One current tuple for this change notification. */
          const next = read();
          if (!Object.is(last, next)) {
            last = next;
            listener(next);
          }
        })
      );
      return () => stops.forEach((stop) => stop());
    },
  };
}
