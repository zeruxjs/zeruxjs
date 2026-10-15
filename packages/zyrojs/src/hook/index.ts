import { signal, effect, computed, reactive } from "../reactivity/index.js";

/**
 * @title ZyroJS Hooks
 * @description React-like hooks built on top of the reactivity system.
 */

/**
 * @description State hook.
 * @param {T} initialValue
 * @returns {[() => T, (val: T) => void]}
 */
export function useState<T>(initialValue: T): [() => T, (val: T) => void] {
    const s = signal(initialValue);
    const getter = () => s.value;
    const setter = (val: T) => {
        s.value = val;
    };
    return [getter, setter];
}

/**
 * @description Reactive object hook.
 * @param {T} initialValue
 * @returns {T}
 */
export function useReactive<T extends object>(initialValue: T): T {
    return reactive(initialValue);
}

/**
 * @description Effect hook.
 * @param {() => void} fn
 */
export function useEffect(fn: () => void): void {
    effect(fn);
}

/**
 * @description Memo hook.
 * @param {() => T} fn
 * @returns {() => T}
 */
export function useMemo<T>(fn: () => T): () => T {
    const c = computed(fn);
    return () => c.value;
}

/**
 * @description Ref hook.
 * @param {T} initialValue
 * @returns {{ current: T }}
 */
export function useRef<T>(initialValue: T): { current: T } {
    return { current: initialValue };
}
