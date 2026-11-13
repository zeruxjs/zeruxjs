import {
  cachePolicy,
  cacheCapabilities,
  cacheSetOptions,
  cacheValue,
  cacheKey,
  cacheBulk,
} from './policy.js';
import type {
  CacheRememberOptions,
  CacheProducerContext,
  CacheCapabilities,
} from './types.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createMemoryCacheHelper } from './memory.js';
import type { MemoryCacheOptions } from './memory.js';

import type {
  CacheHelper,
  CacheManager,
  CacheManagerConfig,
  CacheSetOptions,
  CacheValue,
  MaybePromise,
} from './types.js';
import {
  createCacheError,
  extractCacheHelperFactory,
  normalizeCacheConfig,
} from './utils.js';

/** Load only an explicitly configured trusted helper module using application-first resolution. Configuration is executable host input, never request data.
 * @param {string} packageName - Explicit trusted adapter module specifier.
 * @returns {Promise<Record<string, unknown>>} Imported namespace; application import failure retains the compatible package-local fallback. */
const importHelperPackage = async (
  packageName: string
): Promise<Record<string, unknown>> => {
  try {
    /** Scoped application resolver anchored to the current host package.json. */
    const appRequire = createRequire(path.join(process.cwd(), 'package.json'));
    return (await import(appRequire.resolve(packageName))) as Record<
      string,
      unknown
    >;
  } catch {
    return (await import(packageName)) as Record<string, unknown>;
  }
};

/** Scoped cache owner: validated namespaced data, finite producer jobs and actual-settlement cleanup. */
class CacheManagerImpl implements CacheManager {
  /** Explicit configured helper label. */
  public readonly helper: string;
  /** Verified host namespace with compatible prefix:key spelling. */
  public readonly prefix?: string;
  /** Optional positive default write lifetime. */
  public readonly defaultTtlSeconds?: number;
  /** Frozen declared capabilities; strict requirements were negotiated at construction. */
  public readonly capabilities: Readonly<CacheCapabilities>;
  /** Validated finite budgets and helper wrapper ownership. */
  readonly #policy;
  readonly #shutdown = new AbortController();
  #closed = false;
  /** One idempotent cleanup promise shared by all close callers. */
  #closing?: Promise<void>;
  readonly #work = new Set<Promise<unknown>>();
  /** Bound helper proxy tracking native promise ownership. */
  readonly #adapter: CacheHelper;
  readonly #pending = new Map<string, Promise<CacheValue>>();

