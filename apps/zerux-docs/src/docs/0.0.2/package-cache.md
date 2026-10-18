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
