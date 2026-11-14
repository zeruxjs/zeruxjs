import type { Catalog, CatalogLimits } from './types.js';
import {
  bounded,
  canonicalLocale,
  dataEntries,
  defineCatalog,
  validateDomain,
} from './validation.js';
import { serializeCatalogs } from './snapshot.js';

/** Trusted application loaders receive an owned cooperative cancellation signal. */
export type CatalogLoaders = Readonly<
  Record<
    string,
    (context: {
      /** Borrowed cooperative lifetime; cancellation does not force trusted callbacks to settle. */
      signal: AbortSignal;
    }) => Promise<unknown>
  >
>;
export interface CatalogLoadOptions {
  /** Borrowed cooperative lifetime; cancellation does not force trusted callbacks to settle. */
  signal?: AbortSignal;
}
interface Job {
  /** Owned shared-producer abort controller; each waiter remains independent. */
  controller: AbortController;
  /** Actual producer settlement retained until its native work finishes. */
  promise: Promise<Catalog>;
  /** Number of active waiters; only the last waiter aborts shared producer work. */
  users: number;
}

/** Create explicit allowlisted single-flight loading with bounded entries, serialized bytes and actual unsettled producer slots. Construction starts no I/O.
 * @param {CatalogLoaders} manifest - Trusted explicit locale/domain producer functions; not discovered modules or user-selected URLs.
 * @param {{
    maxEntries?: number;
    maxInFlight?: number;
    concurrency?: number;
    maxBytes?: number;
    timeoutMs?: number;
    limits?: CatalogLimits;
  }} options - Explicit owner capacity, preload concurrency, deadline and catalog validation policy.
 * @param {number} options.maxEntries - Bounded retained catalog count, default 32.
 * @param {number} options.maxInFlight - Actual unsettled producer cap, default 16.
 * @param {number} options.concurrency - Bounded preload workers, default four.
 * @param {number} options.maxBytes - Serialized UTF-8 retained cache budget, default 16 MiB.
 * @param {number} options.timeoutMs - Cooperative producer deadline, default 30 seconds.
 * @param {CatalogLimits} options.limits - Explicit per-catalog validation budgets.
 * @returns {object} Owned load/preload/invalidate/status/close facade; await close without closing borrowed transports.
 */
