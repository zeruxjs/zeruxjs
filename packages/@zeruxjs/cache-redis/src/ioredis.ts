import type { RedisCacheClient } from './types.js';
import { createRedisCacheHelper, type RedisHelperConfig } from './helper.js';

/** Bridge ioredis's lowercase command API to the existing cache adapter contract. */
export function adaptIORedis(client: IORedisCompatibleClient): RedisCacheClient {
  const isCluster = typeof client.nodes === 'function';
  return {
    get: key => client.get(key),
    set: (key, value, options = {}) => client.set(key, value, ...(options.EX === undefined ? [] : ['EX', options.EX] as const), ...(options.NX ? ['NX'] as const : []), ...(options.XX ? ['XX'] as const : [])),
    del: async keys => {
      const list = Array.isArray(keys) ? keys : [keys];
      if (!list.length) return 0;
      // Redis Cluster rejects cross-slot MGET/MSET/DEL, even for tenant keys.
      if (isCluster) {
        const counts = await Promise.all(list.map(key => client.del(key)));
        return counts.reduce((a,b) => a+b, 0);
      }
      return client.del(...list);
    },
    exists: key => client.exists(key),
    mGet: keys => !keys.length ? Promise.resolve([]) : isCluster ? Promise.all(keys.map(key => client.get(key))) : client.mget(...keys),
    mSet: async values => {
      if (!isCluster) return client.mset(values);
      // Cluster-safe, deliberately NON-ATOMIC across keys, like the facade.
      await Promise.all(Object.entries(values).map(([key,value]) => client.set(key,value)));
    },
    incrBy: (key, n) => client.incrby(key, n),
    decrBy: (key, n) => client.decrby(key, n),
    expire: (key, ttl) => client.expire(key, ttl),
    scanIterator: options => ({
      async *[Symbol.asyncIterator]() {
        // A Cluster SCAN through one arbitrary node misses the other shards.
        // Iterate every current primary; this is a best-effort, non-snapshot
        // sweep, and cannot promise deletion of concurrent writes.
        const nodes = isCluster ? client.nodes!('master') : [client];
        if (!Array.isArray(nodes) || !nodes.length) throw new Error('Redis Cluster masters unavailable for namespace scan');
        for (const node of nodes) {
          let cursor = '0';
          do {
            const [next, keys] = await node.scan(cursor, 'MATCH', options?.MATCH ?? '*', 'COUNT', options?.COUNT ?? 100);
            if (typeof next !== 'string' || !Array.isArray(keys)) throw new TypeError('Invalid Redis SCAN response');
            cursor = next;
            yield keys;
          } while (cursor !== '0');
        }
      }
    }),
    // Never expose FLUSHDB on an injected cluster: one shard's FLUSHDB is
    // not a cache-wide operation, and is unsafe for shared tenants anyway.
    ...(isCluster ? {} : {flushDb: () => client.flushdb()}),
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
  /** Optional ioredis Cluster surface. Every master is scanned independently. */
  nodes?(role: 'master'): IORedisCompatibleClient[];
  flushdb(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}
export function createIORedisCacheHelper(client: IORedisCompatibleClient, options: RedisHelperConfig = {}) {
  return createRedisCacheHelper(adaptIORedis(client), options);
}

export interface RedisClusterSettings {
  /** Seed nodes for an actual Redis Cluster (not Sentinel). All must use DB 0. */
  nodes: Array<{host:string;port:number}>;
}
export interface RedisConnectionSettings {
  /** Parsed into host, port, username/password, db and TLS for BullMQ. */
  url?: string;
  /** Cluster mode requires a {hash-tag} BullMQ prefix, and creates two owned Cluster clients. */
  cluster?: RedisClusterSettings;
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
  if (settings.cluster !== undefined) throw new TypeError('Use createBullMQRedisClusterConnections for Redis Cluster');
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

/** Deliberately narrow structural interface for injectable ioredis.Cluster. */
export interface BullMQClusterClient {
  quit():Promise<unknown>;
  on?(event:string,listener:(...args:unknown[])=>void):unknown;
}
export type BullMQClusterConstructor = new (
  nodes:Array<{host:string;port:number}>, options:Record<string,unknown>
)=>BullMQClusterClient;

/**
 * Real Redis Cluster connections, supplied directly to BullMQ rather than
 * pretending a Cluster can be represented by standalone host/port settings.
 * Use an identical hash-tagged BullMQ prefix, e.g. `{tenant-a}`, on all workers.
 * Connections are owned by the Queue service, not by queue/worker objects.
 */
export function createBullMQRedisClusterConnections(settings:RedisConnectionSettings, Cluster:BullMQClusterConstructor) {
  const cluster=settings.cluster;
  if (!cluster || !Array.isArray(cluster.nodes) || cluster.nodes.length<1 || cluster.nodes.length>32)
    throw new TypeError('Redis Cluster needs 1..32 seed nodes');
  if (settings.url!==undefined || settings.host!==undefined || settings.port!==undefined || settings.db!==undefined)
    throw new TypeError('Redis Cluster cannot specify standalone URL, host, port or DB');
  if ((settings as RedisConnectionSettings & {keyPrefix?:unknown}).keyPrefix!==undefined)
    throw new TypeError('BullMQ ioredis keyPrefix is forbidden');
  if (settings.tls!==undefined && (typeof settings.tls!=='object'||settings.tls===null||Array.isArray(settings.tls)))
    throw new TypeError('Invalid Redis TLS settings');
  const seeds=cluster.nodes.map(node=>{
    if (!node || typeof node.host!=='string' || !/^[a-zA-Z0-9._:-]{1,253}$/.test(node.host) ||
        !Number.isSafeInteger(node.port) || node.port<1 || node.port>65535)
      throw new TypeError('Invalid Redis Cluster seed node');
    return {host:node.host,port:node.port};
  });
  const credentials={
    ...(settings.username!==undefined?{username:settings.username}:{}),
    ...(settings.password!==undefined?{password:settings.password}:{}),
    ...(settings.tls!==undefined?{tls:settings.tls}:{})
  };
  const producer=new Cluster(seeds,{redisOptions:{...credentials,maxRetriesPerRequest:1,enableOfflineQueue:false},scaleReads:'master'});
  producer.on?.('error',()=>undefined); // Connection failures are surfaced by BullMQ readiness/jobs.
  try {
    const worker=new Cluster(seeds,{redisOptions:{...credentials,maxRetriesPerRequest:null,enableOfflineQueue:true},scaleReads:'master'});
    worker.on?.('error',()=>undefined);
    return {producer,worker};
  } catch(error){void producer.quit().catch(()=>{});throw error;}
}
