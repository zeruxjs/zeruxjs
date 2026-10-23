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
