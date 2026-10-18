---
{
  "title": "Database manager",
  "description": "Route JSON operations across named SQL and Mongo connections.",
  "section": "Packages",
  "order": 2,
  "sources": [
    "packages/@zeruxjs/db/README.md",
    "packages/@zeruxjs/db/package.json"
  ],
  "related": [
    "tenant-data",
    "database-queries",
    "package-auth"
  ],
  "package": "@zeruxjs/db"
}
---

## Manager or framework bootstrap

Framework applications normally configure `db` in zerux.config.ts. Standalone jobs can call `createDatabaseManager` directly. The manager validates operation shapes, resolves named connections and normalizes results; engine-specific work belongs to connector packages.

```ts
import { createDatabaseManager } from '@zeruxjs/db';
const manager = await createDatabaseManager({
  connections: [{ name: 'App', slug: 'main', connector: '@zeruxjs/db-sqlite',
    options: { filename: './private/app.sqlite', driver: 'node' } }]
});
try {
  const result = await manager.select({ op: 'select', table: 'articles',
    where: { field: 'published', operator: 'eq', value: true }, limit: 20 });
} finally {
  await manager.disconnect();
}
```

## Query contracts

Use JSON expressions, validated identifiers, explicit conditions and bounded result sizes. Batch arrays may execute independent operations in parallel. `dependsOn` and `$ref` express result dependencies, not transaction guarantees. The query facade is not safe to expose as arbitrary client-defined database access.

## Tenant isolation

`createTenantDatabaseFacade` permits only a configured table allowlist and a server-verified tenant. It rejects joins, unions, subqueries and tenant-field changes. Construct it after identity verification. A tenant ID received in a request is not proof of tenant membership.

## Migration ownership

The migration runner validates ordered IDs and checksums. The application must provide actual exclusive execution and a transaction-pinned host context for both operations and the journal. Reverse migrations require approval. Per-operation success is not evidence that a multi-step migration was atomic.

## Lifecycle

Initialization failures disconnect already-created connectors. `disconnect()` is idempotent, and subsequent queries fail closed. Injected connections have connector-specific ownership rules; do not close a pool still owned by another service.
