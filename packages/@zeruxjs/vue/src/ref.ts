/** Minimal value holder; this contract alone does not create a native Vue ref. */
export interface VueRef<T> {
  /** Current value; object identity and nested mutation remain caller-owned. */
  value: T;
}
/** Value holder with explicit synchronous change subscriptions. */
export interface SubscribableRef<T> extends VueRef<T> {
  /** Observe changes until the returned unsubscribe function is called.
   * @param {(value: T) => void} listener - Borrowed synchronous callback.
   * @returns {() => void} Function removing this listener.
   */
  subscribe(listener: (value: T) => void): () => void;
}
/** Create a standalone holder with Object.is change detection.
 * @param {T} initial - Initial value retained by reference without cloning.
 * @returns {SubscribableRef<T>} Mutable holder; subscribers own their unsubscribe functions.
 */
export function createVueRef<T>(initial: T): SubscribableRef<T> {
  let value = initial;
  /** Snapshot iteration permits listener removal during synchronous notification. */
  const listeners = new Set<(v: T) => void>();
  return {
    get value() {
      return value;
    },
    set value(next: T) {
      if (Object.is(value, next)) {
        return;
      }
      value = next;
      for (const fn of [...listeners]) {
        if (listeners.has(fn)) {
          fn(value);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
/** Cache a borrowed source until explicitly stopped.
 * @param {(listener: (value: T) => void) => () => void} subscribe - Source registration returning its disposer.
 * @param {() => T} get - Synchronous initial snapshot reader.
 * @returns {VueRef<T> & {stop(): void}} Readable cache with an owned source subscription.
 */
export function toVueReadable<T>(
  subscribe: (listener: (value: T) => void) => () => void,
  get: () => T
): VueRef<T> & { stop(): void } {
  let current = get(),
    active = true;
  /** Only this subscription is owned; stopping never destroys the borrowed source. */
  const stopSource = subscribe((v) => {
    if (active) {
      current = v;
    }
  });
  return {
    get value() {
      return current;
    },
    stop() {
      if (active) {
        active = false;
        stopSource();
      }
    },
  };
}
/** Project a source synchronously without taking ownership of that source.
 * @param {SubscribableRef<A>} source - Borrowed change source.
 * @param {(value: A) => B} project - Trusted projection run initially and on changes.
 * @param {(a: B, b: B) => boolean} equal - Suppresses equivalent projected values.
 * @returns {SubscribableRef<B> & {stop(): void}} Disposable projection; legacy writable typing is retained, but runtime writes throw.
 */
export function mapVueRef<A, B>(
  source: SubscribableRef<A>,
  project: (value: A) => B,
  equal: (a: B, b: B) => boolean = Object.is
): SubscribableRef<B> & { stop(): void } {
  /** Separate holder caches projected values and owns its local listeners. */
  const result = createVueRef(project(source.value));
  /** Borrowed source registration released by the returned stop method. */
  const stop = source.subscribe((value) => {
    /** Compute once so equality and publication observe the same projection. */
    const next = project(value);
    if (!equal(result.value, next)) {
      result.value = next;
    }
  });
  return {
    get value() {
      return result.value;
    },
    set value(_next: B) {
      throw new TypeError('Derived ref is readonly');
    },
    subscribe: result.subscribe,
    stop,
  };
}
/** Combine borrowed refs into a cached tuple using per-slot Object.is checks.
 * @param {{[K in keyof T]: SubscribableRef<T[K]>}} sources - Ordered borrowed sources; membership is fixed at construction.
 * @returns {SubscribableRef<T> & {stop(): void}} Disposable tuple projection; runtime writes throw despite legacy writable typing.
 */
export function combineVueRefs<T extends readonly unknown[]>(sources: {
  [K in keyof T]: SubscribableRef<T[K]>;
}): SubscribableRef<T> & { stop(): void } {
  /** Preserve tuple order without cloning referenced values.
   * @returns {T} Fresh ordered tuple of current borrowed values.
   */
  const read = () => sources.map((s) => s.value) as unknown as T;
  /** Cached tuple holder owns local listeners, while each source remains borrowed. */
  const result = createVueRef(read());
  /** Publish a new tuple only when at least one slot changes identity.
   * @returns {void} Updates the cache synchronously when a slot changes.
   */
  const update = () => {
    /** One coherent snapshot for this synchronous notification. */
    const next = read();
    if (next.some((v, i) => !Object.is(v, result.value[i]))) {
      result.value = next;
    }
  };
  /** Each input registration is released in source order by stop. */
  const stops = sources.map((s) => s.subscribe(update));
  return {
    get value() {
      return result.value;
    },
    set value(_next: T) {
      throw new TypeError('Combined ref is readonly');
    },
    subscribe: result.subscribe,
    stop() {
      stops.forEach((s) => s());
    },
  };
}
