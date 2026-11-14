import type { BaseIssue, Config } from '../types/index.js';
import type { Cache, CacheConfig } from './types/cache.js';

/**
 * Efficient LRU cache using Map iteration order.
 */
class _LruCache<TValue> implements Cache<TValue> {
  /** Lazy local value/timestamp tuples; values remain borrowed references. */
  private store: Map<string, [TValue, number]> | undefined;

  /** Weak identity map avoids retaining object/function keys solely for key construction. */
  private refIds: WeakMap<WeakKey, number> | undefined;

  /** Monotonic local identity counter; clear does not promise identity reuse. */
  private refCount = 0;

  /** Legacy caller-owned maximum-entry policy; this constructor does not validate its runtime numeric range. */
  private readonly maxSize: number;
  /** Legacy maximum age in milliseconds, default Infinity; checked lazily on reads. */
  private readonly maxAge: number;
  /** Whether age tracking is finite; no background timer is started. */
  private readonly hasMaxAge: boolean;

  /** Create lazy process-local cache state. Legacy typed maxSize/maxAge policy is not runtime validated here; no timers, connections or background expiration are allocated.
   * @param {CacheConfig} config - Optional caller-owned cache policy, default 1000 entries and infinite age.
   */
  constructor(config?: CacheConfig) {
    this.maxSize = config?.maxSize ?? 1000;
    this.maxAge = config?.maxAge ?? Infinity;
    this.hasMaxAge = isFinite(this.maxAge);
  }

  /** Construct a compatibility key component without deep serialization. Object/function values receive weak identity IDs; mutable content changes are not detected.
   * @param {unknown} input - Primitive value or trusted object/function reference to identify.
   * @returns {string} Legacy scalar/identity component; not a cryptographic digest or tenant authorization boundary.
   */
  #stringify(input: unknown): string {
    /** Native input kind selected without evaluating object properties or serializing private bodies. */
    const type = typeof input;
    if (type === 'string') {
      return `"${input}"`;
    }
    if (type === 'number' || type === 'boolean') {
      return `${input}`;
    }
    if (type === 'bigint') {
      return `${input}n`;
    }
    if (type === 'object' || type === 'function') {
      if (input) {
        this.refIds ??= new WeakMap();
        let id = this.refIds.get(input as WeakKey);
        if (!id) {
          id = ++this.refCount;
          this.refIds.set(input as WeakKey, id);
        }
        return `#${id}`;
      }
      return 'null';
    }
    return type;
  }

  /** Combine input identity/value with legacy language/message/abort policy only. Root execution bypasses reuse when explicit cancellation/budgets require independent work.
   * @param {unknown} input - Candidate primitive value or object/function identity.
   * @param {Config<BaseIssue<unknown>>} config - Optional legacy parse policy, default an empty record; callbacks remain trusted.
   * @returns {string} Process-local compatibility key; not an application-wide private cache namespace.
   */
  key(input: unknown, config: Config<BaseIssue<unknown>> = {}): string {
    return `${this.#stringify(input)}|${this.#stringify(config.lang)}|${this.#stringify(
      config.message
    )}|${this.#stringify(config.abortEarly)}|${this.#stringify(
      config.abortPipeEarly
    )}`;
  }

  /** Read and promote one entry, lazily evicting it when its configured age is exceeded. Expiry is checked only on reads, not by a timer.
   * @param {string} key - Compatibility key produced by this cache instance.
   * @returns {TValue | undefined} Borrowed cached value or undefined for absence/expiry; no deep defensive copy occurs here.
   */
  get(key: string): TValue | undefined {
    if (!this.store) {
      return undefined;
    }

    // Get entry tuple [value, timestamp]
    /** Borrowed local value/timestamp tuple; stale entries are removed before promotion. */
    const entry = this.store.get(key);

    // Return undefined if not found
    if (!entry) {
      return undefined;
    }

    // Delete stale entry if maxAge is exceeded
    if (this.hasMaxAge && Date.now() - entry[1] > this.maxAge) {
      this.store.delete(key);
      return undefined;
    }

    // Reorder by deleting and re-inserting at end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);

    // Return cached value
    return entry[0];
  }

  /** Store a borrowed value and promote it to most-recently-used, evicting at most one oldest key when over the configured legacy size.
   * @param {string} key - Compatibility instance key.
   * @param {TValue} value - Borrowed cached value; callers own mutation/privacy policy.
   * @returns {void} Updates only local map state with optional timestamp; no durable write or network operation occurs.
   */
  set(key: string, value: TValue): void {
    this.store ??= new Map();

    // Delete first to ensure insertion at end for correct ordering
    this.store.delete(key);

    // Set value with current timestamp if maxAge is used
    /** Creation time only when age tracking is enabled; otherwise zero avoids unnecessary clock reads. */
    const timestamp = this.hasMaxAge ? Date.now() : 0;
    this.store.set(key, [value, timestamp]);

    // Evict oldest entry (first key) if over maxSize
    if (this.store.size > this.maxSize) {
      this.store.delete(this.store.keys().next().value!);
    }
  }

  /** Remove current cached entries without inventing a resource close lifecycle or resetting weak reference identities.
   * @returns {void} Clears local entry state; no timer, worker or external dependency needs disposal.
   */
  clear(): void {
    this.store?.clear();
  }
}

export { _LruCache };
