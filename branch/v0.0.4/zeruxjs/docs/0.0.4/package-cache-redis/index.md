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

## Install and select the integration

```sh
npm install @zeruxjs/cache-redis@0.0.4
```

This package participates in the runtime's **cache** integration. Start with [cache configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-cache.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Select this adapter through cache.connector in runtime setup or helper in createCacheManager. The normal driver is node-redis; options.driver can select ioredis. When injecting an existing client, state ownership explicitly so another subsystem does not lose its connection during cache shutdown. Use a distinct literal namespace for each application/tenant boundary.

## TypeScript: inputs, results and ownership

```ts
import { createCacheHelper } from '@zeruxjs/cache-redis';

type Inputs = Parameters<typeof createCacheHelper>;
type Result = Awaited<ReturnType<typeof createCacheHelper>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createCacheHelper>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Without a namespace, clear rejects unless destructive FLUSHDB was explicitly allowed for a dedicated standalone database. Cluster namespace clearing scans master shards and deletes keys individually; it is not a snapshot transaction and multi-key writes are not cross-slot atomic. Keep BullMQ prefixing separate from ioredis keyPrefix. Verify real Redis TLS/ACL, reconnect, timeouts and ownership behavior.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### RedisCacheHelperOptions

| Field          | Accepted type/value | Optional |
| -------------- | ------------------- | -------- |
| `client`       | `RedisCacheClient`  | Yes      |
| `allowFlushDb` | `boolean`           | Yes      |
| `ownClient`    | `boolean`           | Yes      |

### RedisConnectionSettings

| Field       | Accepted type/value       | Optional |
| ----------- | ------------------------- | -------- |
| `url`       | `string`                  | Yes      |
| `cluster`   | `RedisClusterSettings`    | Yes      |
| `host`      | `string`                  | Yes      |
| `port`      | `number`                  | Yes      |
| `username`  | `string`                  | Yes      |
| `password`  | `string`                  | Yes      |
| `db`        | `number`                  | Yes      |
| `tls`       | `Record<string, unknown>` | Yes      |
| `keyPrefix` | `never`                   | Yes      |

### RedisClusterSettings

| Field   | Accepted type/value                | Optional |
| ------- | ---------------------------------- | -------- |
| `nodes` | `Array<{host:string;port:number}>` | No       |

## Scoped cache command policy and diagnostics

Both cache factories use bounded command/connect/shutdown waits, pending capacity and cache reconnect attempts; offline queues/resending are disabled on owned cache clients. BullMQ producer/worker settings remain separate. Borrowed driver-native retry/TLS/routing behavior stays host-owned. Critical owned cache retry/offline overrides reject; use the package-owned RedisCachePolicy fields. No command is transparently replayed by the wrapper.

Deadlines reject caller waits with unknown write outcomes when appropriate, retain native capacity until settlement and stop future scan/batch phases. Close invalidates stale helper/manager methods, drains accepted commands and closes only owned clients. A borrowed uncooperative driver can exceed the shutdown deadline; it is never forcibly closed. Async hook capacity is 16, with fixed operation/outcome/code labels and no key, prefix, URL, tenant or payload. Hook exceptions do not change cache success. getDiagnostics exposes path-free counts.

RedisHelperConfig and RedisSetOptions remain owned by this package. The helper advertises supported conditions/counters/literal namespace clear and unsupported overall bulk atomicity. Counter numbers outside JS safe integers reject after potential mutation; JSON strings remain distinct from native numeric counters. Direct JSON/key/bulk boundaries are bounded, and actual ioredis Cluster masters use per-key batches instead of cross-slot assumptions. See the package README for exact defaults, lifecycle/migration limits and a packed public-import example.

Live acceptance needs dedicated CACHE_REDIS_URL / CACHE_REDIS_CLUSTER_NODES, plus explicit outage/ACL/TLS endpoints through CACHE_REDIS_OUTAGE_URL, CACHE_REDIS_ACL_URL and CACHE_REDIS_TLS_URL. TLS requires trusted CA setup; ACL requires a host-configured denied identity. Tests never create credentials or restart services, and offline fixtures do not establish live failover/security acceptance.

## Source and cleanup boundaries

The factory owns startup and explicit driver loading; the scoped helper owns caller waits and native-settlement capacity. The codec validates inert JSON, while the ioredis bridge owns lowercase translation and actual master inventory. BullMQ options are inert; its Cluster factory acquires two separate native connections. The limiter store uses only the fixed Lua strategy and borrows its helper by default. Root runtime imports stay server-side.

Close wrappers even for injected clients to remove listeners and drain accepted work. Borrowed native connections remain host-owned. Code-derived internal messages are redacted; host-created public error messages and private causes still require host review. Local fixture success is not live Redis/Cluster/TLS or durable quota certification.


## Public entry points

Manifest reference for `@zeruxjs/cache-redis@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/cache": "0.0.4",
    "@zeruxjs/security": "0.0.4",
    "ioredis": "^5.4.0",
    "redis": "^5.8.3"
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
try {
  await cache.set('product:1', {stock: 5}, {ttlSeconds: 30});
  await cache.clear(); // SCAN + DEL only keys with literal prefix `shop:`
} finally { await cache.close(); }
```

## Operational safety

**`FLUSHDB` is disabled by default.** Without a namespace, `.clear()` rejects rather than destroying unrelated Redis data. Explicitly set `allowFlushDb: true` only when using a dedicated Redis database.

Namespace deletes scan keys and issue bounded DEL batches (not a snapshot transaction); concurrent writes can race with clearing. The prefix is treated literally even if it contains Redis glob metacharacters.

The adapter supports JSON values, `mGet`/branch/v0.0.4/`mSet`, key TTLs, Redis atomic integer increments/decrements, conditional `SET NX/XX`, and an injected client. Integer counters share Redis's native integer representation. Writing a string to a counter key and then incrementing it raises a Redis error.

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

`createIORedisCacheHelper(clusterClient, {ownClient:false})` accepts an already configured ioredis Cluster client. It scans each **master shard** when clearing a literal namespace. Keys are verified against `namespace + ':'` even if SCAN returns overmatching keys, and deletes are one key at a time (no cross-slot `DEL`). `getMany`/branch/v0.0.4/`setMany` on an injected Cluster use per-key operations; **multi-key updates are not atomic across slots**. Standalone Redis behavior is unchanged. A cluster's `FLUSHDB` is deliberately unavailable even if `allowFlushDb:true`; always use application-prefix clearing. This is a non-snapshot sweep: callers must quiesce writers to guarantee the namespace remains empty. Redis ACLs and credential-bound tenant isolation remain deployment responsibilities.

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


## Implementation sources

- [packages/@zeruxjs/cache-redis/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-redis/README.md)
- [packages/@zeruxjs/cache-redis/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-redis/package.json)