  /** Validate required helper methods and negotiate declared capabilities before binding native-call ownership.
   * @param {Required<Pick<CacheManagerConfig, 'helper'>> & CacheManagerConfig} config - Normalized trusted scope/options/policy.
   * @param {CacheHelper} adapter - Explicit acquired or borrowed helper wrapper.
   */
  constructor(
    config: Required<Pick<CacheManagerConfig, 'helper'>> & CacheManagerConfig,
    adapter: CacheHelper
  ) {
    if (
      !adapter ||
      typeof adapter !== 'object' ||
      [
        'get',
        'set',
        'delete',
        'has',
        'clear',
        'getMany',
        'setMany',
        'deleteMany',
        'increment',
        'decrement',
        'touch',
      ].some(
        (name) =>
          typeof (adapter as unknown as Record<string, unknown>)[name] !==
          'function'
      )
    ) {
      throw createCacheError({
        code: 'INVALID_CACHE_HELPER',
        message: 'Cache helper does not implement the required contract',
      });
    }
    this.helper = config.helper;
    this.prefix = config.prefix;
    this.defaultTtlSeconds = config.defaultTtlSeconds;
    this.#policy = cachePolicy(config.policy);
    this.capabilities = cacheCapabilities(adapter.capabilities);
    // Require explicit support for every configured guarantee before accepting helper work.
    for (const name of this.#policy.requireCapabilities) {
      if (this.capabilities[name] !== 'supported') {
        throw createCacheError({
          code: 'CACHE_CAPABILITY_REQUIRED',
          message: 'Required cache capability unavailable',
        });
      }
    }
    this.#adapter = new Proxy(adapter, {
      get: (target, key) => {
        /** Actual helper member/result or produced value checked at its owning boundary. */
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') {
          return value;
        }
        return (...args: unknown[]) => {
          /** Actual provider result retained through settlement and domain validation. */
          const result = Reflect.apply(value, target, args);
          if (
            result &&
            typeof (result as Promise<unknown>).then === 'function'
          ) {
            /** Native provider promise retained until actual settlement so close cannot release it early. */
            const pending = Promise.resolve(result);
            this.#work.add(pending);
            void pending
              .finally(() => this.#work.delete(pending))
              .catch(() => {});
            return pending;
          }
          return result;
        };
      },
    });
  }

  /** Read one scoped cache value; absence stays distinct from JSON null.
   * @param {string} key - Logical unprefixed key validated before dispatch.
   * @returns {MaybePromise<CacheValue|undefined>} Detached bounded data or undefined; provider failures remain explicit.
   */
  get(key: string): MaybePromise<CacheValue | undefined> {
    /** Actual provider result retained through settlement and domain validation. */
    const result = this.#adapter.get(this.#key(key));
    /** Validate and detach returned provider JSON without inventing a value for absence.
     * @param {CacheValue|undefined} value - Actual provider result.
     * @returns {CacheValue|undefined} Bounded defensive copy or undefined. */
    const copy = (value: CacheValue | undefined) =>
      value === undefined ? undefined : cacheValue(value, this.#policy);
    return result && typeof (result as Promise<unknown>).then === 'function'
      ? Promise.resolve(result).then(copy)
      : copy(result as CacheValue | undefined);
  }

  /** Write a bounded JSON value with explicit TTL/condition semantics. A void return never proves conditional acquisition.
   * @param {string} key - Logical cache key, never a secret.
   * @param {CacheValue} value - Inert bounded JSON data copied before storage.
   * @param {CacheSetOptions} options - Optional TTL and exclusive ifAbsent/ifPresent flags.
   * @returns {MaybePromise<void>} Provider completion only; multi-key/distributed transaction guarantees are not invented.
   */
  set(
    key: string,
    value: CacheValue,
    options: CacheSetOptions = {}
  ): MaybePromise<void> {
    this.#setOptions(options);

    return this.#adapter.set(this.#key(key), cacheValue(value, this.#policy), {
      ...options,
      ttlSeconds: options.ttlSeconds ?? this.defaultTtlSeconds,
    });
  }

  /** Delete one exact scoped key.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing deletion.
   */
  delete(key: string): MaybePromise<boolean> {
    return this.#adapter.delete(this.#key(key));
  }

  /** Check exact scoped key presence with provider-owned expiry semantics.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Current provider presence; not authorization or a lock.
   */
  has(key: string): MaybePromise<boolean> {
    return this.#adapter.has(this.#key(key));
  }

  /** Clear the owning scope; unprefixed helpers/managers can request global clear under provider policy.
   * @returns {MaybePromise<void>} Scoped provider completion; unsupported namespace clearing fails closed.
   */
  clear(): MaybePromise<void> {
    this.#open();
    this.#supported('namespaceClear', Boolean(this.prefix));
    if (!this.prefix) {
      return this.#adapter.clear();
    }
    if (!this.#adapter.clearPrefix) {
      throw createCacheError({
        code: 'NAMESPACE_CLEAR_UNSUPPORTED',
        message: 'Helper cannot safely clear a namespace',
      });
    }
    return this.#adapter.clearPrefix(this.prefix);
  }

  /** Read a bounded key batch and retain logical result keys, including prototype-shaped spellings as own data fields.
   * @param {string[]} keys - Bounded logical keys.
   * @returns {MaybePromise<Record<string, CacheValue|undefined>>} Detached bounded values; no multi-read snapshot guarantee.
   */
  getMany(
    keys: string[]
  ): MaybePromise<Record<string, CacheValue | undefined>> {
    this.#open();
    cacheBulk(keys, this.#policy);
    /** Validated fully prefixed keys, kept separate from logical result names. */
    const namespaced = keys.map((key) => this.#key(key));
    /** Restore logical bulk-result names and bound every returned value.
     * @param {Record<string, CacheValue|undefined>} result - Actual trusted provider bulk response.
     * @returns {Record<string, CacheValue|undefined>} Detached null-prototype logical result. */
    const restore = (result: Record<string, CacheValue | undefined>) => {
      /** Logical result map populated with explicit own data properties. */
      const mapped: Record<string, CacheValue | undefined> =
        Object.create(null);
      keys.forEach((key, index) => {
        /** Corresponding prefixed key; the parallel arrays are created from the same validated input. */
        const namespacedKey = namespaced[index];
        if (namespacedKey === undefined) {
          throw new TypeError('Cache namespace mapping is incomplete');
        }
        Object.defineProperty(mapped, key, {
          value:
            result[namespacedKey] === undefined
              ? undefined
              : cacheValue(result[namespacedKey]!, this.#policy),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      });
      return mapped;
    };
    /** Actual provider result retained through settlement and domain validation. */
    const result = this.#adapter.getMany(namespaced);
    return result && typeof (result as Promise<unknown>).then === 'function'
      ? Promise.resolve(result).then(restore)
      : restore(result as Record<string, CacheValue | undefined>);
  }

  /** Validate/copy a bounded write batch without claiming whole-batch atomicity.
   * @param {Record<string, CacheValue>} values - Explicit logical key/value record.
   * @param {CacheSetOptions} options - Optional shared TTL/conditions.
   * @returns {MaybePromise<void>} Provider completion; partial backend writes can occur.
   */
  setMany(
    values: Record<string, CacheValue>,
    options: CacheSetOptions = {}
  ): MaybePromise<void> {
    this.#setOptions(options);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError('Invalid cache bulk values');
    }
    cacheBulk(Object.keys(values), this.#policy);
    /** All validated prefixed values staged before dispatching setMany. */
    const copied = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        this.#key(key),
        cacheValue(value, this.#policy),
      ])
    );
    return this.#adapter.setMany(copied, {
      ...options,
      ttlSeconds: options.ttlSeconds ?? this.defaultTtlSeconds,
    });
  }

  /** Delete a bounded explicit key batch with provider-reported count.
   * @param {string[]} keys - Bounded logical key list.
   * @returns {MaybePromise<number>} Reported deletion count; not a transaction across keys.
   */
  deleteMany(keys: string[]): MaybePromise<number> {
    this.#open();
    cacheBulk(keys, this.#policy);
    return this.#adapter.deleteMany(keys.map((key) => this.#key(key)));
  }

  /** Apply a nonnegative integer increment using declared provider counter semantics.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; native mutation may precede a precision-result rejection.
   */
  increment(key: string, amount = 1): MaybePromise<number> {
    this.#open();
    this.#supported('counters');
    this.#assertAmount(amount);
    return this.#counter(this.#adapter.increment(this.#key(key), amount));
  }

  /** Apply a nonnegative integer decrement without normalizing backend-specific zero behavior.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; memory/Redis signed and Memcached clamped behavior remain distinct.
   */
  decrement(key: string, amount = 1): MaybePromise<number> {
    this.#open();
    this.#supported('counters');
    this.#assertAmount(amount);
    return this.#counter(this.#adapter.decrement(this.#key(key), amount));
  }

  /** Refresh an existing key lifetime under explicit positive TTL validation.
   * @param {string} key - Logical key.
   * @param {number} ttlSeconds - Positive finite lifetime seconds.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing key was touched.
   */
  touch(key: string, ttlSeconds: number): MaybePromise<boolean> {
    this.#assertTtl(ttlSeconds);
    return this.#adapter.touch(this.#key(key), ttlSeconds);
  }

  /** Stop new work and release only resources owned by this facade/helper. Manager close drains native work/producers; memory helper close clears its local map.
   * @returns {MaybePromise<void>} Cleanup completion, not forced cancellation of arbitrary host promises.
   */
  close(): Promise<void> {
    this.#closed = true;
    return (this.#closing ??= Promise.resolve().then(async () => {
      this.#shutdown.abort();
      await Promise.allSettled([...this.#pending.values(), ...this.#work]);
      if (this.#policy.ownHelper) {
        await this.#adapter.close?.();
      }
    }));
  }

  /** Coalesce one process-local miss job per manager/key with finite actual-settlement ownership. Waiter cancellation only detaches that subscriber.
   * @param {string} key - Logical key whose first admitted producer policy governs shared work.
   * @param {(context: CacheProducerContext) => MaybePromise<CacheValue>} producer - Trusted cooperative callback receiving signal/deadline.
   * @param {CacheRememberOptions} options - Optional first-job TTL/conditions and waiter cancellation/deadline settings.
   * @returns {Promise<CacheValue>} Produced/read value; failed/cancelled late work never writes the cache automatically.
   */
  async remember(
    key: string,
    producer: (context: CacheProducerContext) => MaybePromise<CacheValue>,
    options: CacheRememberOptions = {}
  ): Promise<CacheValue> {
    /** Fully validated application/tenant-prefixed key for process-local miss coalescing. */
    const scoped = this.#key(key);
    this.#setOptions(options);
    if (
      typeof producer !== 'function' ||
      (options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)) ||
      (options.deadline !== undefined &&
        (!Number.isSafeInteger(options.deadline) ||
          options.deadline < 0 ||
          options.deadline > Date.now() + 600000)) ||
      (options.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs < 1 ||
          options.timeoutMs > 600000))
    ) {
      throw new TypeError('Invalid cache producer options');
    }
    /** Earlier declared producer/waiter deadline; no deadline remains Infinity. */
    const deadline = Math.min(
      options.deadline ?? Infinity,
      options.timeoutMs === undefined
        ? Infinity
        : Date.now() + options.timeoutMs
    );
    if (options.signal?.aborted || deadline <= Date.now()) {
      throw createCacheError({
        code: 'CACHE_PRODUCER_CANCELLED',
        message: 'Cache producer cancelled',
      });
    }
    let job = this.#pending.get(scoped);
    if (!job) {
      if (this.#pending.size >= this.#policy.maxPendingProducers) {
        throw createCacheError({
          code: 'CACHE_PRODUCER_LIMIT',
          message: 'Cache producer capacity exceeded',
        });
      }
      /** Owned first-job cooperative cancellation source shared by subscribers. */
      const controller = new AbortController();
      /** Propagate manager shutdown into cooperative production.

 * @returns {void} Does not force native/JavaScript settlement. */
      const abort = () => controller.abort();
      this.#shutdown.signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (Number.isFinite(deadline)) {
        timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
      }
      job = Promise.resolve().then(async () => {
        /** Actual current cache lookup; JSON null is present and must not trigger production. */
        const existing = await this.get(key);
        if (existing !== undefined) {
          return existing;
        }
        if (controller.signal.aborted || deadline <= Date.now()) {
          throw createCacheError({
            code: 'CACHE_PRODUCER_CANCELLED',
            message: 'Cache producer cancelled',
          });
        }
        /** Actual helper member/result or produced value checked at its owning boundary. */
        const value = await producer({
          signal: controller.signal,
          deadline: Number.isFinite(deadline) ? deadline : undefined,
        });
        if (controller.signal.aborted || deadline <= Date.now()) {
          throw createCacheError({
            code: 'CACHE_PRODUCER_CANCELLED',
            message: 'Cache producer cancelled',
          });
        }
        await this.set(key, value, {
          ttlSeconds: options.ttlSeconds,
          ifAbsent: options.ifAbsent,
          ifPresent: options.ifPresent,
        });
        return value;
      });
      this.#pending.set(scoped, job);
      /** Exact pending job identity used to fence cleanup against later replacements. */
      const captured = job;
      void job
        .finally(() => {
          if (timer) {
            clearTimeout(timer);
          }
          this.#shutdown.signal.removeEventListener('abort', abort);
          if (this.#pending.get(scoped) === captured) {
            this.#pending.delete(scoped);
          }
        })
        .catch(() => {});
    }
    /** Combined manager/caller signal; cancelling one caller does not abort another subscriber. */
    const waitingSignal = AbortSignal.any([
      this.#shutdown.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    try {
      return await Promise.race([
        job,
        new Promise<never>((_, reject) => {
          abort = () =>
            reject(
              createCacheError({
                code: 'CACHE_PRODUCER_CANCELLED',
                message: 'Cache producer cancelled',
              })
            );
          waitingSignal.addEventListener('abort', abort, { once: true });
          if (Number.isFinite(deadline)) {
            timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
          }
          if (waitingSignal.aborted) {
            abort();
          }
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      waitingSignal.removeEventListener('abort', abort);
    }
  }

  /** Expose the privileged native helper handle to trusted host code only.
   * @returns {unknown} Escape hatch bypassing facade safety/namespace guarantees if used directly.
   */
  native(): unknown {
    this.#open();
    return this.#adapter.native?.() ?? this.#adapter;
  }

  /** Preserve sync/async provider behavior while validating safe counter results.
   * @param {MaybePromise<number>} result - Actual native counter completion.
   * @returns {MaybePromise<number>} Safe integer or postmutation validation failure; no rollback claim.
   */
  #counter(result: MaybePromise<number>): MaybePromise<number> {
    /** Reject precision-losing native counter results after the provider settles.
     * @param {number} value - Provider-returned counter.
     * @returns {number} Safe integer; rejection does not roll back native mutation. */
    const check = (value: number) => {
      if (!Number.isSafeInteger(value)) {
        throw createCacheError({
          code: 'INVALID_COUNTER_RESULT',
          message: 'Cache counter result must be a safe integer',
        });
      }
      return value;
    };
    return result && typeof (result as Promise<number>).then === 'function'
      ? Promise.resolve(result).then(check)
      : check(result as number);
  }
  /** Fence use after shutdown starts.
   * @returns {void} Closed manager calls reject immediately.
   */
  #open() {
    if (this.#closed) {
      throw createCacheError({
        code: 'CACHE_CLOSED',
        message: 'Cache manager closed',
      });
    }
  }
  /** Reject explicitly unsupported requested operations while preserving compatible unknown metadata.
   * @param {keyof CacheCapabilities} name - Known capability to inspect.
   * @param {boolean} requested - Whether the operation is requested, default true.
   * @returns {void} Strict required capabilities were checked separately at construction.
   */
  #supported(name: keyof CacheCapabilities, requested = true) {
    if (requested && this.capabilities[name] === 'unsupported') {
      throw createCacheError({
        code: 'CACHE_OPERATION_UNSUPPORTED',
        message: 'Cache operation unsupported',
      });
    }
  }
  /** Validate write intent and declared conditional support before dispatch.
   * @param {CacheSetOptions} options - TTL and exclusive conditional flags.
   * @returns {void} Closed/invalid/unsupported requests reject before the write.
   */
  #setOptions(options: CacheSetOptions) {
    this.#open();
    cacheSetOptions(options);
    this.#supported(
      'conditionalWrites',
      Boolean(options.ifAbsent || options.ifPresent)
    );
  }
  /** Validate logical and fully prefixed key bytes without treating prefixing as authentication.
   * @param {string} key - Untrusted logical key.
   * @returns {string} Stable compatible prefix:key spelling; host owns unambiguous verified namespaces.
   */
  #key(key: string): string {
    this.#open();
    cacheKey(key, this.#policy);
    if (typeof key !== 'string' || key.length === 0) {
      throw createCacheError({
        code: 'INVALID_KEY',
        message: 'Cache key must be a non-empty string',
      });
    }

    return cacheKey(this.prefix ? `${this.prefix}:${key}` : key, this.#policy);
  }

  /** Require positive finite requested TTL seconds.
   * @param {number | undefined} ttlSeconds - Optional lifetime seconds.
   * @returns {void} Absent TTL passes; invalid TTL rejects.
   */
  #assertTtl(ttlSeconds: number | undefined): void {
    if (
      ttlSeconds !== undefined &&
      (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)
    ) {
      throw createCacheError({
        code: 'INVALID_TTL',
        message: 'ttlSeconds must be a positive finite number',
      });
    }
  }

  /** Require a nonnegative safe integer counter delta.
   * @param {number} amount - Requested counter increment/decrement magnitude.
   * @returns {void} Invalid deltas reject before provider dispatch.
   */
  #assertAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw createCacheError({
        code: 'INVALID_AMOUNT',
        message:
          'Cache increment and decrement amounts must be non-negative safe integers',
      });
    }
  }
}

