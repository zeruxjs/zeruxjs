import {
  cachePolicy,
  cacheKey,
  cacheSetOptions,
  cacheValue,
  cacheBulk,
} from './policy.js';
import type { CachePolicy } from './types.js';
import type { CacheHelper, CacheSetOptions, CacheValue } from './types.js';

export interface MemoryCacheOptions {
  /** Positive LRU entry bound, default 1000. */
  maxEntries?: number;
  /** Optional direct-helper finite JSON/key/bulk limits. */
  policy?: CachePolicy;
  /** Injected clock for deterministic testing; milliseconds since Unix epoch. */
  now?: () => number;
}
export interface MemoryCacheStats {
  /** Current unexpired process-local entries. */
  entries: number;
  /** Successful local get count. */
  hits: number;
  /** Missing/expired local get count. */
  misses: number;
  /** LRU removals due to capacity, not expiration. */
  evictions: number;
}
interface Entry {
  /** Owned inert JSON value. */
  value: CacheValue;
  /** Optional absolute millisecond expiry; absence means no TTL. */
  expiresAt?: number;
}

/** Create a defensive JSON copy after outer policy validation.
 * @param {CacheValue} value - Validated inert JSON data.
 * @returns {CacheValue} Detached value; unsupported serialization rejects. */
const clone = (value: CacheValue): CacheValue => {
  /** Serialized owned JSON used only for defensive copying. */
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Cache values must be JSON serializable');
  }
  return JSON.parse(serialized) as CacheValue;
};
/** Convert a supported positive finite TTL into milliseconds.
 * @param {number|undefined} value - Optional lifetime seconds.
 * @returns {number|undefined} Millisecond TTL or absence; invalid TTL throws. */
const checkTtl = (value?: number): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Cache TTL must be positive and finite');
  }
  return value * 1000;
};

/** Create a bounded process-local LRU/TTL helper with explicit finite JSON/key/bulk policy. No timer, network or persistence starts.
 * @param {MemoryCacheOptions} options - Optional capacity, clock and direct-boundary policy.
 * @returns {CacheHelper & {stats(): MemoryCacheStats}} Owned helper; close invalidates method use and clears local entries. */
