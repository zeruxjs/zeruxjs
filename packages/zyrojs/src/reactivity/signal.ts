import { getCurrentSubscriber, trackDependency, scheduleEffect } from './effect.js';
import type { Signal, Subscriber } from './types.js';
export { batch } from './effect.js';

class SignalImpl<T> implements Signal<T> {
  private readonly subscribers = new Set<Subscriber>();
  constructor(private current: T) {}
  get value(): T {
    const subscriber = getCurrentSubscriber();
    if (subscriber && !this.subscribers.has(subscriber)) {
      this.subscribers.add(subscriber);
      trackDependency(() => this.subscribers.delete(subscriber));
    }
    return this.current;
  }
  set value(next: T) {
    if (Object.is(this.current, next)) return;
    this.current = next;
    for (const subscriber of [...this.subscribers]) scheduleEffect(subscriber);
  }
  peek(): T { return this.current; }
}
export function signal<T>(initialValue: T): Signal<T> { return new SignalImpl(initialValue); }

const proxies = new WeakMap<object, object>();
/** Lazily proxied objects/arrays with property, membership and key-enumeration tracking. */
export function reactive<T extends object>(target: T): T {
  // Do not proxy native collections, Dates, typed arrays or class instances:
  // their internal slots/method receivers are not compatible with a generic Proxy.
  const proto = Object.getPrototypeOf(target);
  if (!Array.isArray(target) && proto !== Object.prototype && proto !== null) return target;
  if (proxies.has(target)) return proxies.get(target) as T;
  const versions = new Map<PropertyKey, Signal<number>>();
  const membership = new Map<PropertyKey, Signal<number>>();
  const keys = signal(0);
  const track = (store: Map<PropertyKey, Signal<number>>, property: PropertyKey) => {
    let version = store.get(property);
    if (!version) { version = signal(0); store.set(property, version); }
    void version.value;
  };
  const notify = (store: Map<PropertyKey, Signal<number>>, property: PropertyKey) => {
    const version = store.get(property);
    if (version) version.value++;
  };
  const proxy = new Proxy(target, {
    get(obj, property, receiver) {
      track(versions, property);
      const value: unknown = Reflect.get(obj, property, receiver);
      // Proxy invariants require exact values for frozen, non-configurable slots.
      const descriptor = Reflect.getOwnPropertyDescriptor(obj, property);
      if (descriptor && !descriptor.configurable && 'writable' in descriptor && !descriptor.writable) return value;
      return value !== null && typeof value === 'object' ? reactive(value) : value;
    },
    has(obj, property) { track(membership, property); return Reflect.has(obj, property); },
    ownKeys(obj) { void keys.value; return Reflect.ownKeys(obj); },
    set(obj, property, value, receiver) {
      const old = Reflect.get(obj, property, receiver);
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      const oldLength = Array.isArray(obj) ? obj.length : -1;
      if (!Reflect.set(obj, property, value, receiver)) return false;
      if (!Object.is(old, value)) notify(versions, property);
      if (!existed) { notify(membership, property); keys.value++; }
      if (Array.isArray(obj) && obj.length !== oldLength) notify(versions, 'length');
      return true;
    },
    deleteProperty(obj, property) {
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      if (!Reflect.deleteProperty(obj, property)) return false;
      if (existed) { notify(versions, property); notify(membership, property); keys.value++; }
      return true;
    },
    defineProperty(obj, property, descriptor) {
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      if (!Reflect.defineProperty(obj, property, descriptor)) return false;
      notify(versions, property);
      if (!existed) { notify(membership, property); keys.value++; }
      return true;
    }
  });
  proxies.set(target, proxy);
  proxies.set(proxy, proxy);
  return proxy;
}
