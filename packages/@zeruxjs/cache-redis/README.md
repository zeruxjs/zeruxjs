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
