# @zeruxjs/cache-redis

Redis 5 adapter for `@zeruxjs/cache`. Redis client loading is optional when passing an injected client; normal usage requires the `redis` dependency declared by this package.

```ts
import { createCacheManager } from '@zeruxjs/cache';
const cache = await createCacheManager({
  helper: '@zeruxjs/cache-redis', prefix: 'shop',
  options: {url: 'redis://127.0.0.1:6379'}
});
try {
  await cache.set('product:1', {stock: 5}, {ttlSeconds: 30});
  await cache.clear(); // SCAN + DEL only keys with literal prefix `shop:`
} finally { await cache.close(); }
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

## Ioredis and BullMQ integration

The default remains `redis` (node-redis). Select `{driver:'ioredis'}` for ioredis v5, or inject an existing ioredis instance. Injected clients remain caller-owned unless `ownClient:true`.

```ts
import {createCacheHelper, createBullMQRedisOptions} from '@zeruxjs/cache-redis';
const cache=await createCacheHelper({driver:'ioredis',url:process.env.REDIS_URL});
const {producer,worker}=createBullMQRedisOptions({url:process.env.REDIS_URL});
// BullMQ manages its connections separately; the queue uses these option policies.
```

The ioredis adapter translates its lowercase `mget`, `mset`, `incrby`, `scan`, and `quit` commands. It preserves the existing safe cache namespace clearing and the default `FLUSHDB` prohibition. **Do not use ioredis keyPrefix in BullMQ connections.** Separate cache prefixes (`cache`) from BullMQ prefixes (`bull`). Unhandled Redis errors can take down Node processes; both factories register Redis error listeners, while the queue's worker error hook is optional. Existing `redis` driver users do not need to migrate.

## Shared Redis Cluster and tenant isolation

`createIORedisCacheHelper(clusterClient, {ownClient:false})` accepts an already configured ioredis Cluster client. It scans each **master shard** when clearing a literal namespace. Keys are verified against `namespace + ':'` even if SCAN returns overmatching keys, and deletes are one key at a time (no cross-slot `DEL`). `getMany`/`setMany` on an injected Cluster use per-key operations; **multi-key updates are not atomic across slots**. Standalone Redis behavior is unchanged. A cluster's `FLUSHDB` is deliberately unavailable even if `allowFlushDb:true`; always use application-prefix clearing. This is a non-snapshot sweep: callers must quiesce writers to guarantee the namespace remains empty. Redis ACLs and credential-bound tenant isolation remain deployment responsibilities.

For BullMQ Redis Cluster, use `createBullMQRedisClusterConnections` indirectly through `@zeruxjs/queue` as described in its README; the standalone `createBullMQRedisOptions()` intentionally rejects cluster configuration. Always use dedicated test Redis servers and different prefixes per tenant. **No live Redis/Cluster certification is claimed until the opt-in integration tests are run.**

## Scoped diagnostics and command ownership

```ts
import {createRedisCacheHelper, type RedisCacheClient,
  type RedisOperationRecord} from '@zeruxjs/cache-redis';

