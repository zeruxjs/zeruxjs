import type { SubscribableRef } from './ref.js';
/** Expose a borrowed value holder through the store interface without importing Vue.
 * @param {{value: T}} ref - Borrowed holder read on each snapshot call.
 * @param {T} ref.value - Current borrowed value read by getSnapshot.
 * @param {(listener: () => void) => () => void} subscribe - Optional explicit change registration; absent registration never observes future changes.
 * @returns {{getSnapshot(): T, subscribe(listener: () => void): () => void}} Borrowed store view without a native watcher.
 */
export function fromVueRef<T>(
  ref: { value: T },
  subscribe?: (listener: () => void) => () => void
) {
  return {
    getSnapshot: () => ref.value,
    subscribe: subscribe ?? (() => () => {}),
  };
}
/** Copy snapshots into a mutable target until the returned disposer is called.
 * @param {{getSnapshot(): T, subscribe(listener: () => void): () => void}} source - Borrowed snapshot source.
 * @param {() => T} source.getSnapshot - Synchronous snapshot reader.
 * @param {(listener: () => void) => () => void} source.subscribe - Change registration returning its disposer.
 * @param {SubscribableRef<T>} target - Borrowed target initialized synchronously.
 * @returns {() => void} Source unsubscribe function; neither holder is destroyed.
 */
export function bindVueRef<T>(
  source: { getSnapshot(): T; subscribe(listener: () => void): () => void },
  target: SubscribableRef<T>
): () => void {
  target.value = source.getSnapshot();
  return source.subscribe(() => {
    target.value = source.getSnapshot();
  });
}
/** Two-way link with feedback suppression; callers retain both borrowed stores. Cleanup calls the store disposer before the ref disposer; a throwing first disposer prevents the second call.
 * @param {SubscribableRef<T>} ref - Borrowed mutable holder.
 * @param {{getSnapshot(): T, subscribe(listener: () => void): () => void, set(value: T): void}} store - Borrowed store providing synchronous updates and unsubscription.
 * @param {() => T} store.getSnapshot - Synchronous current value reader.
 * @param {(listener: () => void) => () => void} store.subscribe - Borrowed change registration.
 * @param {(value: T) => void} store.set - Trusted synchronous mutation callback.
 * @param {(a: T, b: T) => boolean} equal - Equality guard for both directions.
 * @returns {() => void} Stop forwarding before invoking both subscription disposers in order.
 */
export function syncVueRef<T>(
  ref: SubscribableRef<T>,
  store: {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
    set(value: T): void;
  },
  equal: (a: T, b: T) => boolean = Object.is
): () => void {
  let stopped = false,
    busy = false;
  /** Guard feedback while a store snapshot is copied to the ref.
   * @returns {void} Copies a changed snapshot unless forwarding is stopped or recursive.
   */
  const fromStore = () => {
    if (stopped || busy) {
      return;
    }
    /** Read once before comparing and forwarding. */
    const next = store.getSnapshot();
    if (!equal(ref.value, next)) {
      busy = true;
      try {
        ref.value = next;
      } finally {
        busy = false;
      }
    }
  };
  /** Guard feedback while a ref value is copied to the store.
   * @param {T} value - New value supplied by the ref notification.
   * @returns {void} Forwards a distinct value while suppressing recursive feedback.
   */
  const fromRef = (value: T) => {
    if (stopped || busy || equal(store.getSnapshot(), value)) {
      return;
    }
    busy = true;
    try {
      store.set(value);
    } finally {
      busy = false;
    }
  };
  fromStore();
  /** This link owns both registrations, but borrows the underlying holders. */
  const stopStore = store.subscribe(fromStore),
    stopRef = ref.subscribe(fromRef);
  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    stopStore();
    stopRef();
  };
}
/** Cache an observable without transferring ownership of the observable itself.
 * @param {{get(): T, subscribe(listener: (value: T) => void): () => void}} source - Borrowed synchronous source.
 * @param {() => T} source.get - Synchronous initial value reader.
 * @param {(listener: (value: T) => void) => () => void} source.subscribe - Registration returning this view's disposer.
 * @returns {SubscribableRef<T> & {stop(): void}} Disposable cached view; runtime value writes throw.
 */
export function observableToVueRef<T>(source: {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}) {
  let current = source.get(),
    active = true;
  /** Local observers receive identity changes from the cached source value. */
  const listeners = new Set<(value: T) => void>();
  /** Detach only this view from its borrowed source on stop. */
  const stopSource = source.subscribe((value) => {
    if (!active || Object.is(value, current)) {
      return;
    }
    current = value;
    for (const fn of [...listeners]) {
      if (listeners.has(fn)) {
        fn(value);
      }
    }
  });
  return {
    get value() {
      return current;
    },
    set value(_next: T) {
      throw new TypeError('Observable ref is readonly');
    },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      if (active) {
        active = false;
        stopSource();
        listeners.clear();
      }
    },
  };
}
