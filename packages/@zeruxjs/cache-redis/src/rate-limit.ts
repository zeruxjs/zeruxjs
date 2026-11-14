import type {
  AtomicRateLimitStore,
  AtomicRateLimitClaim,
  RateLimitRequest,
} from '@zeruxjs/security';
import type { RedisCacheHelper } from './helper.js';
import { redisError } from './policy.js';
export interface RedisRateLimitStoreOptions {
  /** Explicit same-slot tag, 1–64 ASCII word/dash characters. */
  namespace: string;
  /** Default 10000; hard live subject cap up to 100000. */
  maxKeys?: number;
  /** Default one day; claim windows cannot exceed this TTL ceiling. */
  maxWindowMs?: number;
  /** Default false; explicit true transfers helper cleanup ownership. */
  ownHelper?: boolean;
}
/** Create an explicit distributed limiter wrapper using only the reviewed atomic helper path.
 * @param {RedisCacheHelper} helper - Configured EVAL-capable helper; unsupported native clients reject.
 * @param {RedisRateLimitStoreOptions} options - Trusted namespace and bounded policy.
 * @returns {AtomicRateLimitStore} Closeable store; helper remains borrowed unless ownHelper true.
 */
export function createRedisRateLimitStore(
  helper: RedisCacheHelper,
  options: RedisRateLimitStoreOptions
): AtomicRateLimitStore {
  if (
    !helper ||
    typeof helper.claimRateLimit !== 'function' ||
    !options ||
    typeof options !== 'object' ||
    Object.keys(options).some(
      (key) =>
        !['namespace', 'maxKeys', 'maxWindowMs', 'ownHelper'].includes(key)
    ) ||
    typeof options.namespace !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace) ||
    (options.ownHelper !== undefined && typeof options.ownHelper !== 'boolean')
  ) {
    throw redisError('REDIS_INVALID_LIMITER_STORE');
  }
  if (typeof helper.native().eval !== 'function') {
    throw redisError('REDIS_ATOMIC_LIMITER_UNSUPPORTED');
  }
  /** Hard live subject-cardinality ceiling, default 10000, maximum 100000. */
  const maxKeys = options.maxKeys === undefined ? 10000 : options.maxKeys;
  /** Maximum claim window and script TTL, default one day. */
  const maxWindowMs =
    options.maxWindowMs === undefined ? 86400000 : options.maxWindowMs;
  if (
    !Number.isSafeInteger(maxKeys) ||
    maxKeys < 1 ||
    maxKeys > 100000 ||
    !Number.isSafeInteger(maxWindowMs) ||
    maxWindowMs < 1 ||
    maxWindowMs > 86400000
  ) {
    throw redisError('REDIS_INVALID_LIMITER_STORE');
  }
  /** Validated hash tag shared by the two atomic limiter keys. */
  const namespace = options.namespace;
  /** Whether store close also owns helper shutdown; default false. */
  const own = options.ownHelper === true;
  let closed = false;
  return {
    capability: 'atomic-fixed-window-v1',
    scope: 'distributed',
    /** Claim one opaque fixed-window subject without cache get/set emulation.
     * @param {AtomicRateLimitClaim} input - Opaque HMAC-bound subject claim from the security package.
     * @param {RateLimitRequest} request - Optional caller cancellation/deadline.
     * @returns {Promise<AtomicRateLimitDecision>} Server decision or explicit unavailable/unknown outcome.
     */
    async claim(input: AtomicRateLimitClaim, request: RateLimitRequest = {}) {
      if (closed) {
        throw redisError('REDIS_LIMITER_CLOSED');
      }
      return helper.claimRateLimit(
        input,
        { namespace, maxKeys, maxWindowMs },
        request
      );
    },
    /** Fence claims and close only an explicitly owned helper.
     * @returns {Promise<void>} Store shutdown completion; borrowed helper stays usable.
     */
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      if (own) {
        await helper.close();
      }
    },
  };
}
