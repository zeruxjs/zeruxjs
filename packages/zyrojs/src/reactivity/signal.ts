import {
  getCurrentSubscriber,
  trackDependency,
  scheduleEffect,
  batch,
} from './effect.js';
import type { Signal, Subscriber } from './types.js';
export { batch } from './effect.js';

/** Mutable signal implementation that tracks subscribers and schedules updates. */
class SignalImpl<T> implements Signal<T> {
  private readonly subscribers = new Set<Subscriber>();
  /**
   * Create a signal with its initial value.
   *
   * @param {T} current - Initial signal value.
   */
  constructor(private current: T) {}
  /**
   * value.
   * @returns {T} Result produced by this operation.
   */
  get value(): T {
    /** Currently tracking effect; each subscription registers its own removal with that effect. */
    const subscriber = getCurrentSubscriber();
    if (subscriber && !this.subscribers.has(subscriber)) {
      this.subscribers.add(subscriber);
      trackDependency(() => this.subscribers.delete(subscriber));
    }
    return this.current;
  }
  /**
   * value.
   * @param {T} next - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  set value(next: T) {
    if (Object.is(this.current, next)) {
      return;
    }
    this.current = next;
    batch(() => {
      for (const subscriber of [...this.subscribers]) {
        scheduleEffect(subscriber);
      }
    });
  }
  /**
   * peek.
   * @returns {T} Result produced by this operation.
   */
  peek(): T {
    return this.current;
  }
}
/**
 * Create a mutable signal with synchronous tracked reads and batched notifications.
 * @param {T} initialValue - Initial value retained by reference; no cloning or freezing is performed.
 * @returns {Signal<T>} Mutable value accessor plus an untracked peek.
 */
export function signal<T>(initialValue: T): Signal<T> {
  return new SignalImpl(initialValue);
}

/** Weak identity cache for original objects and their proxies; neither is kept alive by this map. */
const proxies = new WeakMap<object, object>();
/**
 * Lazily track plain-object/array values, membership and key enumeration.
 * @param {T} target - Host-owned object; native collections and class instances remain unchanged.
 * @returns {T} Identity-cached proxy for eligible objects, otherwise the original target.
 */
export function reactive<T extends object>(target: T): T {
  // Do not proxy native collections, Dates, typed arrays or class instances:
  // their internal slots/method receivers are not compatible with a generic Proxy.
  /** Preserve native/class receivers whose internal slots cannot safely be proxied. */
  const proto = Object.getPrototypeOf(target);
  if (!Array.isArray(target) && proto !== Object.prototype && proto !== null) {
    return target;
  }
  if (proxies.has(target)) {
    return proxies.get(target) as T;
  }
  /** Independent per-property read dependencies, allocated only when observed. */
  const versions = new Map<PropertyKey, Signal<number>>();
  /** Separate dependencies for property existence so value changes do not invalidate membership alone. */
  const membership = new Map<PropertyKey, Signal<number>>();
  /** Enumeration version, changed when own properties are added or removed. */
  const keys = signal(0);
  /**
   * Application function track.
   * @param {Map<PropertyKey, Signal<number>>} store - Input value for this operation.
   * @param {PropertyKey} property - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const track = (
    store: Map<PropertyKey, Signal<number>>,
    property: PropertyKey
  ) => {
    let version = store.get(property);
    if (!version) {
      version = signal(0);
      store.set(property, version);
    }
    void version.value;
  };
  /**
   * Application function notify.
   * @param {Map<PropertyKey, Signal<number>>} store - Input value for this operation.
   * @param {PropertyKey} property - Input value for this operation.
   * @returns {unknown} Result produced by this operation.
   */
  const notify = (
    store: Map<PropertyKey, Signal<number>>,
    property: PropertyKey
  ) => {
    /** Existing dependency version; unobserved properties need no notification signal. */
    const version = store.get(property);
    if (version) {
      version.value++;
    }
  };
  /** Stable reactive wrapper; native Reflect operations preserve receiver and property semantics. */
  const proxy = new Proxy(target, {
    /**
     * get.
     * @param {unknown} obj - Input value for this operation.
     * @param {unknown} property - Input value for this operation.
     * @param {unknown} receiver - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    get(obj, property, receiver) {
      track(versions, property);
      /** Actual property value, recursively wrapped only when proxy invariants permit it. */
      const value: unknown = Reflect.get(obj, property, receiver);
      // Proxy invariants require exact values for frozen, non-configurable slots.
      /** Frozen nonconfigurable data slots must return their exact original value. */
      const descriptor = Reflect.getOwnPropertyDescriptor(obj, property);
      if (
        descriptor &&
        !descriptor.configurable &&
        'writable' in descriptor &&
        !descriptor.writable
      ) {
        return value;
      }
      return value !== null && typeof value === 'object'
        ? reactive(value)
        : value;
    },
    /**
     * has.
     * @param {unknown} obj - Input value for this operation.
     * @param {unknown} property - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    has(obj, property) {
      track(membership, property);
      return Reflect.has(obj, property);
    },
    /**
     * ownKeys.
     * @param {unknown} obj - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    ownKeys(obj) {
      void keys.value;
      return Reflect.ownKeys(obj);
    },
    /**
     * set.
     * @param {unknown} obj - Input value for this operation.
     * @param {unknown} property - Input value for this operation.
     * @param {unknown} value - Input value for this operation.
     * @param {unknown} receiver - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    set(obj, property, value, receiver) {
      /** Value before the attempted write, used for Object.is change detection. */
      const old = Reflect.get(obj, property, receiver);
      /** Own-property membership before mutation; inherited properties do not count. */
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      /** Prior array length; index writes can also invalidate observed length. */
      const oldLength = Array.isArray(obj) ? obj.length : -1;
      if (!Reflect.set(obj, property, value, receiver)) {
        return false;
      }
      if (!Object.is(old, value)) {
        notify(versions, property);
      }
      if (!existed) {
        notify(membership, property);
        keys.value++;
      }
      if (Array.isArray(obj) && obj.length !== oldLength) {
        notify(versions, 'length');
      }
      return true;
    },
    /**
     * deleteProperty.
     * @param {unknown} obj - Input value for this operation.
     * @param {unknown} property - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    deleteProperty(obj, property) {
      /** Own-property membership before mutation; inherited properties do not count. */
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      if (!Reflect.deleteProperty(obj, property)) {
        return false;
      }
      if (existed) {
        notify(versions, property);
        notify(membership, property);
        keys.value++;
      }
      return true;
    },
    /**
     * defineProperty.
     * @param {unknown} obj - Input value for this operation.
     * @param {unknown} property - Input value for this operation.
     * @param {unknown} descriptor - Input value for this operation.
     * @returns {unknown} Result produced by this operation.
     */
    defineProperty(obj, property, descriptor) {
      /** Own-property membership before mutation; inherited properties do not count. */
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      if (!Reflect.defineProperty(obj, property, descriptor)) {
        return false;
      }
      notify(versions, property);
      if (!existed) {
        notify(membership, property);
        keys.value++;
      }
      return true;
    },
  });
  proxies.set(target, proxy);
  proxies.set(proxy, proxy);
  return proxy;
}

/** Ref is the same value/peek signal contract, not a React ref. */
/** Signal alias; DOM element holders instead use callback/current refs. */
export const ref = signal;
