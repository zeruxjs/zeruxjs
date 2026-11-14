import { AsyncLocalStorage } from 'node:async_hooks';

/** Frozen server context identity/default descriptor; values and defaults remain borrowed. */
export interface Context<T> {
  /** Opaque server-created symbol identity, not a principal or bearer credential. */
  readonly id: symbol;
  /** Optional borrowed fallback reference; no deep copying or per-request default cloning. */
  readonly defaultValue?: T;
}
/** Async-local value map with explicit ancestor-lifetime invalidation. */
type ContextStore = {
  /** Per-context symbol/value map with borrowed values. */
  values: Map<symbol, unknown>;
  /** Whether the explicit owner has invalidated this context. */
  closed: boolean;
  /** Optional parent lifetime checked before child access. */
  parent?: ContextStore;
};
/** Module-owned async-context carrier; values remain per entered store, not a global user map. */
const storage = new AsyncLocalStorage<ContextStore>();
/** Read the active async context and reject any disposed ancestor before exposing its values.
 * @returns {ContextStore | undefined} Active live store or undefined outside a scope; no tenant identity is inferred.
 */
function current() {
  /** Active AsyncLocalStorage value map, checked against its ancestor lifetime. */
  const store = storage.getStore();
  let cursor = store;
  // Check every owned ancestor so a nested async context cannot escape parent disposal.
  while (cursor) {
    if (cursor.closed) {
      throw new Error('[zerux] Request context disposed');
    }
    cursor = cursor.parent;
  }
  return store;
}

/** Create a frozen identity/default descriptor without creating request state or a cleanup handle.
 * @param {T | undefined} defaultValue - Optional shared fallback reference; mutable defaults are not cloned per request.
 * @returns {Context<T>} Opaque symbol identity and borrowed fallback; never an authorization token.
 */
export function createContext<T>(defaultValue?: T): Context<T> {
  return Object.freeze({ id: Symbol('zerux_context'), defaultValue });
}

/** Enter an independent AsyncLocalStorage value map for the callback and its native async descendants.
 * @param {Function} callback - Borrowed callback; its result is returned unchanged and no automatic lifetime disposal is installed.
 * @returns {T} Callback result, including an unchanged promise when supplied.
 */
export function runWithContext<T>(callback: () => T): T {
  return storage.run({ values: new Map(), closed: false }, callback);
}

/** Assign a borrowed value in the current live context map.
 * @param {Context<T>} context - Explicit server-owned context descriptor.
 * @param {T} value - Borrowed value; object graphs are not cloned or authenticated.
 * @returns {void} No active/disposed context rejects; other context maps remain independent.
 */
export function setContext<T>(context: Context<T>, value: T): void {
  /** Active AsyncLocalStorage value map, checked against its ancestor lifetime. */
  const store = current();
  if (!store) {
    throw new Error('[zerux] No active context');
  }
  store.values.set(context.id, value);
}

/** Read the current live value, preserving an explicitly stored undefined over the fallback.
 * @param {Context<T>} context - Borrowed context descriptor; not a browser/request role claim.
 * @returns {T} Stored value or borrowed descriptor fallback; outside/disposed access rejects.
 */
export function useContext<T>(context: Context<T>): T {
  /** Active AsyncLocalStorage value map, checked against its ancestor lifetime. */
  const store = current();
  if (!store) {
    throw new Error('[zerux] useContext called outside context');
  }
  return (
    store.values.has(context.id)
      ? store.values.get(context.id)
      : context.defaultValue
  ) as T;
}

/** Enter a nested async context with a shallow-copied value map and an explicit parent lifetime link.
 * @param {Context<T>} context - Descriptor overridden only in the child.
 * @param {T} value - Borrowed override; nested object graphs remain shared references.
 * @param {Function} callback - Borrowed callback executed under the child context.
 * @returns {R} Callback result unchanged; disposing an owned ancestor invalidates later child access.
 */
export function withContext<T, R>(
  context: Context<T>,
  value: T,
  callback: () => R
): R {
  /** Live parent context retained only to enforce descendant invalidation. */
  const parent = current();
  if (!parent) {
    throw new Error('[zerux] No active context');
  }
  /** Shallow copy of parent bindings; borrowed value objects are not deep-cloned. */
  const values = new Map(parent.values);
  values.set(context.id, value);
  /** Nested value map linked to parent lifetime for escaped async access checks. */
  const child: ContextStore = { values, closed: false, parent };
  return storage.run(child, callback);
}

/** Enter matching independent context and state maps for the callback; standalone callers still own component/effect disposal.
 * @param {Function} callback - Borrowed synchronous/async host callback; render functions inside it remain synchronous.
 * @returns {T} Callback result unchanged; this helper is not an HTTP finish/close owner.
 */
export function runWithRequestHooks<T>(callback: () => T): T {
  // Reuse the shared state implementation; the static import creates no request scope itself.
  return runWithContext(() => runState(callback));
}
import { runWithState as runState } from './state.js';

/** Create an explicit request context/state owner whose lifetime can follow streamed response finish/close rather than handler promise completion.
 * @returns {object} Run/dispose facade; host must dispose once all request-owned access should be invalidated.
 */
export function createRequestHookScope() {
  /** Owned request value map invalidated independently of handler promise settlement. */
  const context: ContextStore = { values: new Map(), closed: false };
  /** Owned matching state/effect scope disposed before the context map is cleared. */
  const state = createServerStateScope();
  return {
    /** Enter this owned context/state scope without changing its explicit lifetime.
     * @param {Function} callback - Borrowed callback; late access after dispose rejects.
     * @returns {T} Callback result unchanged, without forced cancellation of arbitrary async work.
     */
    run<T>(callback: () => T): T {
      if (context.closed) {
        throw new Error('[zerux] Request context disposed');
      }
      return storage.run(context, () => state.run(callback));
    },
    /** Idempotently dispose every state effect then invalidate/clear this context even when cleanup throws.
     * @returns {void} Synchronous cleanup observation; application-created async work is not forcibly terminated.
     */
    dispose() {
      if (context.closed) {
        return;
      }
      try {
        storage.run(context, () => state.dispose());
      } finally {
        context.closed = true;
        context.values.clear();
      }
    },
  };
}
import { createServerStateScope } from './state.js';
