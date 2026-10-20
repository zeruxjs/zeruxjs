# 5. Add data with a clear owner

Move from a teaching Map toward deliberate persistence and correctly scoped caches.


## Your goal

Identify where data lives, what survives a restart, and how to choose the next integration without accidentally exposing one user's data to another.

## Memory is useful, with a boundary

```ts title="A bounded teaching store"
const items = new Map<string, string>();

/** Save one teaching item. @param id Application-selected identifier. @param title Validated display text. @returns Nothing. Mutates only the process-local Map. */
export function remember(id: string, title: string): void {
  if (!items.has(id) && items.size >= 100) throw new Error('Teaching store is full');
  items.set(id, title);
}

/** Read one teaching item. @param id Identifier. @returns Stored title or undefined. Reads process-local memory only. */
export function recall(id: string): string | undefined {
  return items.get(id);
}
```

This store is bounded, but not durable or tenant-safe. It is not a database, not shared across replicas and not automatically saved by the framework. A restart/reload can discard it. Use it only to understand a small teaching flow.

## Choose a real persistence layer

| Need | Start with |
| --- | --- |
| Understand named connections and startup ownership | [Database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md) |
| Use queries/transactions deliberately | [Database queries](/branch/v0.0.4/zeruxjs/docs/0.0.4/database-queries.md) |
| Select a concrete engine | [SQL core](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-sql-core.md), [PostgreSQL](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-pg.md), [MySQL](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-mysql.md), [SQLite](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-sqlite.md), or [MongoDB](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-mongo.md) |
| Cache repeated public/scoped computation | [Cache setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-cache.md) |

A database choice is a product/deployment decision. Follow the adapter's actual options, migrations and authorization requirements rather than pasting a universal connection example. Confirm the manager was initialized before using it. Disabled/degraded service state should not look like a successful write.

## A cache has a different job

A cache keeps a reusable result temporarily. It should not become the only copy of an important record unless the storage contract explicitly supports that use. Choose TTLs, maximum sizes and ownership. Include every response-changing dimension in the key.

```ts title="Illustrative scoped key; access must already be authorized"
const tenantId = 'verified-tenant';
const locale = 'fr';
const revision = 'catalog-3';
const key = `public-product-list:${tenantId}:${locale}:${revision}`;
```

The identifiers above are illustrative public values. In an application, derive the tenant from verified authorization and validate locale against an allowlist. A user-supplied tenant ID is not proof of membership. Do not put confidential data in a public shared cache or cache key.

## Verify failure and lifecycle behavior

What happens if the database is unavailable? Who starts the connection? Who closes it on reload? Can a retried write happen twice? A successful connection test does not prove transaction behavior, tenant isolation or idempotency.

Start with a small explicit requirement. For the notes tutorial, durable private notes require an authenticated owner and a persistence design. Do not simply replace `Map` with a database call and declare the entire application production-ready.

## Try it yourself

Draw where the tutorial's notes live in one process and in two replicas. Restart the teaching server and observe the data loss. Then choose an adapter guide and write down the startup owner, required secret names, durability requirement and authorization boundary—without adding real credentials to source.

**You are done when:** you can distinguish durable storage, process-local state and a cache, and explain which owner may access each record.


## Check your understanding

1. What happens to the tutorial Map on process restart?
   - 1. It becomes a SQL table
   - 2. Its records are lost
   - 3. It syncs to every replica

Answer: Its records are lost. An in-memory Map is process-local teaching data. Durable records require an explicitly configured persistence layer.

2. Which cache key is safer for private localized data?
   - 1. notes
   - 2. A key including the authorized tenant/user, locale and relevant revision
   - 3. The first query parameter only

Answer: A key including the authorized tenant/user, locale and relevant revision. Cache ownership and variation must match the response. A cache hit is not an authorization check.

Confirm that you tried the lesson exercise. Optional points/progress are stored only by the browser interface.


## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
