import { AsyncLocalStorage } from "node:async_hooks";

type ContextStore = {
    contexts: Map<symbol, unknown>;
};

const storage = new AsyncLocalStorage<ContextStore>();

/**
 * Run a request with shared context
 */
export function runWithContext<T>(fn: () => T): T {
    return storage.run(
        {
            contexts: new Map()
        },
        fn
    );
}

/**
 * Create context
 */
export function createContext<T>(defaultValue?: T) {
    const id = Symbol("zerux_context");

    return {
        id,
        defaultValue
    };
}

/**
 * Set context value
 */
export function setContext<T>(ctx: { id: symbol }, value: T): void {
    const store = storage.getStore();

    if (!store) {
        throw new Error("[zerux] No active context");
    }

    store.contexts.set(ctx.id, value);
}

/**
 * Get context value
 */
export function useContext<T>(ctx: { id: symbol; defaultValue?: T }): T {
    const store = storage.getStore();

    if (!store) {
        throw new Error("[zerux] useContext called outside context");
    }

    if (store.contexts.has(ctx.id)) {
        return store.contexts.get(ctx.id) as T;
    }

    return ctx.defaultValue as T;
}