/** Process-global compatibility reference only; replacement does not transfer earlier lifecycle ownership. */
let activeManager: CacheManager | null = null;

/** Create a scoped manager from an explicit trusted helper selection, negotiating capabilities before publication.
 * @param {CacheManagerConfig} config - Host-owned adapter/options/namespace/policy.
 * @returns {Promise<CacheManager>} Owned manager; failed external-helper negotiation closes the acquired wrapper. */
export const createCacheManager = async (
  config: CacheManagerConfig
): Promise<CacheManager> => {
  /** Validated compatible settings and finite resource/ownership policy. */
  const normalized = normalizeCacheConfig(config);
  if (
    normalized.helper === 'memory' ||
    normalized.helper === '@zeruxjs/cache/memory'
  ) {
    return new CacheManagerImpl(
      normalized,
      createMemoryCacheHelper({
        ...(normalized.options as MemoryCacheOptions),
        policy: normalized.policy,
      })
    );
  }
  /** Explicit configured helper namespace, not a scanned/discovered package. */
  const imported = await importHelperPackage(normalized.helper);
  /** Supported declared helper factory selected from the trusted namespace. */
  const factory = extractCacheHelperFactory(imported);
  /** Acquired helper wrapper; negotiation failure releases it before propagating the error. */
  const adapter = await factory(normalized.options ?? {});

  try {
    return new CacheManagerImpl(normalized, adapter);
  } catch (error) {
    try {
      await adapter.close?.();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Cache initialization cleanup failed'
      );
    }
    throw error;
  }
};

