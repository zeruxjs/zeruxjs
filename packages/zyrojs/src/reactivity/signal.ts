import { getCurrentSubscriber, trackDependency } from "./effect.js";
import type { Signal, Subscriber } from "./types.js";

let batchDepth = 0;
const pendingEffects = new Set<Subscriber>();
let flushing = false;
const schedule = (subscriber: Subscriber) => {
    if (batchDepth || flushing) { pendingEffects.add(subscriber); return; }
    subscriber();
};
const flush = () => {
    if (flushing) return;
    flushing = true;
    try {
        let cycles = 0;
        while (pendingEffects.size) {
            if (++cycles > 1000) throw new Error("ZyroJS: possible reactive update loop");
            const current = [...pendingEffects];
            pendingEffects.clear();
            for (const subscriber of current) subscriber();
        }
    } finally { flushing = false; }
};
export function batch<T>(fn: () => T): T {
    batchDepth++;
    try { return fn(); }
    finally { if (--batchDepth === 0) flush(); }
}
class SignalImpl<T> implements Signal<T> {
    private _subscribers = new Set<Subscriber>();
    constructor(private _value: T) {}
    get value(): T {
        const subscriber = getCurrentSubscriber();
        if (subscriber && !this._subscribers.has(subscriber)) {
            this._subscribers.add(subscriber);
            trackDependency(() => this._subscribers.delete(subscriber));
        }
        return this._value;
    }
    set value(next: T) {
        if (Object.is(this._value, next)) return;
        this._value = next;
        for (const subscriber of [...this._subscribers]) schedule(subscriber);
    }
    peek(): T { return this._value; }
}
export function signal<T>(initialValue: T): Signal<T> { return new SignalImpl(initialValue); }

export function reactive<T extends object>(target: T): T {
    const signals = new Map<PropertyKey, Signal<unknown>>();
    return new Proxy(target, {
        get(obj, prop, receiver) {
            if (!signals.has(prop)) signals.set(prop, signal(Reflect.get(obj, prop, receiver)));
            return signals.get(prop)!.value;
        },
        set(obj, prop, value, receiver) {
            if (!Reflect.set(obj, prop, value, receiver)) return false;
            if (!signals.has(prop)) signals.set(prop, signal(value));
            else signals.get(prop)!.value = value;
            return true;
        },
        deleteProperty(obj, prop) {
            if (!Reflect.deleteProperty(obj, prop)) return false;
            signals.get(prop)!.value = undefined;
            return true;
        }
    });
}
