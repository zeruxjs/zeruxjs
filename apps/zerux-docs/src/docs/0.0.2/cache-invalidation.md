---
{
  "title": "Cache invalidation patterns",
  "description": "Design cache keys, miss coalescing and writes around authoritative data.",
  "section": "Data and services",
  "order": 30,
  "sources": [
    "packages/@zeruxjs/cache/README.md",
    "packages/@zeruxjs/cache-redis/README.md",
    "packages/zeruxjs/src/response.ts"
  ],
  "related": [
    "package-cache",
    "cache-streams",
    "package-cache-redis"
  ]
}
---

## Separate the two caches

Application cache stores computed JSON values behind a manager. HTTP cache policies tell browsers/proxies how to reuse responses. Filling Redis does not make a response cacheable, and Cache-Control public does not save a database result to Redis. Choose both policies intentionally.

## Namespace keys by ownership and format

Use an application namespace plus a data-schema version. Include a trusted tenant boundary when data differs by tenant. Prefer opaque record IDs to raw email addresses or tokens. Bump the namespace when a cached data shape becomes incompatible; TTL alone may leave old readers/new writers disagreeing during rolling deployment.

## Read-through with bounded staleness

```ts
import { createCacheManager } from '@zeruxjs/cache';
const cache = await createCacheManager({ helper: 'memory',
  prefix: 'shop:catalog:v1', defaultTtlSeconds: 60 });
const catalog = await cache.remember('public-catalog', async () => {
  return loadPublicCatalogFromDatabase();
}, { ttlSeconds: 30 });
```

The application provides loadPublicCatalogFromDatabase. It should return bounded public JSON. remember coalesces only concurrent misses in this manager process; it is not distributed election. If remote producer work is expensive, design a separate shared lease/queue mechanism or tolerate duplicate computation.

## Write, then invalidate

Complete the authoritative database write first. Delete or refresh affected cache keys afterwards. A database commit and cache delete are usually separate operations; plan the failure window. TTL gives a maximum stale interval only when writes/readers follow the expected key policy. Critical consistency may require an outbox/invalidation log and versioned reads rather than best-effort deletion.

## Handle a cache outage

Decide whether reads can fall back to the database and whether a required startup cache should block readiness. Bound fallback load so a Redis outage does not stampede the primary database. Do not silently treat a cache failure as an authorized empty result when that changes application behavior.

## Bulk and clear behavior

setMany is not necessarily atomic. Prefix clear uses literal provider namespace support and fails closed if unavailable. Redis clear uses a sweep and can race new writes; pause/quiesce writers if emptiness must be guaranteed. Avoid FLUSHDB on shared infrastructure and keep BullMQ and cache prefixes separate.

## HTTP caching for public results

Use cached(payload, { visibility: 'public', maxAge, etag, vary }) only after ensuring the entire representation is public. Personalized/tenant-specific responses normally need private/no-store and a reviewed Vary policy. Never allow a client-controlled tenant selector to choose a public cache entry for protected data.
