/** Per-owner LRU cache; never creates global/application state. */
export class Lru<K, V> {
  /** Per-owner entries ordered from least to most recently touched. */
  private values = new Map<K, V>();
  /** Create an internal cache with a capacity validated by its owning factory.
   * @param {number} capacity - Maximum retained entries; this internal class does not validate policy itself.
   */
  constructor(private readonly capacity: number) {}
  /** Read an entry and refresh recency only when its value is not undefined.
   * @param {K} key - Owner-selected cache identity, never interpreted as code or a path.
   * @returns {V | undefined} Borrowed cached value, or undefined; undefined values cannot be distinguished from misses.
   */
  get(key: K): V | undefined {
    /** Retain one lookup result so recency and the return observe the same entry. */
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }
  /** Replace one entry and evict the oldest when exceeding the owner capacity.
   * @param {K} key - Owner-selected cache identity.
   * @param {V} value - Borrowed value; immutable catalog ownership is enforced by its caller.
   * @returns {void} Updates this instance only; eviction does not dispose borrowed values.
   */
  set(key: K, value: V): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.capacity) {
      this.values.delete(this.values.keys().next().value!);
    }
  }
  /** Release this owner's retained references without destroying borrowed values.
   * @returns {void} Clears every entry in this instance.
   */
  clear(): void {
    this.values.clear();
  }
}
