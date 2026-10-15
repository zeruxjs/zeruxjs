import { signal, effect, computed, reactive } from '../reactivity/index.js';
/** Lightweight signal helpers; these are NOT React hooks and require no hook dispatcher. */
export function useState<T>(initial: T): [() => T, (next: T) => void] {
  const state = signal(initial);
  return [() => state.value, next => { state.value = next; }];
}
export function useReactive<T extends object>(initial: T): T { return reactive(initial); }
/** Returns the cleanup function; own it in a scope or dispose on unmount. */
export function useEffect(fn: () => void | (() => void)): () => void { return effect(fn); }
/** Returned getter also has .dispose() for deterministic lifecycle ownership. */
export function useMemo<T>(fn: () => T): (() => T) & { dispose(): void } {
  const derived = computed(fn);
  const getter = () => derived.value;
  return Object.assign(getter, { dispose: () => derived.dispose() });
}
export function useRef<T>(value: T): { current: T } { return { current: value }; }