export async function example(client: RedisCacheClient, signal?: AbortSignal) {
  const observations: RedisOperationRecord[] = [];
  const helper = createRedisCacheHelper(client, {ownClient: false,
    commandTimeoutMs: 1000, maxPendingCommands: 8,
    onOperation(record) { if (observations.length < 20) observations.push(record); }});
  try {
    await helper.set('shop:product', {stock: 5}, {ttlSeconds: 30, signal});
    return await helper.get('shop:product', {signal, deadline: Date.now() + 1000});
  } finally { await helper.close(); } // borrowed client stays open
}
```

Bind prefixes/credentials from trusted application/tenant configuration. Prefixes are not authorization. Manager APIs from @zeruxjs/cache negotiate this helper's supported conditions/counters/namespace clear and unsupported overall bulk atomicity; ownership describes the backend. Void set still does not report a condition miss. No telemetry or connection starts merely on import.

### Bounded cache connection policy

Factory/direct-helper policy fields are package-owned: commandTimeoutMs defaults to 3000 (1–120000), connectTimeoutMs 3000 (1–120000), shutdownTimeoutMs 5000 (1–120000), maxPendingCommands 64 (1–1024), maxReconnectAttempts 0 (0–3), maxScanPages 10000 (1–100000). The factory bounds connection wait and uses the same settings for either driver. Factory-created node-redis disables its offline queue and bounds commandsQueueMaxLength; factory-created ioredis disables its offline queue and automatic resend of unfulfilled commands, with maxRetriesPerRequest zero. Both use capped cache reconnect strategies. These policies never change BullMQ producer/worker defaults, whose worker connections intentionally have different retry/offline requirements.

For owned cache clients, critical native retry/offline overrides reject instead of silently enabling replay; use the package policy fields. Cache keyPrefix/cluster connection settings reject in the standalone factory. Injected ioredis Cluster remains supported through its actual nodes('master') inventory, never inferred from one endpoint. Borrowed clients retain host-owned reconnect, offline queue, TLS and routing settings: configure them compatibly, since a wrapper cannot repair an already configured driver's native replay. The wrapper itself never retries a command. Insecure explicit TLS certificate verification flags reject for owned factory connections; real TLS/ACL acceptance still requires configured infrastructure.

### Deadlines, close and unknown outcomes

Direct get/set and conditional setMany accept signal/deadline options. Other helper/facade methods use commandTimeoutMs and close cancellation. A deadline or caller abort stops waiting and prevents subsequent batch/scan submissions, but does not prove that a native command was cancelled. Writes can have an unknown outcome, exposed through error.details.writeOutcome. Native work retains admission capacity until settlement, even after the caller sees REDIS_COMMAND_DEADLINE. Every command in an issued batch settles before its batch slot is released, including siblings of a failed command. An injected driver that never settles can hold that capacity indefinitely; no arbitrary Promise is forcibly cancelled.

Direct helper.close() immediately rejects stale helper/manager dispatch and cancels current caller waits. It drains native operations and closes only owned clients once. Borrowed clients remain open, including when shutdownTimeoutMs expires; the close Promise then rejects with REDIS_SHUTDOWN_DEADLINE while eventual cleanup continues. Owned clients may be destroyed at the shutdown deadline through public destroy/disconnect APIs. Already-issued writes can still complete and are not rolled back. Closing a helper shared by managers invalidates all of their future methods; use separate wrappers around a borrowed client for independently owned generations. Previously obtained native handles are privileged host-owned escape hatches outside wrapper guarantees.

### Redacted hooks and numeric/JSON limits

onOperation receives a fixed operation name, elapsed duration, fixed outcome/error code and optional unknown-write marker. It never receives a key, prefix, tenant label, URL, credentials, payload, native error or cause. Validation before dispatch does not emit a command event. Records are frozen. Synchronous throws and asynchronous rejections are isolated from command success, counted by getDiagnostics(). At most 16 asynchronous hooks are pending; further hook records drop rather than queue. Diagnostic counters include pending operations, pending/dropped/failed hooks and path-free backend error events. The host owns hook/exporter cancellation; close does not await uncooperative user hooks. Client error listeners are registered/removable only when the injected client supports both lifecycle methods.

Cache misses are exclusively native null values. Backend/ACL/network errors reject as REDIS_BACKEND_ERROR with a private cause; JSON errors and unsafe counters reject distinctly. Never serialize private causes or native handles to clients. Redis integer commands use signed 64-bit backend arithmetic; the helper's number API rejects results outside JS safe integers after a possible mutation, without replay/rollback. JSON numbers keep JS precision semantics; scalar unsafe integers reject on write/read because they also represent native counters. Strings remain JSON-quoted strings and cannot be incremented as counters. Nested high-precision application values should be stored explicitly as strings.

Direct keys are 1–1024 UTF-8 bytes, bulks at most 1000 keys, serialized values at most 1 MiB and plain JSON traversal depth 32/100000 nodes. Getters, toJSON, cycles, sparse arrays and nonfinite values reject; these tighten previously unchecked direct helper input. Manager limits may be stricter. TTL rounding/NX/XX and normal standalone MGET/MSET semantics remain unchanged. Cluster bulks use per-key batches of at most 32, never cross-slot MGET/MSET/DEL. Literal-prefix clearing is a bounded non-snapshot master sweep; it can partially complete or race with writers. No lock or distributed atomicity is synthesized.

See official [node-redis connections](https://redis.io/docs/latest/develop/clients/nodejs/connect/), [ioredis reconnect/resend policy](https://github.com/redis/ioredis#auto-reconnect) and [Redis integer semantics](https://redis.io/docs/latest/commands/incr/). Live fixtures require dedicated CACHE_REDIS_URL and/or CACHE_REDIS_CLUSTER_NODES. Additional explicit prerequisites are CACHE_REDIS_OUTAGE_URL (intentionally unavailable endpoint), CACHE_REDIS_ACL_URL (credentials denied GET), and CACHE_REDIS_TLS_URL (rediss endpoint plus trusted CA setup). No services, credentials or certificates are fabricated and no application is started/stopped. Offline fixtures do not certify outages/failover, ACL/TLS or Cluster behavior.

## Atomic security limiter store

createRedisRateLimitStore(helper, {namespace, maxKeys, maxWindowMs, ownHelper}) implements the security-owned AtomicRateLimitStore contract using a fixed bounded EVAL script, never cache get/set. It requires a real eval-capable client (including the ioredis bridge); unsupported clients reject before advertising a distributed store. Claims use the existing command deadline/capacity/hooks under the fixed rateLimit operation label. Only bounded opaque HMAC subjects from the security limiter are accepted; no arbitrary script text is exposed by this method.

The hash/expiry index use one explicit {namespace} Cluster slot. Redis TIME owns timestamps, at most 128 expired fields are pruned per claim and maxKeys is a hard live-cardinality cap. TTL maxWindowMs must cover every claim window. Incomplete/wrong-type state rejects; do not use cache namespace clearing or flush on these keys. Configure noeviction, scripting ACLs and persistence/failover deliberately: losing both keys resets quota and is not prevented by atomic Lua. This is one-slot fixed-window accounting, not a token bucket, distributed concurrency semaphore or cross-slot transaction.

Store close invalidates future claims; ownHelper defaults false. The helper continues to own/drain native commands, with unknown write outcomes on deadlines and no automatic replay. Use the security package's application-scoped limiter example for fail-open/closed policy, verified tenant/subject derivation and safe 429/Retry-After responses. Build security before cache-redis when compiling this workspace. The new exact @zeruxjs/security dependency supplies the public contract; its code does not start telemetry or Redis connections.

Live multi-client/TTL checks require an isolated CACHE_RATE_LIMIT_REDIS_URL. Native Lua execution and distribution are not established by script-shape/mocked-client checks.

## Implementation and ownership map

- `src/index.ts` owns explicit driver selection, startup budgets and failure cleanup. `src/policy.ts` owns package limits, fixed diagnostic records and public errors.
- `src/helper.ts` owns accepted native work, caller cancellation, bounded hooks, literal-prefix scanning and drain. `src/codec.ts` owns inert JSON, safe integer/TTL validation and glob escaping.
- `src/ioredis.ts` translates structural commands, scans actual Cluster masters and separately creates BullMQ producer/worker options or owned Cluster connections. The option builder opens no connection; the Cluster factory returns two native owners requiring quit.
- `src/rate-limit.ts` owns the optional security-store facade; `src/limiter-script.ts` holds the fixed two-key Lua strategy. Script text and claimed scope do not prove persistence/failover acceptance.

The root runtime is Node-only. Credentials and injected-driver transport policy belong to trusted server configuration. A borrowed client may have its own replay/offline policy: the wrapper cannot repair that configuration, and unknown native writes are never retried by the wrapper. Prefixing alone grants no tenant authorization. Internal errors use fixed code-derived messages, but the public RedisCacheError constructor accepts host messages; hosts must redact those and keep causes private.

Offline fixtures exercise both driver factories, borrowed ownership, late native settlement, atomic-store argument validation and synthetic multi-primary routing. Live Redis, Cluster, Lua atomicity, ACLs and TLS require the separately configured dedicated acceptance endpoints.