export function createCatalogLoader(
  manifest: CatalogLoaders,
  options: {
    maxEntries?: number;
    maxInFlight?: number;
    concurrency?: number;
    /** Explicit bounded UTF-8 source/retained/wire budget for this owner. */
    maxBytes?: number;
    timeoutMs?: number;
    /** Explicit per-catalog message/string/UTF-8 copy limits. */
    limits?: CatalogLimits;
  } = {}
) {
  /** Bounded retained catalog-entry capacity. */
  const max = bounded(options.maxEntries, 32, 1024);
  /** Bounded actual producer count; cancellation does not release unsettled work. */
  const maxInFlight = bounded(options.maxInFlight, 16, 128);
  /** Maximum preload workers; no hidden unbounded producer queue is created. */
  const concurrency = bounded(options.concurrency, 4, 32);
  /** Bounded serialized UTF-8 retained catalog budget. */
  const maxBytes = bounded(
    options.maxBytes,
    16 * 1024 * 1024,
    64 * 1024 * 1024
  );
  /** Finite producer deadline; abort remains cooperative. */
  const timeoutMs = bounded(options.timeoutMs, 30_000, 300_000);
  /** Explicit trusted function manifest copied without evaluating its modules. */
  const loaders = new Map(dataEntries(manifest));
  /** Per-owner validated catalogs with exact serialized byte accounting. */
  const cache = new Map<string, { catalog: Catalog; bytes: number }>();
  /** Shared producers retained through actual settlement, including aborted noncooperative work. */
  const pending = new Map<string, Job>();
  let bytes = 0,
    closed = false;
  if (
    loaders.size > 1024 ||
    [...loaders.values()].some((value) => typeof value !== 'function')
  ) {
    throw new TypeError('zlocale: invalid loader manifest');
  }
  for (const key of loaders.keys()) {
    /** Declared key components validated before any producer invocation. */
    const [language, domain, ...extra] = key.split('/');
    if (
      !language ||
      !domain ||
      extra.length ||
      new Intl.Locale(canonicalLocale(language)).baseName !== language ||
      validateDomain(domain) !== domain
    ) {
      throw new TypeError(
        'zlocale: loader keys must be canonical locale/domain'
      );
    }
  }
  /** Evict one retained catalog and adjust this owner's byte accounting.
   * @param {string} key - Explicit declared catalog key.
   * @returns {void} Removes only local cached data.
   */
  const drop = (key: string) => {
    /** Cached entry whose retained bytes must be subtracted before removal. */
    const old = cache.get(key);
    if (old) {
      bytes -= old.bytes;
      cache.delete(key);
    }
  };
  /** Create a fixed cancellation failure without exposing private abort reasons.
   * @returns {Error} Generic public cancellation failure.
   */
  const cancelled = () => new Error('zlocale: catalog load cancelled');
  /** Reject undeclared keys before invoking or sharing producer work.
   * @param {string} key - Requested exact manifest identity.
   * @returns {void} Returns only for explicitly declared keys.
   */
  const checkKey = (key: string) => {
    if (!loaders.has(key)) {
      throw new Error('zlocale: undeclared catalog key');
    }
  };
  /** Load a declared key. Caller cancellation detaches only that waiter; the last waiter aborts shared work.
   * @param {string} key - Exact declared canonical locale/domain identity.
   * @param {CatalogLoadOptions} settings - Explicit independent caller cancellation.
   * @returns {Promise<Catalog>} Validated immutable public catalog after actual producer success.
   */
  const load = async (
    key: string,
    settings: CatalogLoadOptions = {}
  ): Promise<Catalog> => {
    checkKey(key);
    if (closed) {
      throw new Error('zlocale: catalog loader closed');
    }
    /** Borrowed caller signal; one waiter cannot cancel other active waiters. */
    const signal = settings.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError('zlocale: invalid cancellation signal');
    }
    if (signal?.aborted) {
      throw cancelled();
    }
    /** Validated cached hit; touching it updates only this owner's recency. */
    const ready = cache.get(key);
    if (ready) {
      cache.delete(key);
      cache.set(key, ready);
      return ready.catalog;
    }
    let job = pending.get(key);
    if (!job) {
      if (pending.size >= maxInFlight) {
        throw new RangeError('zlocale: loader in-flight limit exceeded');
      }
      /** Owned shared-producer lifetime; last waiter, timeout or invalidation can abort it. */
      const controller = new AbortController();
      /** Owned finite producer deadline cleared only after actual settlement. */
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      job = { controller, users: 0, promise: undefined! };
      /** Exact shared job identity retained for waiter bookkeeping and stale-work fencing. */
      const current = job;
      current.promise = Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) {
            throw cancelled();
          }
          return (loaders.get(key) as CatalogLoaders[string])!({
            signal: controller.signal,
          });
        })
        .then((input) => {
          if (controller.signal.aborted || closed) {
            throw cancelled();
          }
          /** Defensively validated producer data with exact expected locale/domain. */
          const catalog = defineCatalog(input, options.limits);
          if (`${catalog.locale}/${catalog.domain}` !== key) {
            throw new Error('zlocale: loader returned wrong locale/domain');
          }
          /** Serialized UTF-8 catalog bytes checked before bounded LRU insertion. */
          const size = new TextEncoder().encode(
            serializeCatalogs([catalog], {
              maxBytes: 64 * 1024 * 1024,
              ...(options.limits ? { limits: options.limits } : {}),
            })
          ).length;
          if (size > maxBytes) {
            throw new RangeError('zlocale: loader cache byte limit exceeded');
          }
          while (cache.size >= max || bytes + size > maxBytes) {
            drop(cache.keys().next().value!);
          }
          cache.set(key, { catalog, bytes: size });
          bytes += size;
          return catalog;
        })
        .finally(() => {
          clearTimeout(timer);
          pending.delete(key);
        });
      // Timed-out noncooperative work retains its pending slot until actual settlement.
      void current.promise.catch(() => {});
      pending.set(key, current);
    }
    /** Exact shared job identity retained for waiter bookkeeping and stale-work fencing. */
    const current = job;
    current.users++;
    return new Promise<Catalog>((resolve, reject) => {
      let done = false;
      /** Settle one waiter and detach its signal listeners exactly once.
       * @param {unknown} error - Private producer failure for rejection.
       * @param {Catalog} catalog - Optional validated success result.
       * @param {boolean} failed - Explicit failure marker preserving falsy rejections.
       * @returns {void} Releases this waiter; last waiter aborts only its current producer.
       */
      const finish = (error: unknown, catalog?: Catalog, failed = false) => {
        if (done) {
          return;
        }
        done = true;
        signal?.removeEventListener('abort', abort);
        current.controller.signal.removeEventListener('abort', abort);
        if (--current.users === 0 && pending.get(key) === current) {
          current.controller.abort();
        }
        if (failed) {
          reject(error);
        } else {
          resolve(catalog!);
        }
      };
      /** Detach this waiter with a fixed cancellation result.
       * @returns {void} Does not force producer settlement or release its pending slot.
       */
      const abort = () => finish(cancelled(), undefined, true);
      signal?.addEventListener('abort', abort, { once: true });
      current.controller.signal.addEventListener('abort', abort, {
        once: true,
      });
      current.promise.then(
        (value) => finish(undefined, value),
        (error) => finish(error, undefined, true)
      );
      if (signal?.aborted || current.controller.signal.aborted) {
        abort();
      }
    });
  };
  /** Invalidate after a source revision. In-flight stale results can never repopulate the cache.
   * @param {string} key - Optional exact declared key; omission invalidates all local entries/producers.
   * @returns {void} Evicts/aborts but retains pending slots until producer settlement.
   */
  const invalidate = (key?: string) => {
    if (key !== undefined) {
      checkKey(key);
      drop(key);
      pending.get(key)?.controller.abort();
    } else {
      cache.clear();
      bytes = 0;
      for (const job of pending.values()) {
        job.controller.abort();
      }
    }
  };
  return Object.freeze({
    load,
    async preload(
      keys: readonly string[],
      settings: CatalogLoadOptions = {}
    ): Promise<Catalog[]> {
      if (!Array.isArray(keys) || keys.length > 1024) {
        throw new RangeError('zlocale: invalid preload list');
      }
      keys.forEach(checkKey);
      /** Ordered output slots filled by bounded preload workers. */
      const results: Catalog[] = new Array(keys.length);
      let next = 0;
      /** Actual worker settlements; all are awaited before reporting a failure. */
      const settled = await Promise.allSettled(
        Array.from(
          { length: Math.min(concurrency, maxInFlight, keys.length) },
          async () => {
            while (next < keys.length) {
              /** Unique synchronous work index claimed before awaiting this load. */
              const index = next++;
              results[index] = await load(keys[index]!, settings);
            }
          }
        )
      );
      /** First settled worker rejection, distinguished from a falsy rejection reason. */
      const failure = settled.find((item) => item.status === 'rejected');
      if (failure?.status === 'rejected') {
        throw failure.reason;
      }
      if (closed) {
        throw new Error('zlocale: catalog loader closed');
      }
      return results;
    },
    invalidate,
    clear: () => invalidate(),
    /** Abort and drain actual loader work; borrowed transports stay owned by the application.
     * @returns {Promise<void>} Actual producer drain; noncooperative loaders can delay settlement indefinitely.
     */
    async close(): Promise<void> {
      closed = true;
      invalidate();
      await Promise.allSettled([...pending.values()].map((job) => job.promise));
    },
    getStatus: () =>
      Object.freeze({
        cached: cache.size,
        bytes,
        pending: pending.size,
        closed,
      }),
  });
}
