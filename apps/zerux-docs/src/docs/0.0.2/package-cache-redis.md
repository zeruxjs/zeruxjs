---
{
  "title": "Redis cache adapters",
  "description": "Share cache data with node-redis, ioredis or an injected Redis Cluster.",
  "section": "Packages",
  "order": 1,
  "sources": [
    "packages/@zeruxjs/cache-redis/README.md",
    "packages/@zeruxjs/cache-redis/package.json"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/cache-redis"
}
---

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
npm install @zeruxjs/cache-redis@0.0.2
```

This package participates in the runtime's **cache** integration. Start with [cache configuration](configuration-cache.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Select this adapter through cache.connector in runtime setup or helper in createCacheManager. The normal driver is node-redis; options.driver can select ioredis. When injecting an existing client, state ownership explicitly so another subsystem does not lose its connection during cache shutdown. Use a distinct literal namespace for each application/tenant boundary.

## TypeScript: inputs, results and ownership

```ts
import { createCacheHelper } from '@zeruxjs/cache-redis';

type Inputs = Parameters<typeof createCacheHelper>;
type Result = Awaited<ReturnType<typeof createCacheHelper>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createCacheHelper>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `client` | `RedisCacheClient` | Yes |
| `allowFlushDb` | `boolean` | Yes |
| `ownClient` | `boolean` | Yes |

### RedisConnectionSettings

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `url` | `string` | Yes |
| `cluster` | `RedisClusterSettings` | Yes |
| `host` | `string` | Yes |
| `port` | `number` | Yes |
| `username` | `string` | Yes |
| `password` | `string` | Yes |
| `db` | `number` | Yes |
| `tls` | `Record<string, unknown>` | Yes |
| `keyPrefix` | `never` | Yes |

### RedisClusterSettings

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `nodes` | `Array<{host:string;port:number}>` | No |
