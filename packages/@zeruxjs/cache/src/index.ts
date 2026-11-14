import type {
  CacheRememberOptions,
  CacheProducerContext,
  CacheManager,
  CacheSetOptions,
  CacheValue,
  MaybePromise,
} from './types.js';
import {
  configureCacheManager,
  createCacheManager,
  createCacheManagerWithHelper,
  getActiveCacheManager,
  setActiveCacheManager,
} from './manager.js';
import { createCacheError } from './utils.js';

/** Process-global compatibility facade; every operation resolves the current explicitly configured manager. Replacing it does not close previous owners. */
export const cache: CacheManager = {
  /** Read capabilities from the explicitly active compatibility manager.
   * @returns {Readonly<CacheCapabilities>|undefined} Current manager capability snapshot; missing remains unknown.
   */
  get capabilities() {
    return getActiveCacheManager().capabilities;
  },
  /** Read helper from the explicitly active compatibility manager.
   * @returns {string} Explicit configured helper label.
   */
  get helper() {
    return getActiveCacheManager().helper;
  },
  /** Read prefix from the explicitly active compatibility manager.
   * @returns {string|undefined} Current compatible namespace prefix; not an authorization grant.
   */
  get prefix() {
    return getActiveCacheManager().prefix;
  },
  /** Read defaultTtlSeconds from the explicitly active compatibility manager.
   * @returns {number|undefined} Current optional default lifetime seconds.
   */
  get defaultTtlSeconds() {
    return getActiveCacheManager().defaultTtlSeconds;
  },
  /** Read one scoped cache value; absence stays distinct from JSON null.
   * @param {string} key - Logical unprefixed key validated before dispatch.
   * @returns {MaybePromise<CacheValue|undefined>} Detached bounded data or undefined; provider failures remain explicit.
   */
  get(key: string): MaybePromise<CacheValue | undefined> {
    return getActiveCacheManager().get(key);
  },
  /** Write a bounded JSON value with explicit TTL/condition semantics. A void return never proves conditional acquisition.
   * @param {string} key - Logical cache key, never a secret.
   * @param {CacheValue} value - Inert bounded JSON data copied before storage.
   * @param {CacheSetOptions} options - Optional TTL and exclusive ifAbsent/ifPresent flags.
   * @returns {MaybePromise<void>} Provider completion only; multi-key/distributed transaction guarantees are not invented.
   */
  set(
    key: string,
    value: CacheValue,
    options?: CacheSetOptions
  ): MaybePromise<void> {
    return getActiveCacheManager().set(key, value, options);
  },
  /** Delete one exact scoped key.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing deletion.
   */
  delete(key: string): MaybePromise<boolean> {
    return getActiveCacheManager().delete(key);
  },
  /** Check exact scoped key presence with provider-owned expiry semantics.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Current provider presence; not authorization or a lock.
   */
  has(key: string): MaybePromise<boolean> {
    return getActiveCacheManager().has(key);
  },
  /** Clear the owning scope; unprefixed helpers/managers can request global clear under provider policy.
   * @returns {MaybePromise<void>} Scoped provider completion; unsupported namespace clearing fails closed.
   */
  clear(): MaybePromise<void> {
    return getActiveCacheManager().clear();
  },
  /** Read a bounded key batch and retain logical result keys, including prototype-shaped spellings as own data fields.
   * @param {string[]} keys - Bounded logical keys.
   * @returns {MaybePromise<Record<string, CacheValue|undefined>>} Detached bounded values; no multi-read snapshot guarantee.
   */
  getMany(
    keys: string[]
  ): MaybePromise<Record<string, CacheValue | undefined>> {
    return getActiveCacheManager().getMany(keys);
  },
  /** Validate/copy a bounded write batch without claiming whole-batch atomicity.
   * @param {Record<string, CacheValue>} values - Explicit logical key/value record.
   * @param {CacheSetOptions} options - Optional shared TTL/conditions.
   * @returns {MaybePromise<void>} Provider completion; partial backend writes can occur.
   */
  setMany(
    values: Record<string, CacheValue>,
    options?: CacheSetOptions
  ): MaybePromise<void> {
    return getActiveCacheManager().setMany(values, options);
  },
  /** Delete a bounded explicit key batch with provider-reported count.
   * @param {string[]} keys - Bounded logical key list.
   * @returns {MaybePromise<number>} Reported deletion count; not a transaction across keys.
   */
  deleteMany(keys: string[]): MaybePromise<number> {
    return getActiveCacheManager().deleteMany(keys);
  },
  /** Apply a nonnegative integer increment using declared provider counter semantics.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; native mutation may precede a precision-result rejection.
   */
  increment(key: string, amount?: number): MaybePromise<number> {
    return getActiveCacheManager().increment(key, amount);
  },
  /** Apply a nonnegative integer decrement without normalizing backend-specific zero behavior.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; memory/Redis signed and Memcached clamped behavior remain distinct.
   */
  decrement(key: string, amount?: number): MaybePromise<number> {
    return getActiveCacheManager().decrement(key, amount);
  },
  /** Refresh an existing key lifetime under explicit positive TTL validation.
   * @param {string} key - Logical key.
   * @param {number} ttlSeconds - Positive finite lifetime seconds.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing key was touched.
   */
  touch(key: string, ttlSeconds: number): MaybePromise<boolean> {
    return getActiveCacheManager().touch(key, ttlSeconds);
  },
  /** Stop new work and release only resources owned by this facade/helper. Manager close drains native work/producers; memory helper close clears its local map.
   * @returns {MaybePromise<void>} Cleanup completion, not forced cancellation of arbitrary host promises.
   */
  close(): MaybePromise<void> {
    return getActiveCacheManager().close();
  },
  /** Coalesce one process-local miss job per manager/key with finite actual-settlement ownership. Waiter cancellation only detaches that subscriber.
   * @param {string} key - Logical key whose first admitted producer policy governs shared work.
   * @param {(context: CacheProducerContext) => MaybePromise<CacheValue>} producer - Trusted cooperative callback receiving signal/deadline.
   * @param {CacheRememberOptions} options - Optional first-job TTL/conditions and waiter cancellation/deadline settings.
   * @returns {Promise<CacheValue>} Produced/read value; failed/cancelled late work never writes the cache automatically.
   */
  remember(
    key: string,
    producer: (context: CacheProducerContext) => MaybePromise<CacheValue>,
    options?: CacheRememberOptions
  ) {
    return getActiveCacheManager().remember(key, producer, options);
  },
  /** Expose the privileged native helper handle to trusted host code only.
   * @returns {unknown} Escape hatch bypassing facade safety/namespace guarantees if used directly.
   */
  native(): unknown {
    return getActiveCacheManager().native();
  },
};

