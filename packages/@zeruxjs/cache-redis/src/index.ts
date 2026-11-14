import { createRedisCacheHelper, type RedisCacheHelper } from './helper.js';
import type { RedisCacheClient, RedisCacheHelperOptions } from './types.js';
import {
  createIORedisCacheHelper,
  type IORedisCompatibleClient,
} from './ioredis.js';
import { redisPolicy, redisError } from './policy.js';

/** Create or wrap one explicitly selected cache driver with bounded startup; BullMQ policy stays separate.
 * @param {Record<string, unknown>} raw - Trusted host configuration; credentials remain server-private.
 * @returns {Promise<RedisCacheHelper>} Owned wrapper; native connection ownership is explicit. */
export const createCacheHelper = async (
  raw: Record<string, unknown>
): Promise<RedisCacheHelper> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw redisError('REDIS_INVALID_OPTIONS');
  }
  /** Host configuration interpreted only after outer object validation. */
  const options = raw as RedisCacheHelperOptions & {
    driver?: 'redis' | 'ioredis';
    url?: string;
  };
  /** Validated wrapper/startup limits, not forwarded as driver options. */
  const policy = redisPolicy(options);
  /** Separate driver transport options from wrapper policy and ownership; no request-derived package selection. */
  const {
    driver = 'redis',
    allowFlushDb,
    ownClient,
    client,
    commandTimeoutMs: _command,
    connectTimeoutMs: _connect,
    shutdownTimeoutMs: _shutdown,
    maxPendingCommands: _pending,
    maxReconnectAttempts: _reconnect,
    maxScanPages: _scan,
    onOperation: _hook,
    ...connectionOptions
  } = options;
  if (
    !['redis', 'ioredis'].includes(driver) ||
    (allowFlushDb !== undefined && typeof allowFlushDb !== 'boolean') ||
    (ownClient !== undefined && typeof ownClient !== 'boolean')
  ) {
    throw redisError('REDIS_INVALID_OPTIONS');
  }
  if (options.url !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(options.url);
    } catch {
      throw redisError('REDIS_INVALID_URL');
    }
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
      throw redisError('REDIS_INVALID_URL');
    }
  }
  /** Validated wrapper configuration shared by either explicitly selected driver. */
  const helperConfig = { ...policy, allowFlushDb, ownClient };
  if (client) {
    return driver === 'ioredis'
      ? createIORedisCacheHelper(
          client as unknown as IORedisCompatibleClient,
          helperConfig
        )
      : createRedisCacheHelper(client, helperConfig);
  }
  if (
    connectionOptions.keyPrefix !== undefined ||
    connectionOptions.cluster !== undefined
  ) {
    throw redisError('REDIS_UNSUPPORTED_CACHE_CONNECTION');
  }
  // Reject native replay/queue overrides rather than silently weakening owned-cache policy.
  for (const key of [
    'retryStrategy',
    'reconnectOnError',
    'autoResendUnfulfilledCommands',
    'enableOfflineQueue',
    'maxRetriesPerRequest',
    'disableOfflineQueue',
    'commandsQueueMaxLength',
  ]) {
    if (connectionOptions[key] !== undefined) {
      throw redisError('REDIS_CACHE_POLICY_OVERRIDE');
    }
  }
  if (
    connectionOptions.tls !== undefined &&
    (!connectionOptions.tls ||
      typeof connectionOptions.tls !== 'object' ||
      Array.isArray(connectionOptions.tls) ||
      (connectionOptions.tls as Record<string, unknown>).rejectUnauthorized ===
        false)
  ) {
    throw redisError('REDIS_INVALID_TLS');
  }
  if (
    connectionOptions.socket &&
    typeof connectionOptions.socket === 'object' &&
    (connectionOptions.socket as Record<string, unknown>).rejectUnauthorized ===
      false
  ) {
    throw redisError('REDIS_INVALID_TLS');
  }
  /** Keep native error events handled while operation failures retain their own causes.

 * @returns {void} No telemetry or secret logging. */
  const onError = () => {};
  type CacheConnection = RedisCacheClient & {
    connect(): Promise<unknown>;
    off?: (event: string, listener: () => void) => unknown;
  };
  if (driver === 'ioredis') {
    /** Fixed allowlisted driver module; never derived from a request. */
    const moduleId = 'ioredis';
    /** Lazily loaded supported driver constructor. */
    const { default: IORedis } = await import(moduleId);
    /** Separate the optional connection URL from owned ioredis transport settings. */
    const { url, ...opts } = connectionOptions;
    /** Owned-cache transport settings disabling offline replay and bounding reconnect. */
    const bounded = {
      ...opts,
      lazyConnect: true,
      connectTimeout: policy.connectTimeoutMs,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      reconnectOnError: false,
      retryStrategy: (attempt: number) =>
        attempt <= policy.maxReconnectAttempts
          ? Math.min(50 * attempt, 250)
          : null,
    };
    /** Owned ioredis connection; startup failure closes its wrapper. */
    const native = url ? new IORedis(url, bounded) : new IORedis(bounded);
    native.on('error', onError);
    /** Scoped wrapper acquired before connect so failure has a cleanup owner. */
    const adapted = createIORedisCacheHelper(native, {
      ...helperConfig,
      ownClient: true,
    });
    try {
      await start(
        () => native.connect(),
        () => native.disconnect(false),
        policy.connectTimeoutMs
      );
      return adapted;
    } catch (cause) {
      try {
        await adapted.close();
      } catch (cleanup) {
        throw new AggregateError(
          [redisError('REDIS_CONNECT_FAILED', cause), cleanup],
          'Redis initialization cleanup failed'
        );
      }
      throw redisError('REDIS_CONNECT_FAILED', cause);
    }
  }
  /** Fixed allowlisted driver module; never derived from a request. */
  const moduleId = 'redis';
  /** Lazily loaded fixed node-redis driver module. */
  const redis = await import(moduleId);
  /** Optional trusted socket settings, validated before connection creation. */
  const socket = connectionOptions.socket;
  if (
    socket !== undefined &&
    (!socket || typeof socket !== 'object' || Array.isArray(socket))
  ) {
    throw redisError('REDIS_INVALID_OPTIONS');
  }
  if (socket && 'reconnectStrategy' in socket) {
    throw redisError('REDIS_CACHE_POLICY_OVERRIDE');
  }
  /** Owned node-redis connection with bounded queue/startup settings. */
  const connection = redis.createClient({
    ...connectionOptions,
    disableOfflineQueue: true,
    commandsQueueMaxLength: policy.maxPendingCommands,
    socket: {
      ...(socket as object),
      connectTimeout: policy.connectTimeoutMs,
      reconnectStrategy: (attempt: number) =>
        attempt < policy.maxReconnectAttempts
          ? Math.min(50 * (attempt + 1), 250)
          : false,
    },
  }) as unknown as CacheConnection;
  connection.on?.('error', onError);
  try {
    await start(
      () => connection.connect(),
      () => connection.destroy?.(),
      policy.connectTimeoutMs
    );
    return createRedisCacheHelper(connection, {
      ...helperConfig,
      ownClient: true,
    });
  } catch (cause) {
    try {
      connection.destroy?.();
    } catch (cleanup) {
      throw new AggregateError(
        [redisError('REDIS_CONNECT_FAILED', cause), cleanup],
        'Redis initialization cleanup failed'
      );
    }
    throw redisError('REDIS_CONNECT_FAILED', cause);
  }
};
/** Bound connection establishment and destroy the acquired client on deadline.
 * @param {() => Promise<unknown>} connect - Deferred native connection attempt, invoked once.
 * @param {() => unknown} destroy - Owned native cleanup on startup deadline.
 * @param {number} timeout - Validated startup milliseconds.
 * @returns {Promise<void>} Connection completed or explicit startup failure; timer always removed.
 */
async function start(
  connect: () => Promise<unknown>,
  destroy: () => unknown,
  timeout: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(connect),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            destroy();
          } catch (cause) {
            reject(redisError('REDIS_CONNECT_FAILED', cause));
            return;
          }
          reject(redisError('REDIS_CONNECT_DEADLINE'));
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
export { RedisCacheHelper, createRedisCacheHelper } from './helper.js';
export type { RedisHelperConfig, RedisSetOptions } from './helper.js';
export type { RedisCacheClient, RedisCacheHelperOptions } from './types.js';
export { RedisCacheError } from './policy.js';
export type {
  RedisCachePolicy,
  RedisOperation,
  RedisOperationRecord,
  RedisRequestOptions,
} from './policy.js';
export {
  adaptIORedis,
  createIORedisCacheHelper,
  createBullMQRedisOptions,
  createBullMQRedisClusterConnections,
} from './ioredis.js';
export type {
  IORedisCompatibleClient,
  RedisConnectionSettings,
  RedisClusterSettings,
  BullMQClusterClient,
  BullMQClusterConstructor,
} from './ioredis.js';
export default createCacheHelper;

export { createRedisRateLimitStore } from './rate-limit.js';
export type { RedisRateLimitStoreOptions } from './rate-limit.js';
