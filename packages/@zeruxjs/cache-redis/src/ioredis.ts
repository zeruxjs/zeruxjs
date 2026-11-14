import { RedisCacheError } from './policy.js';
import type { RedisCacheClient } from './types.js';
import { createRedisCacheHelper, type RedisHelperConfig } from './helper.js';

/** Bridge lowercase commands and actual Cluster master scanning to the existing structural client.
 * @param {IORedisCompatibleClient} client - Configured host-owned ioredis client.
 * @returns {RedisCacheClient} Transport bridge only; create a helper for bounded validation/ownership.
 */
export function adaptIORedis(
  client: IORedisCompatibleClient
): RedisCacheClient {
  /** Detect an actual injected master inventory; never infer Cluster from one endpoint. */
  const isCluster = typeof client.nodes === 'function';
  return {
    ...(client.eval
      ? {
          eval: (
            script: string,
            options: { keys: string[]; arguments: string[] }
          ) =>
            client.eval!(
              script,
              options.keys.length,
              ...options.keys,
              ...options.arguments
            ),
        }
      : {}),
    get: (key) => client.get(key),
    set: (key, value, options = {}) =>
      client.set(
        key,
        value,
        ...(options.EX === undefined ? [] : (['EX', options.EX] as const)),
        ...(options.NX ? (['NX'] as const) : []),
        ...(options.XX ? (['XX'] as const) : [])
      ),
    del: async (keys) => {
      /** Normalized keys; Cluster deletion never issues a cross-slot DEL. */
      const list = Array.isArray(keys) ? keys : [keys];
      if (!list.length) {
        return 0;
      }
      // Redis Cluster rejects cross-slot MGET/MSET/DEL, even for tenant keys.
      if (isCluster) {
        /** Native per-key delete outcomes used to preserve the facade count. */
        const counts = await Promise.all(list.map((key) => client.del(key)));
        return counts.reduce((a, b) => a + b, 0);
      }
      return client.del(...list);
    },
    exists: (key) => client.exists(key),
    mGet: async (keys) => {
      if (!keys.length) {
        return [];
      }
      if (!isCluster) {
        return client.mget(...keys);
      }
      /** Ordered per-key Cluster values gathered in bounded groups. */
      const result: Array<string | null> = [];
      // Keep Cluster reads cross-slot safe with bounded per-key groups.
      for (let i = 0; i < keys.length; i += 32) {
        result.push(
          ...(await Promise.all(
            keys.slice(i, i + 32).map((key) => client.get(key))
          ))
        );
      }
      return result;
    },
    mSet: async (values) => {
      if (!isCluster) {
        return client.mset(values);
      }
      // Cluster-safe, deliberately NON-ATOMIC across keys, like the facade.
      /** Own write entries dispatched separately across Cluster slots. */
      const entries = Object.entries(values);
      // Keep Cluster writes cross-slot safe without implying atomicity.
      for (let i = 0; i < entries.length; i += 32) {
        await Promise.all(
          entries.slice(i, i + 32).map(([key, value]) => client.set(key, value))
        );
      }
    },
    incrBy: (key, n) => client.incrby(key, n),
    decrBy: (key, n) => client.decrby(key, n),
    expire: (key, ttl) => client.expire(key, ttl),
    scanIterator: (options) => ({
      /** Sweep every current primary with cursor scans and no snapshot claim.
       * @returns {AsyncGenerator<string[]>} Native pages consumed by the bounded helper.
       */
      async *[Symbol.asyncIterator]() {
        // A Cluster SCAN through one arbitrary node misses the other shards.
        // Iterate every current primary; this is a best-effort, non-snapshot
        // sweep, and cannot promise deletion of concurrent writes.
        /** Current primary inventory for a non-snapshot namespace sweep. */
        const nodes = isCluster ? client.nodes!('master') : [client];
        if (!Array.isArray(nodes) || !nodes.length) {
          throw new RedisCacheError(
            'REDIS_CLUSTER_MASTERS_UNAVAILABLE',
            'Redis Cluster masters unavailable for namespace scan'
          );
        }
        // Visit every current primary; one arbitrary node cannot cover the whole Cluster.
        for (const node of nodes) {
          let cursor = '0';
          // Advance one primary cursor until completion; the helper caps observed pages.
          do {
            /** Native cursor and page validated before continuing the master scan. */
            const [next, keys] = await node.scan(
              cursor,
              'MATCH',
              options?.MATCH ?? '*',
              'COUNT',
              options?.COUNT ?? 100
            );
            if (typeof next !== 'string' || !Array.isArray(keys)) {
              throw new TypeError('Invalid Redis SCAN response');
            }
            cursor = next;
            yield keys;
          } while (cursor !== '0');
        }
      },
    }),
    // Never expose FLUSHDB on an injected cluster: one shard's FLUSHDB is
    // not a cache-wide operation, and is unsafe for shared tenants anyway.
    ...(isCluster ? {} : { flushDb: () => client.flushdb() }),
    close: () => client.quit(),
    ...(client.disconnect ? { destroy: () => client.disconnect!(false) } : {}),
    on: (event, listener) => client.on(event, listener),
    ...(client.off
      ? {
          off: (event: string, listener: (...args: unknown[]) => void) =>
            client.off!(event, listener),
        }
      : {}),
  };
}