/** Read one scoped cache value; absence stays distinct from JSON null.
 * @param {string} key - Logical unprefixed key validated before dispatch.
 * @returns {MaybePromise<CacheValue|undefined>} Detached bounded data or undefined; provider failures remain explicit. */
export const get = (key: string) => getActiveCacheManager().get(key);
/** Write a bounded JSON value with explicit TTL/condition semantics. A void return never proves conditional acquisition.
 * @param {string} key - Logical cache key, never a secret.
 * @param {CacheValue} value - Inert bounded JSON data copied before storage.
 * @param {CacheSetOptions} options - Optional TTL and exclusive ifAbsent/ifPresent flags.
 * @returns {MaybePromise<void>} Provider completion only; multi-key/distributed transaction guarantees are not invented. */
export const set = (
  key: string,
  value: CacheValue,
  options?: CacheSetOptions
) => getActiveCacheManager().set(key, value, options);
/** Delete one exact scoped key.
 * @param {string} key - Logical key under the owning namespace.
 * @returns {MaybePromise<boolean>} Whether the provider reports an existing deletion. */
export const remove = (key: string) => getActiveCacheManager().delete(key);
/** Check exact scoped key presence with provider-owned expiry semantics.
 * @param {string} key - Logical key under the owning namespace.
 * @returns {MaybePromise<boolean>} Current provider presence; not authorization or a lock. */
export const has = (key: string) => getActiveCacheManager().has(key);
/** Clear the owning scope; unprefixed helpers/managers can request global clear under provider policy.

 * @returns {MaybePromise<void>} Scoped provider completion; unsupported namespace clearing fails closed. */
