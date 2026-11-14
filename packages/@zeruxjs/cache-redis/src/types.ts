import type { RedisCachePolicy as importPolicy } from './policy.js';
import type { CacheValue } from '@zeruxjs/cache';

/** Minimal Redis protocol surface; supports injected clients without a live Redis service. */
export interface RedisCacheClient {
  /** Execute trusted script text; the wrapper exposes only its fixed limiter strategy.
   * @param {string} script - Trusted server-owned Lua source.
   * @param {{ keys: string[]; arguments: string[] }} options - Driver-native request/scan/write options.
   * @returns {Promise<unknown>} Unvalidated native script reply.
   */
  eval?(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
  /** Read one raw stored string.
   * @param {string} key - Exact native key.
   * @returns {Promise<string|null>} Native value or null.
   */
  get(key: string): Promise<string | null>;
  /** Send one native string write with optional EX/NX/XX.
   * @param {string} key - Exact native key.
   * @param {string} value - Already encoded string payload.
   * @param {{ EX?: number; NX?: boolean; XX?: boolean }} options - Driver-native request/scan/write options.
   * @returns {Promise<unknown>} Driver reply; callers interpret condition semantics.
   */
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean; XX?: boolean }
  ): Promise<unknown>;
  /** Delete exact native keys.
   * @param {string | string[]} keys - Exact native key or bounded key array.
   * @returns {Promise<number>} Native removed count.
   */
  del(keys: string | string[]): Promise<number>;
  /** Check native key existence.
   * @param {string} key - Exact native key.
   * @returns {Promise<number>} Native presence count.
   */
  exists(key: string): Promise<number>;
  /** Read native string values in order.
   * @param {string[]} keys - Exact native key or bounded key array.
   * @returns {Promise<Array<string|null>>} One native value/null per key.
   */
  mGet(keys: string[]): Promise<Array<string | null>>;
  /** Write native strings without implying facade transaction guarantees.
   * @param {Record<string, string>} values - Prepared native string values.
   * @returns {Promise<unknown>} Native reply.
   */
  mSet(values: Record<string, string>): Promise<unknown>;
  /** Increment native integer data.
   * @param {string} key - Exact native key.
   * @param {number} amount - Native arithmetic delta.
   * @returns {Promise<number>} Native numeric result, validated by the wrapper.
   */
  incrBy(key: string, amount: number): Promise<number>;
  /** Decrement native integer data.
   * @param {string} key - Exact native key.
   * @param {number} amount - Native arithmetic delta.
   * @returns {Promise<number>} Native numeric result, validated by the wrapper.
   */
  decrBy(key: string, amount: number): Promise<number>;
  /** Set a native expiry.
   * @param {string} key - Exact native key.
   * @param {number} seconds - Native expiry seconds.
   * @returns {Promise<number|boolean>} Driver touch/presence response.
   */
  expire(key: string, seconds: number): Promise<number | boolean>;
  /** Iterate native scan pages; never a snapshot.
 * @param {{
    MATCH?: string;
    COUNT?: number;
  }} options - Driver-native request/scan/write options.
 * @returns {AsyncIterable<string|string[]>} Native key/page stream owned by its consumer.
 */
  scanIterator(options?: {
    MATCH?: string;
    COUNT?: number;
  }): AsyncIterable<string | string[]>;
  /** Optional destructive whole-database flush.
   * @returns {Promise<unknown>} Native reply; wrappers require explicit approval.
   */
  flushDb?(): Promise<unknown>;
  /** Close a client only when its owner requests it.
   * @returns {Promise<unknown>} Native close receipt.
   */
  close?(): Promise<unknown>;
  /** Optional public hard connection teardown.
   * @returns {void} Does not prove a submitted write rolled back.
   */
  destroy?(): void;
  /** Remove the exact native listener.
   * @param {string} event - Explicit event name.
   * @param {(...args: unknown[]) => void} listener - Callback retained/removed by its owner.
   * @returns {unknown} Driver-defined listener result.
   */
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  /** Register a native error listener with explicit removal ownership.
   * @param {string} event - Explicit event name.
   * @param {(...args: unknown[]) => void} listener - Callback retained/removed by its owner.
   * @returns {unknown} Driver-defined listener result.
   */
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface RedisCacheHelperOptions extends importPolicy {
  /** Optional injected native client; transport configuration remains host-owned. */
  client?: RedisCacheClient;
  /** Dangerous global operation; never enabled by default. */
  allowFlushDb?: boolean;
  /** Close injected client when this helper is closed; defaults to false. */
  ownClient?: boolean;
  [key: string]: unknown;
}
export type { CacheValue };
