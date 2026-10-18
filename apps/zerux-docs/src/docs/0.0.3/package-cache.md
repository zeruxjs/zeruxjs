---
{
  "title": "Application caching",
  "description": "Cache JSON data with explicit namespaces, TTLs and ownership.",
  "section": "Packages",
  "order": 0,
  "sources": [
    "packages/@zeruxjs/cache/README.md",
    "packages/@zeruxjs/cache/package.json"
  ],
  "related": [
    "cache-invalidation",
    "package-cache-redis",
    "cache-streams"
  ],
  "package": "@zeruxjs/cache"
}
---

## When to use it

Use the manager when application code should not depend on a particular cache adapter. The bounded memory provider is useful for process-local acceleration; Redis is the option when multiple processes need a shared backend. Neither choice changes HTTP cache headers automatically.

## Create a manager

```ts
import { createCacheManager } from '@zeruxjs/cache';
const cache = await createCacheManager({
  helper: 'memory', prefix: 'catalog:v1', defaultTtlSeconds: 60,
  options: { maxEntries: 2000 }
});
try {
  await cache.set('product:42', { name: 'Notebook' }, { ttlSeconds: 30 });
  const product = await cache.get('product:42');
} finally {
  await cache.close();
}
```

Logical keys are unprefixed at the call site. Values are JSON-serializable; a missing key returns undefined. TTLs must be finite and positive. Defensive copying prevents callers from mutating the stored memory value accidentally.

## Load-through and concurrent misses

`remember(key, producer, options)` coalesces concurrent misses inside the same manager process. A failed producer is not cached. This does not acquire a distributed Redis lock, so two application replicas can still perform the same producer work.

## API choices

| API | Behavior |
| --- | --- |
| `get`, `set`, `delete`, `has` | Single logical key |
| `getMany`, `setMany`, `deleteMany` | Bulk operations; not necessarily atomic |
| `increment`, `decrement` | Nonnegative safe-integer amounts |
| `touch` | Refresh a positive TTL |
| `clear` | Clear a namespace, or provider-wide clear when unprefixed |
| `remember` | Process-local load coalescing |
| `native` | Trusted provider-specific access |
| `close` | Release owned resources |

## Invalidation and safety

Include tenant and data-version boundaries in keys. Do not include secrets or raw personal information. A prefixed clear fails closed when the adapter cannot clear that literal namespace. Avoid unprefixed clear on shared infrastructure. Use database transactions for authoritative writes, then invalidate affected cache entries; cache storage is not a transaction journal.

## Install and select the integration

```sh
npm install @zeruxjs/cache@0.0.3
```

This package participates in the runtime's **cache** integration. Start with [cache configuration](configuration-cache.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Use connector in framework config and helper in the standalone manager. Choose memory for process-local development or install the Redis adapter for shared infrastructure. Set a prefix and freshness policy before inserting entries. Preserve the distinction between a missing value and cached null. Use remember for bounded load coalescing in the same process, not as a distributed lock.

## TypeScript: inputs, results and ownership

```ts
import { createCacheManager } from '@zeruxjs/cache';

type Inputs = Parameters<typeof createCacheManager>;
type Result = Awaited<ReturnType<typeof createCacheManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createCacheManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Close a standalone manager in finally; let runtime shutdown own a configured service. A required cache outage should fail deliberately, while optional-cache request paths must still fetch authoritative data. Use server-verified tenant/data-revision boundaries in keys and invalidate after a successful authoritative write. Never use cache state as the sole durable record of payment, consent or authorization.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### CacheManagerConfig

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `helper` | `string` | No |
| `options` | `Record<string, unknown>` | Yes |
| `prefix` | `string` | Yes |
| `defaultTtlSeconds` | `number` | Yes |

### CacheSetOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `ttlSeconds` | `number` | Yes |
| `ifAbsent` | `boolean` | Yes |
| `ifPresent` | `boolean` | Yes |

### MemoryCacheOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxEntries` | `number` | Yes |
| `now` | `() => number` | Yes |

### MemoryCacheStats

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `entries` | `number` | No |
| `hits` | `number` | No |
| `misses` | `number` | No |
| `evictions` | `number` | No |
