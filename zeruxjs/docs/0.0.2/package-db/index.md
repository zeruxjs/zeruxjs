# Database manager

Route JSON operations across named SQL and Mongo connections.


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


## Public entry points

Manifest reference for `@zeruxjs/db@0.0.2`.

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


## Lifecycle and safety

`createDatabaseManager(config)` connects each connector sequentially; an initialization failure now disconnects already-created connections. Always call `await manager.disconnect()` on application shutdown (idempotent). Further queries after disconnect fail closed. Query result references are own-property only and cannot traverse prototypes. Connector package names must be package specifiers, not user-provided arbitrary file paths. Query JSON is size/depth bounded. Array queries are **not automatically transactions**; use native connector transactions where atomicity is required.

## Section 74 tenant and migration APIs

`createTenantDatabaseFacade(base, {tenantId, tables: {logical:physical}, tenantColumn?})` exposes only tenant-bound select/insert/update/delete. It rejects joins, unions, subqueries, cross-database routes, nonallowlisted tables and tenant-field changes. Construct it **only** from a server-verified principal, never a query parameter. `createDatabaseMigrationRunner(migrations,{transaction})` requires an actual exclusive and transaction-pinned host implementation for both journal and operations. It checks ordered IDs and SHA-256 drift and requires approval for reverse migrations. See root `SECTION_74_DATABASE_AUTH_MIGRATIONS_TENANT_SECURITY.md`. This contract does not automatically provide native transactions for any driver.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/db/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db/README.md)
- [packages/@zeruxjs/db/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db/package.json)
