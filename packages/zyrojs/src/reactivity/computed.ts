import { effect } from './effect.js';
import { signal } from './signal.js';
import type { ReadonlySignal } from './types.js';

export interface ComputedSignal<T> extends ReadonlySignal<T> {
  dispose(): void;
}
/** A tracked read-only derivation. Dispose explicitly or create inside an effect scope. */
/**
 * computed.
 * @param {() => T} derive - Input value for this operation.
 * @returns {ComputedSignal<T>} Result produced by this operation.
 */
export function computed<T>(derive: () => T): ComputedSignal<T> {
  /** Stores the result value used by this module. */
  const result = signal<T>(undefined as T);
  let initialized = false;
  /** Stores the stop value used by this module. */
  const stop = effect(() => {
    /** Stores the value value used by this module. */
    const value = derive();
    initialized = true;
    result.value = value;
  });
  return {
    /**
     * value.
     * @returns {unknown} Result produced by this operation.
     */
    get value() {
      return result.value;
    },
    /**
     * peek.
     * @returns {unknown} Result produced by this operation.
     */
    peek() {
      return initialized ? result.peek() : derive();
    },
    dispose: stop,
  };
}