export const clear = () => getActiveCacheManager().clear();
/** Read a bounded key batch and retain logical result keys, including prototype-shaped spellings as own data fields.
 * @param {string[]} keys - Bounded logical keys.
 * @returns {MaybePromise<Record<string, CacheValue|undefined>>} Detached bounded values; no multi-read snapshot guarantee. */
export const getMany = (keys: string[]) =>
  getActiveCacheManager().getMany(keys);
/** Validate/copy a bounded write batch without claiming whole-batch atomicity.
 * @param {Record<string, CacheValue>} values - Explicit logical key/value record.
 * @param {CacheSetOptions} options - Optional shared TTL/conditions.
 * @returns {MaybePromise<void>} Provider completion; partial backend writes can occur. */
export const setMany = (
  values: Record<string, CacheValue>,
  options?: CacheSetOptions
) => getActiveCacheManager().setMany(values, options);
/** Delete a bounded explicit key batch with provider-reported count.
 * @param {string[]} keys - Bounded logical key list.
 * @returns {MaybePromise<number>} Reported deletion count; not a transaction across keys. */
export const deleteMany = (keys: string[]) =>
  getActiveCacheManager().deleteMany(keys);
/** Apply a nonnegative integer increment using declared provider counter semantics.
 * @param {string} key - Logical counter key.
 * @param {number} amount - Nonnegative safe integer delta, default one.
 * @returns {MaybePromise<number>} Safe integer result; native mutation may precede a precision-result rejection. */
export const increment = (key: string, amount?: number) =>
  getActiveCacheManager().increment(key, amount);
/** Apply a nonnegative integer decrement without normalizing backend-specific zero behavior.
 * @param {string} key - Logical counter key.
 * @param {number} amount - Nonnegative safe integer delta, default one.
 * @returns {MaybePromise<number>} Safe integer result; memory/Redis signed and Memcached clamped behavior remain distinct. */
export const decrement = (key: string, amount?: number) =>
  getActiveCacheManager().decrement(key, amount);
/** Refresh an existing key lifetime under explicit positive TTL validation.
 * @param {string} key - Logical key.
 * @param {number} ttlSeconds - Positive finite lifetime seconds.
 * @returns {MaybePromise<boolean>} Whether the provider reports an existing key was touched. */
export const touch = (key: string, ttlSeconds: number) =>
  getActiveCacheManager().touch(key, ttlSeconds);
/** Coalesce one process-local miss job per manager/key with finite actual-settlement ownership. Waiter cancellation only detaches that subscriber.
 * @param {string} key - Logical key whose first admitted producer policy governs shared work.
 * @param {(context: CacheProducerContext) => MaybePromise<CacheValue>} producer - Trusted cooperative callback receiving signal/deadline.
 * @param {CacheRememberOptions} options - Optional first-job TTL/conditions and waiter cancellation/deadline settings.
 * @returns {Promise<CacheValue>} Produced/read value; failed/cancelled late work never writes the cache automatically. */
export const remember = (
  key: string,
  producer: (context: CacheProducerContext) => MaybePromise<CacheValue>,
  options?: CacheRememberOptions
) => getActiveCacheManager().remember(key, producer, options);
/** Expose the privileged native helper handle to trusted host code only.

 * @returns {unknown} Escape hatch bypassing facade safety/namespace guarantees if used directly. */
export const native = () => getActiveCacheManager().native();

export { remove as delete };
export {
  configureCacheManager,
  createCacheError,
  createCacheManager,
  createCacheManagerWithHelper,
  getActiveCacheManager,
  setActiveCacheManager,
};
export type {
  CacheCapabilities,
  CacheCapability,
  CachePolicy,
  CacheRememberOptions,
  CacheProducerContext,
  CacheErrorShape,
  CacheHelper,
  CacheHelperFactory,
  CacheManager,
  CacheManagerConfig,
  CachePrimitive,
  CacheSetOptions,
  CacheValue,
  MaybePromise,
} from './types.js';

export default cache;

export { createMemoryCacheHelper } from './memory.js';
export type { MemoryCacheOptions, MemoryCacheStats } from './memory.js';
