import { selectReactStore, type ExternalStore } from './store.js';
/** A React.useSyncExternalStore-compatible injection (React remains a peer). */
export type UseSyncExternalStore = <T>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T
) => T;
export interface ReactHookRuntime {
  /** Injected actual React hook; call only within a valid component lifecycle. */
  useSyncExternalStore: UseSyncExternalStore;
  /** Injected native memo hook; stable dependencies retain one selected store. */
  useMemo: <T>(create: () => T, dependencies: readonly unknown[]) => T;
}
/** Call the injected React external-store hook with the explicit server snapshot contract. Do not substitute a client read when no server read exists.
 * @param {UseSyncExternalStore} useSyncExternalStore - Injected real React hook called only within a valid component/hook lifecycle.
 * @param {ExternalStore<T>} store - Borrowed external store with explicit subscription/server-read contract.
 * @param {() => T} serverSnapshot - Optional stable override matching the exact public hydration payload; never infer a missing SSR snapshot.
 * @returns {T} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function useReactStore<T>(
  useSyncExternalStore: UseSyncExternalStore,
  store: ExternalStore<T>,
  serverSnapshot?: () => T
): T {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot ?? store.getServerSnapshot
  );
}
/** Weak per-source/per-selector cache; no global strong retention of request stores or runtime dependency. */
const selectors = new WeakMap<
  object,
  WeakMap<
    (...args: any[]) => any,
    {
      /** Stable selected-value equality retained with its weak-cache entry. */
      comparator: (...args: any[]) => any;
      /** Explicit pinned value/callback matching public SSR data; absence is not replaced by client state. */
      serverSnapshot?: (...args: any[]) => any;
      /** Borrowed derived store; caching does not transfer source destruction. */
      store: ExternalStore<unknown>;
    }
  >
>();
/** Reuse stable store/selector/equality/server-read combinations through weak caches. Prefer createReactBindings inside actual components for native hook memoization.
 * @param {UseSyncExternalStore} useSyncExternalStore - Injected real React hook called only within a valid component/hook lifecycle.
 * @param {ExternalStore<A>} store - Borrowed external store with explicit subscription/server-read contract.
 * @param {(state: A) => B} selector - Pure stable projection; exceptions leave the previous cache available for a later read.
 * @param {object} options - Optional equality/server snapshot policy.
 * @param {function} [options.equal] - Stable selected-value comparator, default Object.is.
 * @param {function} [options.serverSnapshot] - Stable explicit server read matching hydration data.
 * @returns {B} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function useReactSelector<A, B>(
  useSyncExternalStore: UseSyncExternalStore,
  store: ExternalStore<A>,
  selector: (state: A) => B,
  options: {
    /** Optional stable comparator, default Object.is. */
    equal?: (a: B, b: B) => boolean;
    /** Explicit pinned value/callback matching public SSR data; absence is not replaced by client state. */
    serverSnapshot?: () => A;
  } = {}
): B {
  let cached = selectors.get(store);
  if (!cached) {
    cached = new WeakMap();
    selectors.set(store, cached);
  }
  let entry = cached.get(selector);
  /** Stable explicit comparator or Object.is; changing it creates the matching derived cache entry. */
  const equal = options.equal ?? Object.is;
  if (
    !entry ||
    entry.comparator !== equal ||
    entry.serverSnapshot !== options.serverSnapshot
  ) {
    entry = {
      comparator: equal,
      serverSnapshot: options.serverSnapshot,
      store: selectReactStore(
        options.serverSnapshot
          ? {
              getSnapshot: store.getSnapshot,
              subscribe: store.subscribe,
              getServerSnapshot: options.serverSnapshot,
            }
          : store,
        selector,
        equal
      ) as ExternalStore<unknown>,
    };
    cached.set(selector, entry);
  }
  /** Borrowed memoized selected store; native React owns subscriptions, host owns source lifetime. */
  const derived = entry.store as ExternalStore<B>;
  return useSyncExternalStore(
    derived.subscribe,
    derived.getSnapshot,
    derived.getServerSnapshot
  );
}
/** Create inert injected hook bindings. Hook calls must occur in real React components; this factory owns no root or source store.
 * @param {ReactHookRuntime} runtime - Injected useMemo/useSyncExternalStore implementation; core imports no React runtime.
 * @returns {object} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
 */
export function createReactBindings(runtime: ReactHookRuntime) {
  return {
    /** Read one borrowed store through the injected native hook lifecycle.
     * @param {ExternalStore<T>} store - Borrowed external store with explicit subscription/server-read contract.
     * @param {() => T} serverSnapshot - Optional stable override matching the exact public hydration payload; never infer a missing SSR snapshot.
     * @returns {T} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    useStore<T>(store: ExternalStore<T>, serverSnapshot?: () => T) {
      return useReactStore(runtime.useSyncExternalStore, store, serverSnapshot);
    },
    /** Memoize one borrowed selector store per stable hook dependency set, then read it through useSyncExternalStore.
     * @param {ExternalStore<A>} store - Borrowed external store with explicit subscription/server-read contract.
     * @param {(state: A) => B} selector - Pure stable projection; exceptions leave the previous cache available for a later read.
     * @param {object} options - Optional equality/server snapshot policy.
     * @param {function} [options.equal] - Stable selected-value comparator, default Object.is.
     * @param {function} [options.serverSnapshot] - Stable server read matching public hydration state.
     * @returns {B} Explicit snapshot, callback result or cleanup handle; source ownership remains with the host.
     */
    useSelector<A, B>(
      store: ExternalStore<A>,
      selector: (state: A) => B,
      options: {
        /** Optional stable comparator, default Object.is. */
        equal?: (a: B, b: B) => boolean;
        /** Explicit pinned value/callback matching public SSR data; absence is not replaced by client state. */
        serverSnapshot?: () => A;
      } = {}
    ) {
      /** Borrowed memoized selected store; native React owns subscriptions, host owns source lifetime. */
      const derived = runtime.useMemo(
        () =>
          selectReactStore(
            options.serverSnapshot
              ? {
                  getSnapshot: store.getSnapshot,
                  subscribe: store.subscribe,
                  getServerSnapshot: options.serverSnapshot,
                }
              : store,
            selector,
            options.equal
          ),
        [store, selector, options.equal, options.serverSnapshot]
      );
      return runtime.useSyncExternalStore(
        derived.subscribe,
        derived.getSnapshot,
        derived.getServerSnapshot
      );
    },
  };
}
