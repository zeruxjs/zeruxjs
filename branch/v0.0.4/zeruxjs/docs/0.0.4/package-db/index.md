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

## Install and select the integration

```sh
npm install @zeruxjs/db@0.0.3
```

This package participates in the runtime's **database** integration. Start with [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

The manager routes normalized operations to named connection facades. Configure a unique slug and choose a default before calling unqualified operations. Use JSON query data for values, keep table/column choices within trusted schema policy and prefer a tenant facade for narrowly scoped CRUD. The virtual db import exists only under the framework loader; a standalone script imports this package directly.

## TypeScript: inputs, results and ownership

```ts
import { createDatabaseManager } from '@zeruxjs/db';

type Inputs = Parameters<typeof createDatabaseManager>;
type Result = Awaited<ReturnType<typeof createDatabaseManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createDatabaseManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Always disconnect a manager you constructed yourself. An operation array is not a transaction: use a native, pinned transaction for atomic writes and migrations. Tenant facades intentionally reject broad joins/subqueries/cross-database routing; do not bypass those restrictions based on request fields. Migration journals need exclusive, transaction-bound host implementations and checksum review.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### DatabaseManagerConfig

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `default` | `string` | Yes |
| `connections` | `DatabaseConnectionConfig[]` | Yes |
| `connection` | `DatabaseConnectionConfig[]` | Yes |

### DatabaseResult

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `ok` | `boolean` | No |
| `connection` | `string` | No |
| `connector` | `string` | No |
| `operation` | `DatabaseOperationName` | No |
| `rows` | `T[]` | Yes |
| `rowCount` | `number` | Yes |
| `affectedCount` | `number` | Yes |
| `insertedIds` | `Array<number \| string>` | Yes |
| `value` | `unknown` | Yes |
| `native` | `unknown` | Yes |
| `query` | `string` | Yes |
| `params` | `unknown[]` | Yes |
| `pipeline` | `unknown[]` | Yes |
| `warnings` | `string[]` | Yes |
| `error` | `DatabaseErrorShape` | Yes |

### TenantDatabaseOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `tenantId` | `string \| number` | No |
| `tables` | `Record<string, string>` | No |
| `tenantColumn` | `string` | Yes |

### MigrationRunnerOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `transaction` | `ExclusiveMigrationTransaction` | No |
| `now` | `() => Date` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/db@0.0.3`.

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

# @zeruxjs/db

JSON-structured database operations, named connections and connector lifecycle management for ZeruxJS or standalone Node.js applications. Drivers are provided by `@zeruxjs/db-mysql`, `@zeruxjs/db-pg`, `@zeruxjs/db-sqlite` and `@zeruxjs/db-mongo`.

Import `createDatabaseManager` for an explicit manager, or `configureDatabaseManager` with the `db`/branch/v0.0.4/`query` convenience exports for the active manager. Connector capabilities differ; inspect the adapter README before relying on a database-specific operation. Tenant facades and migration runners are explicit opt-in APIs.

## Lifecycle and safety

`createDatabaseManager(config)` connects each connector sequentially; an initialization failure now disconnects already-created connections. Always call `await manager.disconnect()` on application shutdown (idempotent). Further queries after disconnect fail closed. Query result references are own-property only and cannot traverse prototypes. Connector package names must be package specifiers, not user-provided arbitrary file paths. Query JSON is size/depth bounded. Array queries are **not automatically transactions**; use native connector transactions where atomicity is required.

## Tenant and migration APIs

`createTenantDatabaseFacade(base, {tenantId, tables: {logical:physical}, tenantColumn?})` exposes only tenant-bound select/insert/update/delete. It rejects joins, unions, subqueries, cross-database routes, nonallowlisted tables and tenant-field changes. Construct it **only** from a server-verified principal, never a query parameter. `createDatabaseMigrationRunner(migrations,{transaction})` requires an actual exclusive and transaction-pinned host implementation for both journal and operations. It checks ordered IDs and SHA-256 drift and requires approval for reverse migrations.  This contract does not automatically provide native transactions for any driver.


## Implementation sources

- [packages/@zeruxjs/db/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db/README.md)
- [packages/@zeruxjs/db/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db/package.json)
