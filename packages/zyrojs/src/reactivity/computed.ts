import { effect } from './effect.js';
import { signal } from './signal.js';
import type { ReadonlySignal } from './types.js';

/** Read-only eagerly tracked value with explicit subscription teardown. */
export interface ComputedSignal<T> extends ReadonlySignal<T> {
  /** Stop derivation subscriptions; retained reads expose the last computed value. */
  dispose(): void;
}
/**
 * Eagerly derive a read-only signal; dispose explicitly unless an ambient scope owns it.
 * @param {() => T} derive - Trusted synchronous computation whose signal reads become dependencies.
 * @returns {ComputedSignal<T>} Tracked read-only value and idempotent derivation disposer.
 */
export function computed<T>(derive: () => T): ComputedSignal<T> {
  /** Internal writable signal; only this derivation publishes values to it. */
  const result = signal<T>(undefined as T);
  let initialized = false;
  /** Actual tracking-effect disposer, also registered with the ambient scope. */
  const stop = effect(() => {
    /** Derive before committing so a thrown computation cannot publish a partial value. */
    const value = derive();
    initialized = true;
    result.value = value;
  });
  return {
    /**
     * Read the cached derivation and subscribe the current effect.
     * @returns {T} Last successfully computed value.
     */
    get value() {
      return result.value;
    },
    /**
     * Read the cached value without adding a dependency.
     * @returns {T} Cached value; the fallback derives if initialization has not completed.
     */
    peek() {
      return initialized ? result.peek() : derive();
    },
    dispose: stop,
  };
}
