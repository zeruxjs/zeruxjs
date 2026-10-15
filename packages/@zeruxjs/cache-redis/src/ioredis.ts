import type { RedisCacheClient } from './types.js';
import { createRedisCacheHelper, type RedisHelperConfig } from './helper.js';

/** Bridge ioredis's lowercase command API to the existing cache adapter contract. */
export function adaptIORedis(client: IORedisCompatibleClient): RedisCacheClient {
  return {
    get: key => client.get(key),
    set: (key, value, options = {}) => client.set(key, value, ...(options.EX === undefined ? [] : ['EX', options.EX] as const), ...(options.NX ? ['NX'] as const : []), ...(options.XX ? ['XX'] as const : [])),
    del: keys => Array.isArray(keys) ? keys.length ? client.del(...keys) : Promise.resolve(0) : client.del(keys),
    exists: key => client.exists(key),
    mGet: keys => keys.length ? client.mget(...keys) : Promise.resolve([]),
    mSet: values => client.mset(values),
    incrBy: (key, n) => client.incrby(key, n),
    decrBy: (key, n) => client.decrby(key, n),
    expire: (key, ttl) => client.expire(key, ttl),
    scanIterator: options => ({
      async *[Symbol.asyncIterator]() {
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', options?.MATCH ?? '*', 'COUNT', options?.COUNT ?? 100);
          cursor = next;
          yield keys;
        } while (cursor !== '0');
      }
    }),
    flushDb: () => client.flushdb(),
    close: () => client.quit(),
    on: (event, listener) => client.on(event, listener),
  };
}

/** The structural type deliberately avoids binding users to a specific ioredis minor version. */
export interface IORedisCompatibleClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(key: string): Promise<number>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  mset(values: Record<string, string>): Promise<unknown>;
  incrby(key: string, amount: number): Promise<number>;
  decrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  flushdb(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}
export function createIORedisCacheHelper(client: IORedisCompatibleClient, options: RedisHelperConfig = {}) {
  return createRedisCacheHelper(adaptIORedis(client), options);
}

export interface RedisConnectionSettings {
  /** Parsed into host, port, username/password, db and TLS for BullMQ. */
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, unknown>;
  /** Set to true to intentionally use a Redis Cluster connection; unsupported by this connection factory. */
  keyPrefix?: never;
}

/** Independent producer/worker options, not a shared blocking connection. */
export function createBullMQRedisOptions(settings: RedisConnectionSettings): {
  producer: Record<string, unknown>; worker: Record<string, unknown>;
} {
  const raw = settings as RedisConnectionSettings & { keyPrefix?: string };
  if (raw.keyPrefix !== undefined) throw new TypeError('BullMQ uses its own prefix; ioredis keyPrefix is forbidden');
  const {url, keyPrefix: _ignored, ...options} = raw;
  let parsed: Record<string, unknown> = {};
  if (url) {
    let target: URL;
    try { target = new URL(url); } catch { throw new TypeError('Invalid Redis URL'); }
    if (target.protocol !== 'redis:' && target.protocol !== 'rediss:') throw new TypeError('Redis URL must use redis: or rediss:');
    const dbString = target.pathname.replace(/^\//, '');
    if (dbString && (!/^\d+$/.test(dbString) || !Number.isSafeInteger(Number(dbString)) || Number(dbString) > 2147483647)) throw new TypeError('Invalid Redis database in URL');
    parsed = {host:target.hostname || '127.0.0.1',port:target.port ? Number(target.port) : 6379,
      ...(target.username ? {username:decodeURIComponent(target.username)} : {}),
      ...(target.password ? {password:decodeURIComponent(target.password)} : {}),
      ...(dbString ? {db:Number(dbString)} : {}),
      ...(target.protocol === 'rediss:' ? {tls:{}} : {})};
  }
  const shared = {...parsed,...options};
  if (shared.port !== undefined && (!Number.isSafeInteger(shared.port) || (shared.port as number) < 1 || (shared.port as number) > 65535)) throw new TypeError('Invalid Redis port');
  return {
    producer:{...shared, maxRetriesPerRequest:1, enableOfflineQueue:false},
    worker:{...shared,maxRetriesPerRequest:null,enableOfflineQueue:true}
  };
}
