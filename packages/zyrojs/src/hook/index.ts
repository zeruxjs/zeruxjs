import { assertSetupHook } from '../dom/component.js';
import { signal, effect, computed, reactive } from '../reactivity/index.js';
/** Lightweight signal helpers; these are NOT React hooks and require no hook dispatcher. */
/**
 * Allocate a signal-backed getter/setter pair once during component setup or standalone use.
 * @param {T} initial - Initial state retained by reference; no lazy initializer convention is applied.
 * @returns {[() => T, (next: T) => void]} Tracked getter and direct value setter; functions are values, not updater callbacks.
 */
export function useState<T>(initial: T): [() => T, (next: T) => void] {
  assertSetupHook();
  /** Signal owned by the returned closures; setup callers retain it across subsequent renders. */
  const state = signal(initial);
  return [
    () => state.value,
    (next) => {
      state.value = next;
    },
  ];
}
/**
 * Wrap an eligible object with property-tracked reactivity; no positional hook slots are used.
 * @param {T} initial - Initial state retained by reference; no lazy initializer convention is applied.
 * @returns {T} Stable reactive proxy, or original native/class object.
 */
export function useReactive<T extends object>(initial: T): T {
  assertSetupHook();
  return reactive(initial);
}
/** Returns the cleanup function; own it in a scope or dispose on unmount. */
/**
 * Start a synchronous effect; cleanup is owned by the active scope or returned stop handle.
 * @param {() => void | (() => void)} fn - Synchronous tracked callback; asynchronous continuations do not inherit dependency tracking.
 * @returns {() => void} Idempotent stop callback that releases subscriptions and final user cleanup.
 */
export function useEffect(fn: () => void | (() => void)): () => void {
  assertSetupHook();
  return effect(fn);
}
/** Returned getter also has .dispose() for deterministic lifecycle ownership. */
/**
 * Eagerly derive a cached value and expose explicit subscription teardown.
 * @param {() => T} fn - Synchronous tracked callback; asynchronous continuations do not inherit dependency tracking.
 * @returns {(() => T) & { dispose(): void }} Tracked cached getter with an idempotent dispose method.
 */
export function useMemo<T>(fn: () => T): (() => T) & { dispose(): void } {
  assertSetupHook();
  /** Derived signal whose subscriptions must be disposed explicitly unless scoped. */
  const derived = computed(fn);
  /**
   * Read the cached derivation, subscribing any current effect.
   * @returns {T} Last successfully derived value.
   */
  const getter = () => derived.value;
  return Object.assign(getter, { dispose: () => derived.dispose() });
}
/**
 * Create a nonreactive mutable holder for setup-owned references.
 * @param {T} value - Initial holder contents; changes do not schedule renders.
 * @returns {{ current: T }} Plain holder; DOM reconciliation can assign element/null to compatible refs.
 */
export function useRef<T>(value: T): { current: T } {
  assertSetupHook();
  return { current: value };
}
