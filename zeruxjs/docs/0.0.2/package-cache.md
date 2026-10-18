# Application caching

Cache JSON data with explicit namespaces, TTLs and ownership.


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


## Public entry points

Manifest reference for `@zeruxjs/cache@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/cache

Application cache abstraction with a built-in bounded memory cache, external adapters, and a manager facade. Cache values are JSON-serializable. Cache keys should not contain secrets.

## Setup

```ts
import { createCacheManager, createMemoryCacheHelper, createCacheManagerWithHelper } from '@zeruxjs/cache';

const cache = await createCacheManager({
  helper: 'memory', // or '@zeruxjs/cache-redis' for Redis
  prefix: 'project:users', // keys are project:users:<name>
  defaultTtlSeconds: 300,
  options: { maxEntries: 2000 }
});

await cache.set('u:42', {name: 'Ada'}, {ttlSeconds: 30});
const users = await cache.getMany(['u:42', 'u:43']); // logical/unprefixed keys
await cache.clear(); // namespace only
```

`createCacheManagerWithHelper(adapter, config)` allows testing or injecting an existing adapter. `createMemoryCacheHelper({maxEntries, now})` implements LRU eviction, lazy TTL expiry, defensive JSON cloning, numeric counters, conditional `ifAbsent`/`ifPresent` writes, bulk methods, and stats.

## Cache stampede prevention

```ts
const item = await cache.remember('catalog', async () => fetchCatalog(), {ttlSeconds: 60});
```

Concurrent misses for the same key **within one manager process** share one pending producer Promise. Failed producers are not cached. It is not a distributed lock and cannot prevent concurrent work across Redis clients or server instances.

## Safety notes

- `clear()` with a prefix must call the provider's `clearPrefix` implementation; it fails closed if unsupported. Without a prefix it calls the provider's global clear, which Redis disables by default.
- TTLs must be positive and finite; counters accept non-negative safe integers.
- Values are JSON-serializable. The memory provider copies objects on get/set to avoid accidental mutation.
- Memory cache is per process: no persistence, synchronization, or cross-worker coordination.
- Conditional writes are atomic only when the provider supports them. `setMany` across multiple keys is not guaranteed atomic.

Run package tests after building: `npm run build && node --test test/*.test.mjs`.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/cache/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/cache/README.md)
- [packages/@zeruxjs/cache/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/cache/package.json)
