import { assertSetupHook } from '../dom/component.js';
import { signal, effect, computed, reactive } from '../reactivity/index.js';
/** Lightweight signal helpers; these are NOT React hooks and require no hook dispatcher. */
/**
 * useState.
 * @param {T} initial - Input value for this operation.
 * @returns {[() => T, (next: T) => void]} Result produced by this operation.
 */
export function useState<T>(initial: T): [() => T, (next: T) => void] {
  assertSetupHook();
  /** Stores the state value used by this module. */
  const state = signal(initial);
  return [
    () => state.value,
    (next) => {
      state.value = next;
    },
  ];
}
/**
 * useReactive.
 * @param {T} initial - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function useReactive<T extends object>(initial: T): T {
  assertSetupHook();
  return reactive(initial);
}
/** Returns the cleanup function; own it in a scope or dispose on unmount. */
/**
 * useEffect.
 * @param {() => void | (() => void)} fn - Input value for this operation.
 * @returns {() => void} Result produced by this operation.
 */
export function useEffect(fn: () => void | (() => void)): () => void {
  assertSetupHook();
  return effect(fn);
}
/** Returned getter also has .dispose() for deterministic lifecycle ownership. */
/**
 * useMemo.
 * @param {() => T} fn - Input value for this operation.
 * @returns {(() => T) & { dispose(): void }} Result produced by this operation.
 */
export function useMemo<T>(fn: () => T): (() => T) & { dispose(): void } {
  assertSetupHook();
  /** Stores the derived value used by this module. */
  const derived = computed(fn);
  /**
   * Application function getter.
   * @returns {unknown} Result produced by this operation.
   */
  const getter = () => derived.value;
  return Object.assign(getter, { dispose: () => derived.dispose() });
}
/**
 * useRef.
 * @param {T} value - Input value for this operation.
 * @returns {{ current: T }} Result produced by this operation.
 */
export function useRef<T>(value: T): { current: T } {
  assertSetupHook();
  return { current: value };
}
