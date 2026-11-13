/** Instance-scoped asynchronous cache with TTL, LRU eviction, in-flight de-duplication and invalidation. */
export interface QueryCacheOptions {
  /** Maximum number of completed entries retained by the cache. */
  maxEntries?: number;
  /** Default entry lifetime in milliseconds; zero disables expiry. */
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
  /** Absolute expiry time in milliseconds, or zero when unbounded. */
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
   * size.
   * @returns {unknown} Result produced by this operation.
   */
  get size() {
    return this.entries.size;
  }
  /**
   * get.
   * @param {string} key - Input value for this operation.
   * @returns {T | undefined} Result produced by this operation.
   */
  get<T>(key: string): T | undefined {
    /** Stores the item value used by this module. */
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
   * set.
   * @param {string} key - Input value for this operation.
   * @param {T} value - Input value for this operation.
   * @param {CacheQueryOptions} options - Input value for this operation.
   * @returns {void} Result produced by this operation.
   */
  set<T>(key: string, value: T, options: CacheQueryOptions = {}): void {
    /** Stores the ttl value used by this module. */
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
   * query.
   * @param {string} key - Input value for this operation.
   * @param {() => Promise<T>} load - Input value for this operation.
   * @param {CacheQueryOptions} options - Input value for this operation.
   * @returns {Promise<T>} Result produced by this operation.
   */
  async query<T>(
    key: string,
    load: () => Promise<T>,
    options: CacheQueryOptions = {}
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    /** Stores the hit value used by this module. */
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
       * Application function abort.
       * @returns {unknown} Result produced by this operation.
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
   * invalidate.
   * @param {string} key - Input value for this operation.
   * @returns {boolean} Result produced by this operation.
   */
  invalidate(key: string): boolean {
    this.pending.delete(key);
    return this.entries.delete(key);
  }
  /**
   * invalidateTag.
   * @param {string} tag - Input value for this operation.
   * @returns {number} Result produced by this operation.
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
   * clear.
   * @returns {void} Result produced by this operation.
   */
  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }
}
/**
 * Application function createQueryCache.
 * @param {QueryCacheOptions} options - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
export const createQueryCache = (options?: QueryCacheOptions) =>
  new QueryCache(options);