export const createMemoryCacheHelper = (
  options: MemoryCacheOptions = {}
): CacheHelper & {
  /** Prune expired local entries and read bounded helper counters.
   * @returns {MemoryCacheStats} Process-local entry/hit/miss/eviction totals, not distributed telemetry.
   */
  stats(): MemoryCacheStats;
} => {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new TypeError('Invalid memory cache options');
  }
  /** Effective direct-helper resource limits; the manager can impose smaller additional limits. */
  const policy = cachePolicy(options.policy);
  let closed = false;
  /** LRU entry ceiling, default 1000; counters and normal writes both obey it. */
  const maxEntries = options.maxEntries ?? 1000;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive integer');
  }
  /** Trusted injected millisecond clock or Date.now. */
  const now = options.now ?? Date.now;
  /** Owned insertion-ordered local entries; this memory has no persistence or replica synchronization. */
  const entries = new Map<string, Entry>();
  /** Fixed local counters; no per-key/tenant labels or payloads are collected. */
  const stats = { hits: 0, misses: 0, evictions: 0 };
  /** Read one unexpired entry and optionally promote its LRU position.
   * @param {string} key - Validated fully scoped storage key.
   * @param {boolean} promote - Promote on normal get, default true.
   * @returns {Entry|undefined} Owned internal entry or absence; lazy expiry deletes stale data. */
  const lookup = (key: string, promote = true): Entry | undefined => {
    /** Current local entry checked for lazy expiry before promotion or return. */
    const found = entries.get(key);
    if (!found) {
      return undefined;
    }
    if (found.expiresAt !== undefined && found.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    if (promote) {
      entries.delete(key);
      entries.set(key, found);
    }
    return found;
  };
  /** Evict oldest entries until the configured LRU ceiling holds.

 * @returns {void} Updates only local eviction counters and entries. */
  const evict = () => {
    // Evict oldest insertion-order entries until the LRU capacity holds.
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value!);
      stats.evictions++;
    }
  };
  /** Owned synchronous memory operations, guarded by the returned lifecycle/validation proxy. */
  const adapter: CacheHelper & {
    /** Prune expired local entries and read bounded helper counters.
     * @returns {MemoryCacheStats} Process-local entry/hit/miss/eviction totals, not distributed telemetry.
     */
    stats(): MemoryCacheStats;
  } = {
    capabilities: Object.freeze({
      conditionalWrites: 'supported',
      counters: 'supported',
      namespaceClear: 'supported',
      bulkAtomicity: 'unsupported',
      ownership: 'owned',
    }),
    /** Read one scoped cache value; absence stays distinct from JSON null.
     * @param {string} key - Logical unprefixed key validated before dispatch.
     * @returns {MaybePromise<CacheValue|undefined>} Detached bounded data or undefined; provider failures remain explicit.
     */
    get(key) {
      /** Current local entry checked for lazy expiry before promotion or return. */
      const found = lookup(key);
      if (!found) {
        stats.misses++;
        return undefined;
      }
      stats.hits++;
      return clone(found.value);
    },
    /** Write a bounded JSON value with explicit TTL/condition semantics. A void return never proves conditional acquisition.
     * @param {string} key - Logical cache key, never a secret.
     * @param {CacheValue} value - Inert bounded JSON data copied before storage.
     * @param {CacheSetOptions} opts - Optional provider write policy; conditions can silently miss.
     * @returns {MaybePromise<void>} Provider completion only; multi-key/distributed transaction guarantees are not invented.
     */
    set(key, value, opts: CacheSetOptions = {}) {
      if (opts.ifAbsent && opts.ifPresent) {
        throw new TypeError('Contradictory cache conditions');
      }
      /** Validated optional lifetime in milliseconds. */
      const ttlMs = checkTtl(opts.ttlSeconds);
      /** Unexpired presence checked before applying native local conditional intent. */
      const present = lookup(key, false) !== undefined;
      if ((opts.ifAbsent && present) || (opts.ifPresent && !present)) {
        return;
      }
      /** Detached JSON value stored independently of caller mutation. */
      const copy = clone(value);
      entries.delete(key);
      entries.set(key, {
        value: copy,
        expiresAt: ttlMs === undefined ? undefined : now() + ttlMs,
      });
      // Enforce the same capacity ceiling after normal writes.
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value!);
        stats.evictions++;
      }
    },
    /** Delete one exact scoped key.
     * @param {string} key - Logical key under the owning namespace.
     * @returns {MaybePromise<boolean>} Whether the provider reports an existing deletion.
     */
    delete(key) {
      return entries.delete(key);
    },
    /** Check exact scoped key presence with provider-owned expiry semantics.
     * @param {string} key - Logical key under the owning namespace.
     * @returns {MaybePromise<boolean>} Current provider presence; not authorization or a lock.
     */
    has(key) {
      return lookup(key, false) !== undefined;
    },
    /** Clear the owning scope; unprefixed helpers/managers can request global clear under provider policy.
     * @returns {MaybePromise<void>} Scoped provider completion; unsupported namespace clearing fails closed.
     */
    clear() {
      entries.clear();
    },
    /** Delete only entries beneath the exact namespace separator boundary.
     * @param {string} prefix - Validated host namespace; tenant binding must already be verified.
     * @returns {MaybePromise<void>} Namespace-only removal; no global clear fallback.
     */
    clearPrefix(prefix) {
      // Delete matching namespace entries without clearing another prefix.
      for (const key of entries.keys()) {
        if (key.startsWith(prefix + ':')) {
          entries.delete(key);
        }
      }
    },
    /** Read a bounded key batch and retain logical result keys, including prototype-shaped spellings as own data fields.
     * @param {string[]} keys - Bounded logical keys.
     * @returns {MaybePromise<Record<string, CacheValue|undefined>>} Detached bounded values; no multi-read snapshot guarantee.
     */
    getMany(keys) {
      /** Null-prototype bulk-result map with explicit own data properties. */
      const result: Record<string, CacheValue | undefined> =
        Object.create(null);
      // Keep logical lookup keys, including prototype-like names, as own result properties.
      for (const key of keys) {
        Object.defineProperty(result, key, {
          value: adapter.get(key),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    },
    /** Validate/copy a bounded write batch without claiming whole-batch atomicity.
     * @param {Record<string, CacheValue>} values - Explicit logical key/value record.
     * @param {CacheSetOptions|undefined} opts - Optional helper write policy.
     * @returns {MaybePromise<void>} Provider completion; partial backend writes can occur.
     */
    setMany(values, opts) {
      // Apply each bulk write using normal per-key validation and TTL semantics.
      for (const [key, value] of Object.entries(values)) {
        adapter.set(key, value, opts);
      }
    },
    /** Delete a bounded explicit key batch with provider-reported count.
     * @param {string[]} keys - Bounded logical key list.
     * @returns {MaybePromise<number>} Reported deletion count; not a transaction across keys.
     */
    deleteMany(keys) {
      let n = 0;
      // Count only keys that were actually deleted.
      for (const key of keys) {
        if (adapter.delete(key)) {
          n++;
        }
      }
      return n;
    },
    /** Apply a nonnegative integer increment using declared provider counter semantics.
     * @param {string} key - Logical counter key.
     * @param {number} amount - Nonnegative safe integer delta, default one.
     * @returns {MaybePromise<number>} Safe integer result; native mutation may precede a precision-result rejection.
     */
    increment(key, amount = 1) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new RangeError(
          'Counter amount must be a non-negative safe integer'
        );
      }
      /** Current counter/expiry entry; missing counters start from zero. */
      const old = lookup(key, false);
      /** Existing signed safe-integer counter or zero for absence. */
      const current = old ? old.value : 0;
      if (typeof current !== 'number' || !Number.isSafeInteger(current)) {
        throw new TypeError('Cache counter must be an integer');
      }
      /** Validated signed safe-integer counter after the requested delta. */
      const next = current + amount;
      if (!Number.isSafeInteger(next)) {
        throw new RangeError('Cache counter overflow');
      }
      entries.delete(key);
      entries.set(key, { value: next, expiresAt: old?.expiresAt });
      evict();
      return next;
    },
    /** Apply a nonnegative integer decrement without normalizing backend-specific zero behavior.
     * @param {string} key - Logical counter key.
     * @param {number} amount - Nonnegative safe integer delta, default one.
     * @returns {MaybePromise<number>} Safe integer result; memory/Redis signed and Memcached clamped behavior remain distinct.
     */
    decrement(key, amount = 1) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new RangeError(
          'Counter amount must be a non-negative safe integer'
        );
      }
      /** Current counter/expiry entry; missing counters start from zero. */
      const old = lookup(key, false);
      /** Existing signed safe-integer counter or zero for absence. */
      const current = old ? old.value : 0;
      if (typeof current !== 'number' || !Number.isSafeInteger(current)) {
        throw new TypeError('Cache counter must be an integer');
      }
      /** Validated signed safe-integer counter after the requested delta. */
      const next = current - amount;
      if (!Number.isSafeInteger(next)) {
        throw new RangeError('Cache counter overflow');
      }
      entries.delete(key);
      entries.set(key, { value: next, expiresAt: old?.expiresAt });
      evict();
      return next;
    },
    /** Refresh an existing key lifetime under explicit positive TTL validation.
     * @param {string} key - Logical key.
     * @param {number} ttlSeconds - Positive finite lifetime seconds.
     * @returns {MaybePromise<boolean>} Whether the provider reports an existing key was touched.
     */
    touch(key, ttlSeconds) {
      /** Validated touch duration in milliseconds. */
      const ms = checkTtl(ttlSeconds)!;
      /** Current counter/expiry entry; missing counters start from zero. */
      const old = lookup(key, false);
      if (!old) {
        return false;
      }
      old.expiresAt = now() + ms;
      return true;
    },
    /** Expose the privileged native helper handle to trusted host code only.
     * @returns {unknown} Escape hatch bypassing facade safety/namespace guarantees if used directly.
     */
    native() {
      return entries;
    },
    /** Stop new work and release only resources owned by this facade/helper. Manager close drains native work/producers; memory helper close clears its local map.
     * @returns {MaybePromise<void>} Cleanup completion, not forced cancellation of arbitrary host promises.
     */
    close() {
      entries.clear();
    },
    /** Prune expired local entries and read bounded helper counters.
     * @returns {MemoryCacheStats} Process-local entry/hit/miss/eviction totals, not distributed telemetry.
     */
    stats() {
      // Prune lazy expirations before reporting the local entry count.
      for (const key of entries.keys()) {
        lookup(key, false);
      }
      return { entries: entries.size, ...stats };
    },
  };
  return new Proxy(adapter, {
    /** Expose guarded bound adapter methods while retaining plain metadata properties.
     * @param {CacheHelper & {stats(): MemoryCacheStats}} target - Owned in-memory adapter target.
     * @param {PropertyKey} key - Requested method/metadata member.
     * @returns {unknown} Member value or validation/lifecycle wrapper; native escape hatches remain host-privileged.
     */
    get(target, key) {
      /** Requested adapter member; functions are invoked with their original target owner. */
      const method = Reflect.get(target, key);
      if (typeof method !== 'function') {
        return method;
      }
      return (...args: unknown[]) => {
        if (key === 'close') {
          if (!closed) {
            closed = true;
            return Reflect.apply(method, target, args);
          }
          return;
        }
        if (closed) {
          throw new Error('Memory cache closed');
        }
        if (
          [
            'get',
            'set',
            'delete',
            'has',
            'increment',
            'decrement',
            'touch',
            'clearPrefix',
          ].includes(String(key))
        ) {
          cacheKey(args[0], policy);
        }
        if (key === 'set') {
          cacheSetOptions(args[2] as CacheSetOptions | undefined);
          args[1] = cacheValue(args[1] as CacheValue, policy);
        }
        if (key === 'getMany' || key === 'deleteMany') {
          cacheBulk(args[0], policy);
          // Validate every bulk key before invoking the adapter operation.
          for (const item of args[0] as unknown[]) {
            cacheKey(item, policy);
          }
        }
        if (key === 'setMany') {
          /** Explicit bulk record validated/copied before any helper setMany mutation. */
          const values = args[0];
          if (!values || typeof values !== 'object' || Array.isArray(values)) {
            throw new TypeError('Invalid cache bulk values');
          }
          cacheBulk(Object.keys(values), policy);
          cacheSetOptions(args[1] as CacheSetOptions | undefined);
          args[0] = Object.fromEntries(
            Object.entries(values).map(([k, v]) => [
              cacheKey(k, policy),
              cacheValue(v, policy),
            ])
          );
        }
        return Reflect.apply(method, target, args);
      };
    },
  });
};
