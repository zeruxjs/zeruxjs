import type { BaseIssue, Config } from '../../types/index.js';

/**
 * Cache interface type.
 *
 * @beta
 */
export interface Cache<TValue> {
  /** Identify compatible legacy local parse results by primitive value or weak reference identity and selected flags. Explicit controlled parses bypass reuse at root execution.
   * @param {unknown} input - Candidate primitive or trusted object/function reference; deep mutation is not detected.
   * @param {Config<BaseIssue<unknown>>} config - Optional legacy parse flags/messages used by this key policy.
   * @returns {string} Local compatibility key, not a content hash, tenant permission or distributed namespace.
   */
  key(input: unknown, config?: Config<BaseIssue<unknown>>): string;
  /** Read one borrowed local cached value; native implementation promotes access and checks age lazily.
   * @param {string} key - Instance compatibility key.
   * @returns {TValue | undefined} Borrowed value or cache miss; no deep defensive-copy guarantee.
   */
  get(key: string): TValue | undefined;
  /** Store one borrowed value under the configured local size/age policy.
   * @param {string} key - Instance compatibility key.
   * @param {TValue} value - Borrowed schema result; caller owns mutation and privacy policy.
   * @returns {void} Updates only local cache state; no persistence or network acknowledgement.
   */
  set(key: string, value: TValue): void;
  /** Discard cached entries; this state-only API owns no native resources, workers or timers.
   * @returns {void} Clears local entries without inventing a close/dispose lifecycle.
   */
  clear(): void;
}

/**
 * Cache config type.
 *
 * @beta
 */
export interface CacheConfig {
  /**
   * The maximum number of items to cache.
   *
   * @default 1000
   */
  maxSize?: number;
  /**
   * The maximum age of a cache entry in milliseconds.
   *
   * @default Infinity
   */
  maxAge?: number;
}
