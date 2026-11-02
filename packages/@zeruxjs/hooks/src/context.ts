import { AsyncLocalStorage } from 'node:async_hooks';

export interface Context<T> { readonly id: symbol; readonly defaultValue?: T }
type ContextStore = { values: Map<symbol, unknown>; closed: boolean; parent?: ContextStore };
const storage = new AsyncLocalStorage<ContextStore>();
function current() {
  const store = storage.getStore(); let cursor = store;
  while (cursor) { if (cursor.closed) throw new Error('[zerux] Request context disposed'); cursor = cursor.parent; }
  return store;
}

export function createContext<T>(defaultValue?: T): Context<T> {
  return Object.freeze({ id: Symbol('zerux_context'), defaultValue });
}

/** Runs the callback with a request-scoped context store. */
export function runWithContext<T>(callback: () => T): T {
  return storage.run({ values: new Map(), closed: false }, callback);
}

export function setContext<T>(context: Context<T>, value: T): void {
  const store = current();
  if (!store) throw new Error('[zerux] No active context');
  store.values.set(context.id, value);
}

export function useContext<T>(context: Context<T>): T {
  const store = current();
  if (!store) throw new Error('[zerux] useContext called outside context');
  return (store.values.has(context.id) ? store.values.get(context.id) : context.defaultValue) as T;
}

/** Temporarily overrides a context for nested async operations. */
export function withContext<T, R>(context: Context<T>, value: T, callback: () => R): R {
  const parent = current();
  if (!parent) throw new Error('[zerux] No active context');
  const values = new Map(parent.values);
  values.set(context.id, value);
  const child: ContextStore = { values, closed: false, parent };
  return storage.run(child, callback);
}

export function runWithRequestHooks<T>(callback: () => T): T {
  // Imported lazily only to avoid duplicating scopes between entry points.
  return runWithContext(() => runState(callback));
}
import { runWithState as runState } from './state.js';

/** Request lifetime independent of handler promise settlement, including streamed responses/disconnects. */
export function createRequestHookScope() {
  const context: ContextStore = { values: new Map(), closed: false }, state = createServerStateScope();
  return {
    run<T>(callback: () => T): T { if (context.closed) throw new Error('[zerux] Request context disposed'); return storage.run(context, () => state.run(callback)); },
    dispose() { if (context.closed) return; try { storage.run(context, () => state.dispose()); } finally { context.closed = true; context.values.clear(); } }
  };
}
import { createServerStateScope } from './state.js';