/** The structural type deliberately avoids binding users to a specific ioredis minor version. */
export interface IORedisCompatibleClient {
  /** Execute trusted script text; the wrapper exposes only its fixed limiter strategy.
   * @param {string} script - Trusted server-owned Lua source.
   * @param {number} keyCount - Number of following key arguments.
   * @param {string[]} args - Native command arguments constructed by trusted adapters.
   * @returns {Promise<unknown>} Unvalidated native script reply.
   */
  eval?(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
  /** Read one raw stored string.
   * @param {string} key - Exact native key.
   * @returns {Promise<string|null>} Native value or null.
   */
  get(key: string): Promise<string | null>;
  /** Send one native string write with optional EX/NX/XX.
   * @param {string} key - Exact native key.
   * @param {string} value - Prepared native string body.
   * @param {(string | number)[]} args - Native command arguments constructed by trusted adapters.
   * @returns {Promise<unknown>} Driver reply; callers interpret condition semantics.
   */
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  /** Delete exact native keys.
   * @param {string[]} keys - Exact native key list; Cluster uses per-key operations.
   * @returns {Promise<number>} Native removed count.
   */
  del(...keys: string[]): Promise<number>;
  /** Check native key existence.
   * @param {string} key - Exact native key.
   * @returns {Promise<number>} Native presence count.
   */
  exists(key: string): Promise<number>;
  /** Read native string values in order.
   * @param {string[]} keys - Exact native key list; Cluster uses per-key operations.
   * @returns {Promise<Array<string|null>>} One native value/null per key.
   */
  mget(...keys: string[]): Promise<Array<string | null>>;
  /** Write native strings without implying facade transaction guarantees.
   * @param {Record<string,string>} values - Prepared native strings.
   * @returns {Promise<unknown>} Native reply.
   */
  mset(values: Record<string, string>): Promise<unknown>;
  /** Increment native integer data.
   * @param {string} key - Exact native key.
   * @param {number} amount - Native arithmetic delta.
   * @returns {Promise<number>} Native numeric result, validated by the wrapper.
   */
  incrby(key: string, amount: number): Promise<number>;
  /** Decrement native integer data.
   * @param {string} key - Exact native key.
   * @param {number} amount - Native arithmetic delta.
   * @returns {Promise<number>} Native numeric result, validated by the wrapper.
   */
  decrby(key: string, amount: number): Promise<number>;
  /** Set a native expiry.
   * @param {string} key - Exact native key.
   * @param {number} seconds - Native expiry seconds.
   * @returns {Promise<number>} Driver touch/presence response.
   */
  expire(key: string, seconds: number): Promise<number>;
  /** Read one native cursor page.
   * @param {string} cursor - Native cursor string, starting at zero.
   * @param {(string | number)[]} args - Native command arguments constructed by trusted adapters.
   * @returns {Promise<[string,string[]]>} Next cursor and keys, validated before iteration.
   */
  scan(
    cursor: string,
    ...args: (string | number)[]
  ): Promise<[string, string[]]>;
  /** Read actual current master clients for Cluster-safe scanning.
   * @param {'master'} role - Only current master inventory is requested.
   * @returns {IORedisCompatibleClient[]} Master inventory; empty/invalid inventories reject at scan use.
   */
  nodes?(role: 'master'): IORedisCompatibleClient[];
  /** Optional destructive whole-database flush.
   * @returns {Promise<unknown>} Native reply; wrappers require explicit approval.
   */
  flushdb(): Promise<unknown>;
  /** Close a client only when its owner requests it.
   * @returns {Promise<unknown>} Native close receipt.
   */
  quit(): Promise<unknown>;
  /** Disconnect through the public client API.
   * @param {boolean} reconnect - Optional native reconnect selector; shutdown passes false.
   * @returns {void} Does not cancel arbitrary JavaScript or prove rollback.
   */
  disconnect?(reconnect?: boolean): void;
  /** Remove the exact native listener.
   * @param {string} event - Explicit event name.
   * @param {(...args: unknown[]) => void} listener - Exact retained callback for lifecycle cleanup.
   * @returns {unknown} Driver-defined listener result.
   */
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  /** Register a native error listener with explicit removal ownership.
   * @param {string} event - Explicit event name.
   * @param {(...args: unknown[]) => void} listener - Exact retained callback for lifecycle cleanup.
   * @returns {unknown} Driver-defined listener result.
   */
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}
/** Wrap a configured ioredis client without taking ownership by default.
 * @param {IORedisCompatibleClient} client - Configured host-owned ioredis client.
 * @param {RedisHelperConfig} options - Wrapper policy or native operation options at the structural boundary.
 * @returns {RedisCacheHelper} Closeable helper; actual nodes inventory selects Cluster-safe work.
 */
export function createIORedisCacheHelper(
  client: IORedisCompatibleClient,
  options: RedisHelperConfig = {}
) {
  return createRedisCacheHelper(adaptIORedis(client), {
    ...options,
    cluster: typeof client.nodes === 'function',
  });
}

export interface RedisClusterSettings {
  /** Seed nodes for an actual Redis Cluster (not Sentinel). All must use DB 0. */
  nodes: Array<{
    /** Trusted endpoint host; no request-derived destinations. */
    host: string; /** Explicit valid TCP port. */
    port: number;
  }>;
}
export interface RedisConnectionSettings {
  /** Parsed into host, port, username/password, db and TLS for BullMQ. */
  url?: string;
  /** Cluster mode requires a {hash-tag} BullMQ prefix, and creates two owned Cluster clients. */
  cluster?: RedisClusterSettings;
  /** Trusted endpoint host; no request-derived destinations. */
  host?: string;
  /** Explicit valid TCP port. */
  port?: number;
  /** Private ACL username; never diagnostic metadata. */
  username?: string;
  /** Private native credential; never returned to browsers. */
  password?: string;
  /** Validated standalone Redis database number. */
  db?: number;
  /** Host-owned verified transport options; production qualification stays explicit. */
  tls?: Record<string, unknown>;
  /** Forbidden ioredis prefix: BullMQ owns its own queue prefix; use explicit cluster settings for Cluster. */
  keyPrefix?: never;
}

/** Build independent producer/worker policies without opening connections.
 * @param {RedisConnectionSettings} settings - Trusted standalone or explicit Cluster connection settings.
 * @returns {{producer:Record<string,unknown>,worker:Record<string,unknown>}} Separate native option records; not cache reconnect policy.
 */
export function createBullMQRedisOptions(settings: RedisConnectionSettings): {
  producer: Record<string, unknown>;
  worker: Record<string, unknown>;
} {
  if (settings.cluster !== undefined) {
    throw new TypeError(
      'Use createBullMQRedisClusterConnections for Redis Cluster'
    );
  }
  /** Trusted connection settings checked for forbidden ioredis keyPrefix. */
  const raw = settings as RedisConnectionSettings & { keyPrefix?: string };
  if (raw.keyPrefix !== undefined) {
    throw new TypeError(
      'BullMQ uses its own prefix; ioredis keyPrefix is forbidden'
    );
  }
  /** Separate URL parsing from explicit overrides; BullMQ owns its own prefix. */
  const { url, keyPrefix: _ignored, ...options } = raw;
  let parsed: Record<string, unknown> = {};
  if (url) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new TypeError('Invalid Redis URL');
    }
    if (target.protocol !== 'redis:' && target.protocol !== 'rediss:') {
      throw new TypeError('Redis URL must use redis: or rediss:');
    }
    /** URL database component validated before numeric conversion. */
    const dbString = target.pathname.replace(/^\//, '');
    if (
      dbString &&
      (!/^\d+$/.test(dbString) ||
        !Number.isSafeInteger(Number(dbString)) ||
        Number(dbString) > 2147483647)
    ) {
      throw new TypeError('Invalid Redis database in URL');
    }
    parsed = {
      host: target.hostname || '127.0.0.1',
      port: target.port ? Number(target.port) : 6379,
      ...(target.username
        ? { username: decodeURIComponent(target.username) }
        : {}),
      ...(target.password
        ? { password: decodeURIComponent(target.password) }
        : {}),
      ...(dbString ? { db: Number(dbString) } : {}),
      ...(target.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }
  /** Parsed transport settings followed by explicit host overrides. */
  const shared = { ...parsed, ...options };
  if (
    shared.port !== undefined &&
    (!Number.isSafeInteger(shared.port) ||
      (shared.port as number) < 1 ||
      (shared.port as number) > 65535)
  ) {
    throw new TypeError('Invalid Redis port');
  }
  return {
    producer: { ...shared, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    worker: { ...shared, maxRetriesPerRequest: null, enableOfflineQueue: true },
  };
}

/** Deliberately narrow structural interface for injectable ioredis.Cluster. */
export interface BullMQClusterClient {
  /** Close a client only when its owner requests it.
   * @returns {Promise<unknown>} Native close receipt.
   */
  quit(): Promise<unknown>;
  /** Register a native error listener with explicit removal ownership.
   * @param {string} event - Explicit event name.
   * @param {(...args: unknown[]) => void} listener - Exact retained callback for lifecycle cleanup.
   * @returns {unknown} Driver-defined listener result.
   */
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}
export type BullMQClusterConstructor = new (
  nodes: Array<{
    /** Trusted endpoint host; no request-derived destinations. */
    host: string; /** Explicit valid TCP port. */
    port: number;
  }>,
  options: Record<string, unknown>
) => BullMQClusterClient;

/** Acquire two explicitly owned Cluster connections; rollback producer acquisition if worker creation throws.
 * @param {RedisConnectionSettings} settings - Trusted standalone or explicit Cluster connection settings.
 * @param {BullMQClusterConstructor} Cluster - Explicit supported Cluster constructor; never discovered on disk.
 * @returns {{producer:BullMQClusterClient,worker:BullMQClusterClient}} Queue-service-owned native connections, not shared blocking state.
 */
export function createBullMQRedisClusterConnections(
  settings: RedisConnectionSettings,
  Cluster: BullMQClusterConstructor
) {
  /** Explicit Cluster seed configuration; standalone settings cannot accompany it. */
  const cluster = settings.cluster;
  if (
    !cluster ||
    !Array.isArray(cluster.nodes) ||
    cluster.nodes.length < 1 ||
    cluster.nodes.length > 32
  ) {
    throw new TypeError('Redis Cluster needs 1..32 seed nodes');
  }
  if (
    settings.url !== undefined ||
    settings.host !== undefined ||
    settings.port !== undefined ||
    settings.db !== undefined
  ) {
    throw new TypeError(
      'Redis Cluster cannot specify standalone URL, host, port or DB'
    );
  }
  if (
    (settings as RedisConnectionSettings & { keyPrefix?: unknown })
      .keyPrefix !== undefined
  ) {
    throw new TypeError('BullMQ ioredis keyPrefix is forbidden');
  }
  if (
    settings.tls !== undefined &&
    (typeof settings.tls !== 'object' ||
      settings.tls === null ||
      Array.isArray(settings.tls))
  ) {
    throw new TypeError('Invalid Redis TLS settings');
  }
  /** Validated detached seed addresses, at most 32. */
  const seeds = cluster.nodes.map((node) => {
    if (
      !node ||
      typeof node.host !== 'string' ||
      !/^[a-zA-Z0-9._:-]{1,253}$/.test(node.host) ||
      !Number.isSafeInteger(node.port) ||
      node.port < 1 ||
      node.port > 65535
    ) {
      throw new TypeError('Invalid Redis Cluster seed node');
    }
    return { host: node.host, port: node.port };
  });
  /** Private Cluster authentication/TLS settings, never diagnostic labels. */
  const credentials = {
    ...(settings.username !== undefined ? { username: settings.username } : {}),
    ...(settings.password !== undefined ? { password: settings.password } : {}),
    ...(settings.tls !== undefined ? { tls: settings.tls } : {}),
  };
  /** Owned producer Cluster connection with bounded request retry policy. */
  const producer = new Cluster(seeds, {
    redisOptions: {
      ...credentials,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
    scaleReads: 'master',
  });
  producer.on?.('error', () => undefined); // Connection failures are surfaced by BullMQ readiness/jobs.
  try {
    /** Separately owned blocking-worker Cluster connection with its required retry policy. */
    const worker = new Cluster(seeds, {
      redisOptions: {
        ...credentials,
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
      },
      scaleReads: 'master',
    });
    worker.on?.('error', () => undefined);
    return { producer, worker };
  } catch (error) {
    void producer.quit().catch(() => {});
    throw error;
  }
}
