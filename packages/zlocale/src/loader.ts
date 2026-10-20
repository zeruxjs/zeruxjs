import type { Catalog, CatalogLimits } from "./types.js";
import {
  bounded,
  canonicalLocale,
  dataEntries,
  defineCatalog,
  validateDomain,
} from "./validation.js";
import { Lru } from "./cache.js";
/** A loader is trusted application code; it owns its own timeout/cancellation and imports. */
export type CatalogLoaders = Readonly<Record<string, () => Promise<unknown>>>;
/** Create an explicit allowlisted, bounded, single-flight catalog loader.
 * @param manifest Locale/domain keys mapped to trusted import/fetch functions.
 * @param options Cache/in-flight/concurrency limits and catalog bounds.
 * @returns Async loading facade, separate from synchronous translation. No loader runs until load/preload.
 */
export function createCatalogLoader(
  manifest: CatalogLoaders,
  options: {
    maxEntries?: number;
    maxInFlight?: number;
    concurrency?: number;
    limits?: CatalogLimits;
  } = {},
) {
  const max = bounded(options.maxEntries, 32, 1024),
    maxInFlight = bounded(options.maxInFlight, 16, 128),
    concurrency = bounded(options.concurrency, 4, 32);
  const loaders = new Map(dataEntries(manifest)),
    cache = new Lru<string, Catalog>(max),
    pending = new Map<string, Promise<Catalog>>();
  if (
    loaders.size > 1024 ||
    [...loaders.values()].some((value) => typeof value !== "function")
  )
    throw new TypeError("zlocale: invalid loader manifest");
  for (const key of loaders.keys()) {
    const [language, domain, ...extra] = key.split("/");
    if (
      !language ||
      !domain ||
      extra.length ||
      new Intl.Locale(canonicalLocale(language)).baseName !== language ||
      validateDomain(domain) !== domain
    )
      throw new TypeError("zlocale: loader keys must be canonical locale/domain");
  }
  /** Load one declared catalog; identical concurrent keys share work. @param key Declared locale/domain key. @returns Immutable validated catalog. Application loader may perform I/O. */
  const load = (key: string): Promise<Catalog> => {
    if (!loaders.has(key))
      return Promise.reject(new Error("zlocale: undeclared catalog key"));
    const ready = cache.get(key);
    if (ready) return Promise.resolve(ready);
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= maxInFlight)
      return Promise.reject(
        new RangeError("zlocale: loader in-flight limit exceeded"),
      );
    const promise = Promise.resolve()
      .then(() => (loaders.get(key) as () => Promise<unknown>)())
      .then((input) => {
        const catalog = defineCatalog(input, options.limits);
        if (catalog.locale + "/" + catalog.domain !== key)
          throw new Error("zlocale: loader returned wrong locale/domain");
        cache.set(key, catalog);
        return catalog;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, promise);
    return promise;
  };
  return Object.freeze({
    load,
    /** Preload a bounded key list with bounded concurrency. @param keys Declared keys. @returns Catalogs in caller order. Uses application loaders only. */
    async preload(keys: readonly string[]): Promise<Catalog[]> {
      if (!Array.isArray(keys) || keys.length > 1024)
        throw new RangeError("zlocale: invalid preload list");
      const results: Catalog[] = new Array(keys.length);
      let next = 0;
      // Await every worker before returning a failure so no internal rejection escapes.
      const workers = Array.from(
        { length: Math.min(concurrency, maxInFlight, keys.length) },
        async () => {
          while (next < keys.length) {
            const index = next++;
            results[index] = await load(keys[index]!);
          }
        },
      );
      const settled = await Promise.allSettled(workers);
      const failure = settled.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      return results;
    },
    /** Drop fulfilled cached entries. @returns Nothing. Does not cancel application loader work. */
    clear() {
      cache.clear();
    },
  });
}
