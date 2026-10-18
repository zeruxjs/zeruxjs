# Redis cache adapters

Share cache data with node-redis, ioredis or an injected Redis Cluster.


## Select the driver

The default adapter uses node-redis. Choose ioredis explicitly when needed. The manager owns a client it creates; injected clients remain caller-owned unless `ownClient: true` is set.

```ts
import { createCacheManager } from '@zeruxjs/cache';
const cache = await createCacheManager({
  helper: '@zeruxjs/cache-redis', prefix: 'shop:catalog',
  options: { url: process.env.REDIS_URL }
});
await cache.set('product:1', { stock: 5 }, { ttlSeconds: 30 });
await cache.close();
```

## Clearing safely

Namespaces are literal, including Redis glob metacharacters. Namespace deletion scans and deletes bounded batches, not a snapshot transaction; writers can repopulate keys while clearing. FLUSHDB is disabled by default. Explicit global clearing belongs only on a dedicated database with a reviewed policy.

## Counters and writes

Redis conditional SET NX/XX and integer operations provide provider-level atomicity for one key. A multi-key cache write is not a cross-key transaction. Do not overwrite an integer counter with an incompatible JSON/string representation and then assume increment still works.

## Cluster and queue integration

Injected ioredis Cluster clients scan master shards and use per-key operations to avoid cross-slot multi-key commands. Cluster FLUSHDB is not available. Use the queue package's Cluster connection helper for BullMQ and never set ioredis keyPrefix for BullMQ connections. Keep cache and queue namespaces distinct.

## Operations

Use TLS/ACL credentials, bounded timeouts and isolated namespaces. Decide whether a cache outage may degrade an application or must block startup. Monitor errors; error listeners avoid unhandled EventEmitter failures but do not make failed reads successful. Close only resources the application owns.


## Public entry points

Manifest reference for `@zeruxjs/cache-redis@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/cache": "0.0.2",
    "redis": "^5.8.3",
    "ioredis": "^5.4.0"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/cache-redis

Redis 5 adapter for `@zeruxjs/cache`. Redis client loading is optional when passing an injected client; normal usage requires the `redis` dependency declared by this package.

```ts
import { createCacheManager } from '@zeruxjs/cache';
const cache = await createCacheManager({
  helper: '@zeruxjs/cache-redis', prefix: 'shop',
  options: {url: 'redis://127.0.0.1:6379'}
});
await cache.set('product:1', {stock: 5}, {ttlSeconds: 30});
await cache.clear(); // SCAN + DEL only keys with literal prefix `shop:`
```

## Operational safety

**`FLUSHDB` is disabled by default.** Without a namespace, `.clear()` rejects rather than destroying unrelated Redis data. Explicitly set `allowFlushDb: true` only when using a dedicated Redis database.

Namespace deletes scan keys and issue bounded DEL batches (not a snapshot transaction); concurrent writes can race with clearing. The prefix is treated literally even if it contains Redis glob metacharacters.

The adapter supports JSON values, `mGet`/`mSet`, key TTLs, Redis atomic integer increments/decrements, conditional `SET NX/XX`, and an injected client. Integer counters share Redis's native integer representation. Writing a string to a counter key and then incrementing it raises a Redis error.

```ts
import { createRedisCacheHelper } from '@zeruxjs/cache-redis';
const helper = createRedisCacheHelper(existingRedisClient, {allowFlushDb:false});
```

Injected clients are **not** closed by default (`ownClient: true` opts in). The factory opens and owns a client only when it creates one. For production, use Redis TLS/ACLs, timeouts, dedicated credentials, and secure network access.

## ioredis and BullMQ integration (Section 52)

The default remains `redis` (node-redis). Select `{driver:'ioredis'}` for ioredis v5, or inject an existing ioredis instance. Injected clients remain caller-owned unless `ownClient:true`.

```ts
import {createCacheHelper, createBullMQRedisOptions} from '@zeruxjs/cache-redis';
const cache=await createCacheHelper({driver:'ioredis',url:process.env.REDIS_URL});
const {producer,worker}=createBullMQRedisOptions({url:process.env.REDIS_URL});
// BullMQ manages its connections separately; the queue uses these option policies.
```

The ioredis adapter translates its lowercase `mget`, `mset`, `incrby`, `scan`, and `quit` commands. It preserves the existing safe cache namespace clearing and the default `FLUSHDB` prohibition. **Do not use ioredis keyPrefix in BullMQ connections.** Separate cache prefixes (`cache`) from BullMQ prefixes (`bull`). Unhandled Redis errors can take down Node processes; both factories register Redis error listeners, while the queue's worker error hook is optional. Existing `redis` driver users do not need to migrate.

## Section 75 — shared Redis Cluster and tenant isolation

`createIORedisCacheHelper(clusterClient, {ownClient:false})` accepts an already configured ioredis Cluster client. It scans each **master shard** when clearing a literal namespace. Keys are verified against `namespace + ':'` even if SCAN returns overmatching keys, and deletes are one key at a time (no cross-slot `DEL`). `getMany`/`setMany` on an injected Cluster use per-key operations; **multi-key updates are not atomic across slots**. Standalone Redis behavior is unchanged. A cluster's `FLUSHDB` is deliberately unavailable even if `allowFlushDb:true`; always use application-prefix clearing. This is a non-snapshot sweep: callers must quiesce writers to guarantee the namespace remains empty. Redis ACLs and credential-bound tenant isolation remain deployment responsibilities.

For BullMQ Redis Cluster, use `createBullMQRedisClusterConnections` indirectly through `@zeruxjs/queue` as described in its README; the standalone `createBullMQRedisOptions()` intentionally rejects cluster configuration. Always use dedicated test Redis servers and different prefixes per tenant. **No live Redis/Cluster certification is claimed until the opt-in integration tests are run.**

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/cache-redis/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/cache-redis/README.md)
- [packages/@zeruxjs/cache-redis/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/cache-redis/package.json)
