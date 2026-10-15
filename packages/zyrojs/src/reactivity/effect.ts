import type { Subscriber } from "./types.js";

const subscriberStack: Subscriber[] = [];
const cleanupRegistry = new WeakMap<Subscriber, Set<() => void>>();

export function getCurrentSubscriber(): Subscriber | undefined {
    return subscriberStack[subscriberStack.length - 1];
}

/** Connects a dependency to the current effect, allowing stale dependencies to be removed. */
export function trackDependency(unsubscribe: () => void): void {
    const subscriber = getCurrentSubscriber();
    if (subscriber) cleanupRegistry.get(subscriber)?.add(unsubscribe);
}

/** Run a reactive effect. The returned function stops all future subscriptions. */
export function effect(callback: Subscriber): () => void {
    let active = true;
    let running = false;
    const subscriptions = new Set<() => void>();
    const clear = () => {
        for (const remove of subscriptions) remove();
        subscriptions.clear();
    };
    const run = () => {
        if (!active || running) return;
        running = true;
        clear();
        subscriberStack.push(run);
        try { callback(); }
        finally { subscriberStack.pop(); running = false; }
    };
    cleanupRegistry.set(run, subscriptions);
    run();
    return () => { active = false; clear(); cleanupRegistry.delete(run); };
}