/** Replace the process-global compatibility manager without closing the previous owner.
 * @param {CacheManager} manager - Explicit host-owned manager; generations must retain/close their own instances.
 * @returns {void} Updates only the compatibility reference. */
export const setActiveCacheManager = (manager: CacheManager): void => {
  activeManager = manager;
};

/** Read the explicitly configured process-global compatibility manager.

 * @returns {CacheManager} Current facade or an initialization error; no implicit memory fallback. */
export const getActiveCacheManager = (): CacheManager => {
  if (!activeManager) {
    throw createCacheError({
      code: 'CACHE_MANAGER_NOT_INITIALIZED',
      message: 'Cache manager has not been initialized yet',
    });
  }

  return activeManager;
};

/** Create and publish a compatibility manager; prior generations remain host-owned.
 * @param {CacheManagerConfig} config - Trusted explicit helper/options/policy.
 * @returns {Promise<CacheManager>} New manager; replacing active state never automatically closes an earlier owner. */
export const configureCacheManager = async (
  config: CacheManagerConfig
): Promise<CacheManager> => {
  /** New manager published only after successful acquisition and capability validation. */
  const manager = await createCacheManager(config);
  setActiveCacheManager(manager);
  return manager;
};

/** Wrap an existing explicit helper with validated scope/policy. Default ownHelper=true preserves legacy wrapper ownership.
 * @param {CacheHelper} helper - Injected host-approved adapter.
 * @param {Omit<CacheManagerConfig, 'helper'> & {helper?: string}} config - Optional namespace/defaults/policy; ownHelper=false keeps shared helper teardown with the host.
 * @returns {CacheManager} Scoped owner or construction failure; injected-helper ownership on failure remains with the caller. */
export const createCacheManagerWithHelper = (
  helper: CacheHelper,
  config: Omit<CacheManagerConfig, 'helper'> & { helper?: string } = {}
): CacheManager => {
  /** Validated compatible settings and finite resource/ownership policy. */
  const normalized = normalizeCacheConfig({
    ...config,
    helper: config.helper ?? 'custom',
  });
  return new CacheManagerImpl(normalized, helper);
};
