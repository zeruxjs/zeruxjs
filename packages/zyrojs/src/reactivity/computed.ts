import { effect } from './effect.js';
import { signal } from './signal.js';
import type { ReadonlySignal } from './types.js';

export interface ComputedSignal<T> extends ReadonlySignal<T> { dispose(): void; }
/** A tracked read-only derivation. Dispose explicitly or create inside an effect scope. */
export function computed<T>(derive: () => T): ComputedSignal<T> {
  const result = signal<T>(undefined as T);
  let initialized = false;
  const stop = effect(() => {
    const value = derive();
    initialized = true;
    result.value = value;
  });
  return {
    get value() { return result.value; },
    peek() { return initialized ? result.peek() : derive(); },
    dispose: stop
  };
}
