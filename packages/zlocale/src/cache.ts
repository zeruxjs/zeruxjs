/** Per-owner LRU cache; never creates global/application state. */
export class Lru<K, V> {
  private values = new Map<K, V>();
  /** @param capacity Maximum retained entries. @returns Cache instance. No globals. */
  constructor(private readonly capacity: number) {}
  /** @param key Key. @returns Value and refreshes recency. No globals. */
  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }
  /** @param key Key. @param value Immutable cached value. @returns Nothing; evicts oldest if full. */
  set(key: K, value: V): void {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > this.capacity)
      this.values.delete(this.values.keys().next().value!);
  }
  /** @returns Nothing. Releases retained values. No globals. */
  clear(): void {
    this.values.clear();
  }
}
