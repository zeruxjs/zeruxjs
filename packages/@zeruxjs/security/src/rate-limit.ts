export interface RateLimitOptions {
  /** Positive safe-integer fixed-window milliseconds. */
  windowMs: number;
  /** Positive safe-integer total weight allowance per fixed window. */
  max: number;
  /** Positive safe-integer live-key cap; defaults 10000. */
  maxKeys?: number;
  /** Trusted Unix-millisecond clock; defaults Date.now. */
  now?: () => number;
}
export interface RateLimitResult {
  /** Whether the complete charge was accepted. */
  allowed: boolean;
  /** Nonnegative remaining weight allowance. */
  remaining: number;
  /** Unix milliseconds when this fixed window expires. */
  resetAt: number;
  /** Zero when allowed; otherwise ceil of remaining-window seconds. */
  retryAfterSeconds: number;
}
/** Create the legacy bounded synchronous process-local fixed-window limiter. Shared/distributed accounting requires the separate atomic-store API.
 * @param {RateLimitOptions} options - Explicit positive window/max, finite key cap and optional trusted clock.
 * @returns {object} Local check/reset/size helpers; no socket, timer, background sweep or durable store starts.
 */
export function createRateLimiter(options: RateLimitOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    ![options.windowMs, options.max].every(
      (n) => Number.isSafeInteger(n) && n > 0
    )
  ) {
    throw new RangeError('Invalid limiter settings');
  }
  /** Explicit process-local key cap, default 10000; this is not distributed/durable accounting. */
  const cap = options.maxKeys ?? 10000;
  if (!Number.isSafeInteger(cap) || cap < 1) {
    throw new RangeError('Invalid maxKeys');
  }
  /** Borrowed trusted clock, default Date.now; results are validated on every check. */
  const now = options.now ?? Date.now;
  /** Bounded process-local fixed-window counters; live counters are never evicted to admit a new key. */
  const buckets = new Map<string, { count: number; reset: number }>();
  return {
    /** Charge a whole weight only when quota allows. Expired counters are lazily removed; capacity rejection does not evict live state.
     * @param {string} key - Bounded nonempty literal accounting key; verifying caller identity remains host-owned.
     * @param {number} weight - Positive safe-integer charge; defaults to one.
     * @returns {RateLimitResult} Explicit quota/remaining/reset/retry values; invalid input or clock throws.
     */
    check(key: string, weight = 1): RateLimitResult {
      if (
        typeof key !== 'string' ||
        !key ||
        Buffer.byteLength(key) > 512 ||
        !Number.isSafeInteger(weight) ||
        weight < 1
      ) {
        throw new Error('Invalid rate-limit key or weight');
      }
      /** Validated Unix-millisecond time used for lazy expiry and retry timing. */
      const stamp = now();
      if (
        !Number.isSafeInteger(stamp) ||
        stamp < 0 ||
        !Number.isSafeInteger(stamp + options.windowMs)
      ) {
        throw new RangeError('Invalid limiter clock');
      }
      let state = buckets.get(key);
      if (state && state.reset <= stamp) {
        buckets.delete(key);
        state = undefined;
      }
      if (!state) {
        if (buckets.size >= cap) {
          // Reclaim expired local counters only; never evict live accounting at capacity.
          for (const [name, item] of buckets) {
            if (item.reset <= stamp) {
              buckets.delete(name);
            }
          }
          if (buckets.size >= cap) {
            return {
              allowed: false,
              remaining: 0,
              resetAt: stamp + options.windowMs,
              retryAfterSeconds: Math.ceil(options.windowMs / 1000),
            };
          }
        }
        state = { count: 0, reset: stamp + options.windowMs };
        buckets.set(key, state);
      }
      /** Quota decision after checking the complete weight against the fixed-window maximum. */
      const allowed = state.count + weight <= options.max;
      if (allowed) {
        state.count += weight;
      }
      return {
        allowed,
        remaining: Math.max(0, options.max - state.count),
        resetAt: state.reset,
        retryAfterSeconds: allowed
          ? 0
          : Math.ceil((state.reset - stamp) / 1000),
      };
    },
    /** Explicitly remove one local accounting key or all local counters. This operation requires host authorization if exposed over HTTP.
     * @param {string} key - Optional exact key; omission or legacy falsy key resets the local map.
     * @returns {void} Only this process-local limiter is affected.
     */
    reset(key?: string) {
      if (key) {
        buckets.delete(key);
      } else {
        buckets.clear();
      }
    },
    get size() {
      return buckets.size;
    },
  };
}
