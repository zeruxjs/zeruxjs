/** Instance-scoped asynchronous cache with TTL, LRU eviction, in-flight de-duplication and invalidation. */
export interface QueryCacheOptions {
  /** Maximum number of completed entries retained by the cache. */
  maxEntries?: number;
  /** Default entry lifetime in milliseconds; zero disables completed-value storage. */
  defaultTtlMs?: number;
}
export interface CacheQueryOptions {
  /** Entry lifetime in milliseconds for this query. */
  ttlMs?: number;
  /** Invalidation tags associated with the completed entry. */
  tags?: string[];
  /** Signal that cancels only this caller's wait. */
  signal?: AbortSignal;
}
interface Entry {
  /** Cached query result. */
  value: unknown;
  /** Absolute expiry time in milliseconds, used for lazy expiry checks. */
  expiresAt: number;
  /** Tags used for explicit invalidation. */
  tags: string[];
}
/** Instance-owned bounded cache with TTL, tags, LRU eviction and request coalescing. */
export class QueryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly max: number;
  private readonly ttl: number;
  /**
   * Create a cache whose entries and pending work are isolated to this instance.
   *
   * @param {QueryCacheOptions} options - Entry and TTL limits for this cache.
   */
  constructor(options: QueryCacheOptions = {}) {
    this.max = options.maxEntries ?? 100;
    this.ttl = options.defaultTtlMs ?? 0;
    if (
      !Number.isSafeInteger(this.max) ||
      this.max < 1 ||
      this.max > 10000 ||
      !Number.isSafeInteger(this.ttl) ||
      this.ttl < 0 ||
      this.ttl > 86_400_000
    ) {
      throw new RangeError('Invalid cache options');
    }
  }
  /**
   * Count retained completed entries; expired entries are removed lazily on reads.
   * @returns {number} Retained completed-entry count before lazy expiry cleanup.
   */
  get size() {
    return this.entries.size;
  }
  /**
   * Read a live entry and update LRU order; values are borrowed, not cloned.
   * @param {string} key - Host-scoped identity; include tenant/application dimensions for private data.
   * @returns {T | undefined} Borrowed live value, or undefined after miss/expiry.
   */
  get<T>(key: string): T | undefined {
    /** Completed entry; reads evict expired entries and move live entries to the newest LRU position. */
    const item = this.entries.get(key);
    if (!item) {
      return undefined;
    }
    if (Date.now() >= item.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, item);
    return item.value as T;
  }
  /**
   * Retain a successful value under finite TTL/LRU policy; zero TTL deletes it.
   * @param {string} key - Host-scoped identity; include tenant/application dimensions for private data.
   * @param {T} value - Borrowed successful result, retained without a defensive clone.
   * @param {CacheQueryOptions} options - TTL/tag policy and optional caller-wait cancellation.
   * @returns {void} Stores under TTL/LRU policy or removes the entry when TTL is zero.
   */
  set<T>(key: string, value: T, options: CacheQueryOptions = {}): void {
    /** Effective retention; zero explicitly removes the entry rather than storing indefinitely. */
    const ttl = options.ttlMs ?? this.ttl;
    if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 86_400_000) {
      throw new RangeError('Invalid cache TTL');
    }
    if (ttl === 0) {
      this.entries.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      tags: [...(options.tags ?? [])],
    });
    while (this.entries.size > this.max) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
  /** Cache only successful computations. Aborted callers do not poison the shared result. */
  /**
   * Coalesce same-key loads; caller cancellation does not forcibly stop shared loader work.
   * @param {string} key - Host-scoped identity; include tenant/application dimensions for private data.
   * @param {() => Promise<T>} load - Trusted asynchronous loader, invoked once per current pending key.
   * @param {CacheQueryOptions} options - TTL/tag policy and optional caller-wait cancellation.
   * @returns {Promise<T>} Current shared load result; caller abort rejects only its wait.
   */
  async query<T>(
    key: string,
    load: () => Promise<T>,
    options: CacheQueryOptions = {}
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    /** Only non-undefined completed values count as hits; undefined results trigger another load. */
    const hit = this.get<T>(key);
    if (hit !== undefined) {
      return hit;
    }
    let task = this.pending.get(key) as Promise<T> | undefined;
    if (!task) {
      task = Promise.resolve()
        .then(load)
        .then((value) => {
          if (this.pending.get(key) === task && !options.signal?.aborted) {
            this.set(key, value, options);
          }
          return value;
        })
        .finally(() => {
          if (this.pending.get(key) === task) {
            this.pending.delete(key);
          }
        });
      this.pending.set(key, task);
    }
    if (!options.signal) {
      return task;
    }
    return new Promise<T>((resolve, reject) => {
      /**
       * Reject only this wait and detach its abort listener; shared work may settle later.
       * @returns {void} Rejects this wait and removes its abort listener.
       */
      const abort = () => {
        options.signal?.removeEventListener('abort', abort);
        reject(options.signal?.reason);
      };
      options.signal!.addEventListener('abort', abort, { once: true });
      if (options.signal!.aborted) {
        abort();
        return;
      }
      task!.then(
        (value) => {
          options.signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        (error) => {
          options.signal?.removeEventListener('abort', abort);
          reject(error);
        }
      );
    });
  }
  /**
   * Fence the current pending task from caching and remove this completed key.
   * @param {string} key - Host-scoped identity; include tenant/application dimensions for private data.
   * @returns {boolean} Whether a completed entry existed; pending commits are fenced regardless.
   */
  invalidate(key: string): boolean {
    this.pending.delete(key);
    return this.entries.delete(key);
  }
  /**
   * Remove completed tagged entries only; pending loads are not tag-indexed or fenced.
   * @param {string} tag - Exact completed-entry tag to invalidate.
   * @returns {number} Number of completed entries removed; pending loads remain unchanged.
   */
  invalidateTag(tag: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.tags.includes(tag)) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }
  /**
   * Remove completed entries and fence pending commits without cancelling loader promises.
   * @returns {void} Clears values and pending commit identities without cancelling loaders.
   */
  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }
}
/**
 * Create an inert per-instance cache; no timers or network requests start here.
 * @param {QueryCacheOptions} options - TTL/tag policy and optional caller-wait cancellation.
 * @returns {QueryCache} Independent cache with no timer or network acquisition.
 */
export const createQueryCache = (options?: QueryCacheOptions) =>
  new QueryCache(options);
