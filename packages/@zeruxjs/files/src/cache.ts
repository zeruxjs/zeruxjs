/** Process-local bounded byte cache. Callers must exclude private/encrypted objects. */
export class FileByteCache {
  /** Insertion-ordered LRU records; each payload is an owned byte copy. */
  private readonly entries = new Map<
    string,
    { data: Uint8Array; expires: number }
  >();
  /** Total currently retained payload bytes, excluding map/object overhead. */
  private bytes = 0;
  /** Cumulative successful reads, preserved across clear(). */
  private hits = 0;
  /** Cumulative absent/expired reads, preserved across clear(). */
  private misses = 0;
  /** Create a process-local copy-on-read/write LRU cache. The manager, not this class, excludes private/encrypted objects.
   * @param {number} maxEntries - Positive safe-integer entry cap; defaults to 64.
   * @param {number} maxBytes - Positive safe-integer retained-byte cap; defaults to 8 MiB.
   * @param {number} ttlMs - Positive safe-integer TTL in milliseconds; defaults to 15000.
   */
  constructor(
    private readonly maxEntries = 64,
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly ttlMs = 15000
  ) {
    if (
      ![maxEntries, maxBytes, ttlMs].every(
        (n) => Number.isSafeInteger(n) && n > 0
      )
    ) {
      throw new RangeError('Invalid file cache limits');
    }
  }
  /** Return a byte copy and refresh LRU order; expired reads count as misses.
   * @param {string} key - Caller-owned namespace including object identity and ETag.
   * @returns {Uint8Array | undefined} Independent bytes on a live hit, otherwise undefined.
   */
  get(key: string): Uint8Array | undefined {
    /** Retained entry checked against the current wall clock before copying. */
    const hit = this.entries.get(key);
    if (!hit || Date.now() > hit.expires) {
      this.misses++;
      if (hit) {
        this.delete(key);
      }
      return undefined;
    }
    this.hits++;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.data.slice();
  }
  /** Copy bytes, replace the previous key and evict oldest entries until both caps hold.
   * @param {string} key - Caller-owned cache key; this class does not authorize it.
   * @param {Uint8Array} data - Borrowed bytes copied before retention; over-cap objects are ignored.
   * @returns {void} No stored reference to the caller buffer is retained.
   */
  set(key: string, data: Uint8Array): void {
    if (data.byteLength > this.maxBytes) {
      return;
    }
    this.delete(key);
    this.entries.set(key, {
      data: data.slice(),
      expires: Date.now() + this.ttlMs,
    });
    this.bytes += data.byteLength;
    // Each eviction removes the oldest retained key until both independent caps hold.
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value!);
    }
  }
  /** Remove one retained key and update byte accounting.
   * @param {string} key - Exact cache key; missing keys are harmless.
   * @returns {void} No change when the key is absent.
   */
  delete(key: string): void {
    /** Previously retained bytes removed from size accounting exactly once. */
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.data.byteLength;
      this.entries.delete(key);
    }
  }
  /** Invalidate matching keys from a stable key snapshot.
   * @param {string} prefix - Literal prefix, not a regular expression or tenant authorization policy.
   * @returns {void} Matching entries removed from this process only.
   */
  deletePrefix(prefix: string): void {
    // Snapshot keys before deleting so iteration remains independent of map mutation.
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.delete(key);
      }
    }
  }
  /** Drop retained bytes without resetting lifetime hit/miss counters.
   * @returns {void} Entry and byte counts become zero.
   */
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
  /** Project current retention and cumulative observation counts.
   * @returns {object} Fresh counters; mutating them cannot change cache state.
   */
  stats() {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
