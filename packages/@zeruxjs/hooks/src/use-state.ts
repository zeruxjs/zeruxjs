import { AsyncLocalStorage } from "node:async_hooks";

type HookInstance = {
    states: unknown[];
    index: number;
};

type Store = {
    instances: WeakMap<object, HookInstance>;
};

const storage = new AsyncLocalStorage<Store>();

/**
 * Run request scope
 */
export function runWithState<T>(fn: () => T): T {
    return storage.run(
        {
            instances: new WeakMap()
        },
        fn
    );
}

/**
 * Run a hook-enabled function (like React component)
 */
export function runHooks<T>(fn: () => T): T {
    const store = storage.getStore();

    if (!store) {
        throw new Error("[zerux] runHooks must be inside runWithState");
    }

    const key = {}; // unique per execution

    const instance: HookInstance = {
        states: [],
        index: 0
    };

    store.instances.set(key, instance);

    // attach instance temporarily
    currentInstance = instance;

    try {
        return fn();
    } finally {
        currentInstance = null;
    }
}

/**
 * Current active instance (like React fiber)
 */
let currentInstance: HookInstance | null = null;

/**
 * useState (React-like)
 */
export function useState<T>(initialValue: T): [T, (v: T) => void] {
    if (!currentInstance) {
        throw new Error("[zerux] useState must be called inside runHooks");
    }

    const i = currentInstance.index;

    if (currentInstance.states[i] === undefined) {
        currentInstance.states[i] = initialValue;
    }

    const setState = (value: T): void => {
        currentInstance!.states[i] = value;
    };

    const value = currentInstance.states[i] as T;

    currentInstance.index++;

    return [value, setState];
}