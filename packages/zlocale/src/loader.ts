import type { Catalog, CatalogLimits } from "./types.js";
import { bounded, canonicalLocale, dataEntries, defineCatalog, validateDomain } from "./validation.js";
import { serializeCatalogs } from "./snapshot.js";

/** Trusted application loaders receive an owned cooperative cancellation signal. */
export type CatalogLoaders = Readonly<Record<string, (context: { signal: AbortSignal }) => Promise<unknown>>>;
export interface CatalogLoadOptions { signal?: AbortSignal }
interface Job { controller: AbortController; promise: Promise<Catalog>; users: number }

/** Explicit allowlisted single-flight loading. Entries and serialized UTF-8 bytes are bounded.
 * No I/O occurs until load/preload. Cancellation does not force trusted callbacks to settle.
 */
export function createCatalogLoader(manifest: CatalogLoaders, options: {
  maxEntries?: number; maxInFlight?: number; concurrency?: number; maxBytes?: number;
  timeoutMs?: number; limits?: CatalogLimits;
} = {}) {
  const max = bounded(options.maxEntries, 32, 1024),
    maxInFlight = bounded(options.maxInFlight, 16, 128),
    concurrency = bounded(options.concurrency, 4, 32),
    maxBytes = bounded(options.maxBytes, 16 * 1024 * 1024, 64 * 1024 * 1024),
    timeoutMs = bounded(options.timeoutMs, 30_000, 300_000);
  const loaders = new Map(dataEntries(manifest));
  const cache = new Map<string, { catalog: Catalog; bytes: number }>();
  const pending = new Map<string, Job>();
  let bytes = 0, closed = false;
  if (loaders.size > 1024 || [...loaders.values()].some(value => typeof value !== "function"))
    throw new TypeError("zlocale: invalid loader manifest");
  for (const key of loaders.keys()) {
    const [language, domain, ...extra] = key.split("/");
    if (!language || !domain || extra.length ||
      new Intl.Locale(canonicalLocale(language)).baseName !== language || validateDomain(domain) !== domain)
      throw new TypeError("zlocale: loader keys must be canonical locale/domain");
  }
  const drop = (key: string) => {
    const old = cache.get(key);
    if (old) { bytes -= old.bytes; cache.delete(key); }
  };
  const cancelled = () => new Error("zlocale: catalog load cancelled");
  const checkKey = (key: string) => {
    if (!loaders.has(key)) throw new Error("zlocale: undeclared catalog key");
  };
  /** Load a declared key. Caller cancellation detaches only that waiter; the last waiter aborts shared work. */
  const load = async (key: string, settings: CatalogLoadOptions = {}): Promise<Catalog> => {
    checkKey(key);
    if (closed) throw new Error("zlocale: catalog loader closed");
    const signal = settings.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError("zlocale: invalid cancellation signal");
    if (signal?.aborted) throw cancelled();
    const ready = cache.get(key);
    if (ready) { cache.delete(key); cache.set(key, ready); return ready.catalog; }
    let job = pending.get(key);
    if (!job) {
      if (pending.size >= maxInFlight) throw new RangeError("zlocale: loader in-flight limit exceeded");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      job = { controller, users: 0, promise: undefined! };
      const current = job;
      current.promise = Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw cancelled();
          return (loaders.get(key) as CatalogLoaders[string])!({ signal: controller.signal });
        })
        .then(input => {
          if (controller.signal.aborted || closed) throw cancelled();
          const catalog = defineCatalog(input, options.limits);
          if (`${catalog.locale}/${catalog.domain}` !== key) throw new Error("zlocale: loader returned wrong locale/domain");
          const size = new TextEncoder().encode(serializeCatalogs([catalog], {
            maxBytes: 64 * 1024 * 1024, ...(options.limits ? { limits: options.limits } : {}),
          })).length;
          if (size > maxBytes) throw new RangeError("zlocale: loader cache byte limit exceeded");
          while (cache.size >= max || bytes + size > maxBytes) drop(cache.keys().next().value!);
          cache.set(key, { catalog, bytes: size }); bytes += size;
          return catalog;
        }).finally(() => { clearTimeout(timer); pending.delete(key); });
      // Timed-out noncooperative work retains its pending slot until actual settlement.
      void current.promise.catch(() => {});
      pending.set(key, current);
    }
    const current = job;
    current.users++;
    return new Promise<Catalog>((resolve, reject) => {
      let done = false;
      const finish = (error: unknown, catalog?: Catalog, failed = false) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        current.controller.signal.removeEventListener("abort", abort);
        if (--current.users === 0 && pending.get(key) === current) current.controller.abort();
        if (failed) reject(error); else resolve(catalog!);
      };
      const abort = () => finish(cancelled(), undefined, true);
      signal?.addEventListener("abort", abort, { once: true });
      current.controller.signal.addEventListener("abort", abort, { once: true });
      current.promise.then(value => finish(undefined, value), error => finish(error, undefined, true));
      if (signal?.aborted || current.controller.signal.aborted) abort();
    });
  };
  /** Invalidate after a source revision. In-flight stale results can never repopulate the cache. */
  const invalidate = (key?: string) => {
    if (key !== undefined) { checkKey(key); drop(key); pending.get(key)?.controller.abort(); }
    else { cache.clear(); bytes = 0; for (const job of pending.values()) job.controller.abort(); }
  };
  return Object.freeze({
    load,
    async preload(keys: readonly string[], settings: CatalogLoadOptions = {}): Promise<Catalog[]> {
      if (!Array.isArray(keys) || keys.length > 1024) throw new RangeError("zlocale: invalid preload list");
      keys.forEach(checkKey);
      const results: Catalog[] = new Array(keys.length);
      let next = 0;
      const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, maxInFlight, keys.length) }, async () => {
        while (next < keys.length) { const index = next++; results[index] = await load(keys[index]!, settings); }
      }));
      const failure = settled.find(item => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (closed) throw new Error("zlocale: catalog loader closed");
      return results;
    },
    invalidate,
    clear: () => invalidate(),
    /** Abort and drain actual loader work; borrowed transports stay owned by the application. */
    async close(): Promise<void> {
      closed = true; invalidate();
      await Promise.allSettled([...pending.values()].map(job => job.promise));
    },
    getStatus: () => Object.freeze({ cached: cache.size, bytes, pending: pending.size, closed }),
  });
}
