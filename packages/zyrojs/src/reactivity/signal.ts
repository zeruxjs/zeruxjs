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
    /** Stores the subscriber value used by this module. */
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
 * signal.
 * @param {T} initialValue - Input value for this operation.
 * @returns {Signal<T>} Result produced by this operation.
 */
export function signal<T>(initialValue: T): Signal<T> {
  return new SignalImpl(initialValue);
}

/** Stores the proxies value used by this module. */
const proxies = new WeakMap<object, object>();
/** Lazily proxied objects/arrays with property, membership and key-enumeration tracking. */
/**
 * reactive.
 * @param {T} target - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function reactive<T extends object>(target: T): T {
  // Do not proxy native collections, Dates, typed arrays or class instances:
  // their internal slots/method receivers are not compatible with a generic Proxy.
  /** Stores the proto value used by this module. */
  const proto = Object.getPrototypeOf(target);
  if (!Array.isArray(target) && proto !== Object.prototype && proto !== null) {
    return target;
  }
  if (proxies.has(target)) {
    return proxies.get(target) as T;
  }
  /** Stores the versions value used by this module. */
  const versions = new Map<PropertyKey, Signal<number>>();
  /** Stores the membership value used by this module. */
  const membership = new Map<PropertyKey, Signal<number>>();
  /** Stores the keys value used by this module. */
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
    /** Stores the version value used by this module. */
    const version = store.get(property);
    if (version) {
      version.value++;
    }
  };
  /** Stores the proxy value used by this module. */
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
      /** Stores the value value used by this module. */
      const value: unknown = Reflect.get(obj, property, receiver);
      // Proxy invariants require exact values for frozen, non-configurable slots.
      /** Stores the descriptor value used by this module. */
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
      /** Stores the old value used by this module. */
      const old = Reflect.get(obj, property, receiver);
      /** Stores the existed value used by this module. */
      const existed = Object.prototype.hasOwnProperty.call(obj, property);
      /** Stores the oldLength value used by this module. */
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
      /** Stores the existed value used by this module. */
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
      /** Stores the existed value used by this module. */
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
/** Stores the ref value used by this module. */
export const ref = signal;
