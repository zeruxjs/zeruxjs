/** Vue 3 runtime injection. Nothing imports Vue at module evaluation / during SSR. */
export interface VueRuntime {
  /** Create runtime-owned shallow state; nested values remain borrowed. */
  shallowRef<T>(value: T): { value: T };
  /** Return the currently active component/effect scope, if any. */
  getCurrentScope(): unknown;
  /** Register synchronous cleanup with the active native scope. */
  onScopeDispose(stop: () => void): void;
  /** Optional runtime readonly proxy; absent injection leaves the underlying ref mutable. */
  readonly?(value: { value: any }): { readonly value: any };
  /** Optional native watcher; each registration returns its own stop function. */
  watch?<T>(
    source: () => T,
    callback: (next: T) => void,
    options?: { flush: 'sync' }
  ): () => void;
}
/** Borrowed synchronous snapshot source; bindings never destroy the store. */
export interface VueStore<T> {
  /** Read current state without cloning or subscribing. */
  getSnapshot(): T;
  /** Register changes and return the registration's unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
/**
 * Inside a Vue setup/effect scope, subscribe once and release when the scope ends.
 * Throw without a scope: silently subscribing in module code leaks listeners.
 * @param {VueRuntime} runtime - Trusted injected functions from one compatible Vue runtime.
 * @returns {object} Inert binding factory; connect owns manual subscriptions and useStore delegates them to a native scope.
 */
export function createVueBindings(runtime: VueRuntime) {
  if (
    !runtime ||
    ['shallowRef', 'getCurrentScope', 'onScopeDispose'].some(
      (name) => typeof runtime[name as keyof VueRuntime] !== 'function'
    ) ||
    (runtime.readonly !== undefined &&
      typeof runtime.readonly !== 'function') ||
    (runtime.watch !== undefined && typeof runtime.watch !== 'function')
  ) {
    throw new TypeError('Vue runtime functions are required');
  }
  /** Preserve native ref identity unless a readonly wrapper was explicitly supplied.
   * @param {{value: T}} state - Native shallow holder.
   * @param {T} state.value - Borrowed cached snapshot.
   * @returns {Readonly<{value: T}>} Readonly-typed holder; runtime mutation protection requires the injected readonly function.
   */
  const expose = <T>(state: { value: T }): Readonly<{ value: T }> =>
    runtime.readonly ? runtime.readonly(state) : state;
  /** Own one registration and roll it back when initial reads or wrapping fail.
   * @param {VueStore<T>} store - Borrowed synchronous source.
   * @returns {{ref: Readonly<{value: T}>, stop(): void}} Manual connection whose stop function belongs to the caller.
   */
  const connect = <T>(store: VueStore<T>) => {
    if (
      !store ||
      typeof store.getSnapshot !== 'function' ||
      typeof store.subscribe !== 'function'
    ) {
      throw new TypeError('A getSnapshot/subscribe store is required');
    }
    /** Native shallow holder caches the borrowed store snapshot. */
    const state = runtime.shallowRef(store.getSnapshot());
    let active = true,
      installing = true,
      failed = false,
      failure: unknown;
    /** Ignore notifications after disposal, including retained source callbacks.
     * @returns {void} Refreshes the cached snapshot only while active.
     */
    const read = () => {
      if (active) {
        state.value = store.getSnapshot();
      }
    };
    /** Capture synchronous installation errors until a disposer becomes available. */
    const stop = store.subscribe(() => {
      if (installing) {
        try {
          read();
        } catch (error) {
          failed = true;
          failure = error;
        }
      } else {
        read();
      }
    });
    installing = false;
    if (typeof stop !== 'function') {
      throw new TypeError('Store subscribe must return a disposer');
    }
    /** Fence callbacks before invoking potentially throwing source cleanup.
     * @returns {void} Stops this registration at most once.
     */
    const dispose = () => {
      if (!active) {
        return;
      }
      active = false;
      stop();
    };
    try {
      if (failed) {
        throw failure;
      }
      // Re-read after registration to close the initial snapshot/subscribe gap.
      read();
      return { ref: expose(state), stop: dispose };
    } catch (error) {
      try {
        dispose();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          'Vue connection rollback failed'
        );
      }
      throw error;
    }
  };
  return {
    /** Manual bridge for non-component code; caller owns `stop`. */
    connect,
    /** Automatic scope disposal; use inside setup() or effectScope.run().
     * @param {VueStore<T>} store - Borrowed source owned by the host.
     * @param {{ssr?: boolean}} options - Explicit one-shot server read policy.
     * @param {boolean} options.ssr - Skip subscription when rendering on the server.
     * @returns {Readonly<{value: T}>} Native shallow holder tied to the current effect scope.
     */
    useStore<T>(store: VueStore<T>, options: { ssr?: boolean } = {}) {
      if (!runtime.getCurrentScope()) {
        throw new Error(
          'Vue store binding requires an active Vue effect scope'
        );
      }
      if (options.ssr) {
        /** SSR takes a one-shot snapshot without leaving a subscription behind. */
        const snapshot = runtime.shallowRef(store.getSnapshot());
        return expose(snapshot);
      }
      /** The native scope takes ownership only after registration succeeds. */
      const connection = connect(store);
      try {
        runtime.onScopeDispose(connection.stop);
      } catch (error) {
        try {
          connection.stop();
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            'Vue scope registration rollback failed'
          );
        }
        throw error;
      }
      return connection.ref;
    },
    /** Adapt Vue's own ref into a subscribable store using sync watch.
     * @param {{value: T}} ref - Borrowed native value holder.
     * @param {T} ref.value - Current native value.
     * @returns {VueStore<T>} Borrowed store adapter; each subscriber owns its watch disposer.
     */
    fromRef<T>(ref: { value: T }) {
      if (!runtime.watch) {
        throw new Error('Vue watch() must be provided to bridge a Vue ref');
      }
      return {
        getSnapshot: () => ref.value,
        subscribe(listener: () => void) {
          return runtime.watch!(() => ref.value, listener, { flush: 'sync' });
        },
      };
    },
  };
}
