import { effect } from "./effect.js";
import { signal } from "./signal.js";
import type { ReadonlySignal } from "./types.js";

/** Lazy to consume and automatically tracks conditional dependencies. */
export function computed<T>(derive: () => T): ReadonlySignal<T> {
    const result = signal<T>(undefined as T);
    let initialized = false;
    effect(() => {
        const next = derive();
        initialized = true;
        result.value = next;
    });
    return {
        get value() { return result.value; },
        peek() { return initialized ? result.peek() : derive(); }
    };
}
