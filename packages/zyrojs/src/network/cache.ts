/** Instance-scoped asynchronous cache with TTL, LRU eviction, in-flight de-duplication and invalidation. */
export interface QueryCacheOptions { maxEntries?: number; defaultTtlMs?: number; }
export interface CacheQueryOptions { ttlMs?: number; tags?: string[]; signal?: AbortSignal; }
interface Entry { value: unknown; expiresAt: number; tags: string[]; }
export class QueryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly max: number;
  private readonly ttl: number;
  constructor(options: QueryCacheOptions = {}) {
    this.max = options.maxEntries ?? 100; this.ttl = options.defaultTtlMs ?? 0;
    if (!Number.isSafeInteger(this.max) || this.max < 1 || this.max > 10000 || !Number.isSafeInteger(this.ttl) || this.ttl < 0 || this.ttl > 86_400_000) throw new RangeError('Invalid cache options');
  }
  get size() { return this.entries.size; }
  get<T>(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return undefined;
    if (Date.now() >= item.expiresAt) { this.entries.delete(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, item);
    return item.value as T;
  }
  set<T>(key: string, value: T, options: CacheQueryOptions = {}): void {
    const ttl = options.ttlMs ?? this.ttl;
    if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 86_400_000) throw new RangeError('Invalid cache TTL');
    if (ttl === 0) { this.entries.delete(key); return; }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttl, tags: [...(options.tags ?? [])] });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
  /** Cache only successful computations. Aborted callers do not poison the shared result. */
  async query<T>(key: string, load: () => Promise<T>, options: CacheQueryOptions = {}): Promise<T> {
    if (options.signal?.aborted) throw options.signal.reason;
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    let task = this.pending.get(key) as Promise<T> | undefined;
    if (!task) {
      task = Promise.resolve().then(load).then(value => {
        if (this.pending.get(key) === task && !options.signal?.aborted) this.set(key, value, options);
        return value;
      }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
      this.pending.set(key, task);
    }
    if (!options.signal) return task;
    return new Promise<T>((resolve, reject) => {
      const abort = () => { options.signal?.removeEventListener('abort', abort); reject(options.signal?.reason); };
      options.signal!.addEventListener('abort', abort, { once: true });
      if (options.signal!.aborted) { abort(); return; }
      task!.then(value => { options.signal?.removeEventListener('abort', abort); resolve(value); }, error => { options.signal?.removeEventListener('abort', abort); reject(error); });
    });
  }
  invalidate(key: string): boolean { this.pending.delete(key); return this.entries.delete(key); }
  invalidateTag(tag: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) if (entry.tags.includes(tag)) { this.entries.delete(key); count++; }
    return count;
  }
  clear(): void { this.entries.clear(); this.pending.clear(); }
}
export const createQueryCache = (options?: QueryCacheOptions) => new QueryCache(options);
