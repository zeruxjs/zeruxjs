import { AsyncLocalStorage } from 'node:async_hooks';

export interface Context<T> { readonly id: symbol; readonly defaultValue?: T }
const storage = new AsyncLocalStorage<Map<symbol, unknown>>();

export function createContext<T>(defaultValue?: T): Context<T> {
  return Object.freeze({ id: Symbol('zerux_context'), defaultValue });
}

/** Runs the callback with a request-scoped context store. */
export function runWithContext<T>(callback: () => T): T {
  return storage.run(new Map(), callback);
}

export function setContext<T>(context: Context<T>, value: T): void {
  const store = storage.getStore();
  if (!store) throw new Error('[zerux] No active context');
  store.set(context.id, value);
}

export function useContext<T>(context: Context<T>): T {
  const store = storage.getStore();
  if (!store) throw new Error('[zerux] useContext called outside context');
  return (store.has(context.id) ? store.get(context.id) : context.defaultValue) as T;
}

/** Temporarily overrides a context for nested async operations. */
export function withContext<T, R>(context: Context<T>, value: T, callback: () => R): R {
  const parent = storage.getStore();
  if (!parent) throw new Error('[zerux] No active context');
  const child = new Map(parent);
  child.set(context.id, value);
  return storage.run(child, callback);
}

export function runWithRequestHooks<T>(callback: () => T): T {
  // Imported lazily only to avoid duplicating scopes between entry points.
  return runWithContext(() => runState(callback));
}
import { runWithState as runState } from './state.js';
