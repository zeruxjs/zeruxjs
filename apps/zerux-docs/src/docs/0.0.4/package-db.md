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

## Install and select the integration

```sh
npm install @zeruxjs/db@0.0.4
```

This package participates in the runtime's **database** integration. Start with [database configuration](configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

The manager routes normalized operations to named connection facades. Configure a unique slug and choose a default before calling unqualified operations. Use JSON query data for values, keep table/column choices within trusted schema policy and prefer a tenant facade for narrowly scoped CRUD. The virtual db import exists only under the framework loader; a standalone script imports this package directly.

## TypeScript: inputs, results and ownership

```ts
import { createDatabaseManager } from '@zeruxjs/db';

type Inputs = Parameters<typeof createDatabaseManager>;
type Result = Awaited<ReturnType<typeof createDatabaseManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createDatabaseManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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

| Field         | Accepted type/value          | Optional |
| ------------- | ---------------------------- | -------- |
| `execution`   | `DatabaseExecutionPolicy`    | Yes      |
| `default`     | `string`                     | Yes      |
| `connections` | `DatabaseConnectionConfig[]` | Yes      |
| `connection`  | `DatabaseConnectionConfig[]` | Yes      |

### DatabaseResult

| Field           | Accepted type/value       | Optional |
| --------------- | ------------------------- | -------- |
| `ok`            | `boolean`                 | No       |
| `connection`    | `string`                  | No       |
| `connector`     | `string`                  | No       |
| `operation`     | `DatabaseOperationName`   | No       |
| `rows`          | `T[]`                     | Yes      |
| `rowCount`      | `number`                  | Yes      |
| `affectedCount` | `number`                  | Yes      |
| `matchedCount`  | `number`                  | Yes      |
| `changedCount`  | `number`                  | Yes      |
| `counts`        | `DatabaseCountMetadata`   | Yes      |
| `insertedIds`   | `Array<number \| string>` | Yes      |
| `value`         | `unknown`                 | Yes      |
| `native`        | `unknown`                 | Yes      |
| `query`         | `string`                  | Yes      |
| `params`        | `unknown[]`               | Yes      |
| `pipeline`      | `unknown[]`               | Yes      |
| `warnings`      | `string[]`                | Yes      |
| `error`         | `DatabaseErrorShape`      | Yes      |

### TenantDatabaseOptions

| Field          | Accepted type/value      | Optional |
| -------------- | ------------------------ | -------- |
| `tenantId`     | `string \| number`       | No       |
| `tables`       | `Record<string, string>` | No       |
| `tenantColumn` | `string`                 | Yes      |

### MigrationRunnerOptions

| Field         | Accepted type/value             | Optional |
| ------------- | ------------------------------- | -------- |
| `transaction` | `ExclusiveMigrationTransaction` | No       |
| `now`         | `() => Date`                    | Yes      |

## Capabilities, bounded execution and continuation

Managers and facades expose explicit supported/unsupported/unknown capability reports. PostgreSQL native-compatible pools implement pinned transactions and destructive cancellation; MySQL pools implement pinned async DML transactions with cooperative deadlines but no native cancellation. MongoDB clients may explicitly enable deployment-probed snapshot session transactions without callback replay or native cancellation. Query-only injected transports remain unsupported. SQLite has a separate synchronous API. Requesting an unsupported advertised feature or an unmet explicit capability requirement fails before execution. Batch preflight checks all capabilities, but batches are not atomic.

Configure `execution.maxPending`, `maxBatch`, `shutdownGraceMs` and a nonblocking `onMetric` hook. CRUD/query methods take a separate `{signal, timeoutMs, deadline, require}` argument; tenant methods forward it without placing executable values in query JSON. Cancellation/deadline rejects an async caller while retaining the resource slot until actual driver settlement. Disconnect aborts contexts and drains up to its grace period before closing connectors. None of these Promise boundaries prove native cancellation or write rollback.

Metrics contain only operation, safe table identifier, duration, optional count and outcome. Values, SQL, parameters, credentials, tenant IDs and raw failures are excluded. Applications may explicitly read their request correlation carrier in this hook; the database package never imports the framework. Counts retain adapter semantics and zero-row misses, with optional matched/changed counts and precision metadata. Approximate or unknown counts cannot prove CAS success.

`createKeysetPage` builds bounded lexicographic pages with stable order declarations and a final unique tie-breaker. It validates structured continuations against the table/order and rejects null/missing/oversized keys. The host owns actual uniqueness, collation, filter/tenant binding and cursor signing if needed. A continuation is not an authorization token or a snapshot. See the package README for a runnable public-import SQLite example and driver count references.

## Pinned transactions and migration ownership

`transaction(fn, options)` is a shared extension point. Managers reject it unless the connector advertises transactions and supplies a `PinnedTransactionAdapter`. PostgreSQL native-compatible pools, MySQL pools and explicitly enabled deployment-probed MongoDB clients implement the pinned adapter; MySQL excludes transactional DDL and native query cancellation. Synthetic and injected fixtures verify the contract without claiming live engine acceptance. Isolation and cooperative timeout are explicitly negotiated before acquiring a lease. Savepoints/nesting are unsupported.

The callback receives only a scoped pinned facade. Every operation, commit, rollback and release must target the acquired connection/session. Queries run FIFO, accepted work drains before finalization, and any query failure makes the scope rollback-only. Callback/commit/rollback failures still attempt release once. Commit/release failures may follow a real commit: do not retry automatically. Cancellation is cooperative; cleanup and outstanding native work must finish before the transaction settles. Transactional DDL must be declared honestly by the owning adapter, not inferred from SQL syntax.

`createPinnedMigrationTransaction` constructs the journal from that same pinned facade and holds a host-provided owned migration lock through transaction cleanup. The host supplies cross-process exclusion, ownership assertions, owner-fenced release and optional ownership-loss cancellation. There is no production in-memory lock implementation or automatic journal provisioning. Checksums, contiguous history and collection limits are checked before applying changes. Reverse migrations require an explicit authorizer returning exactly true. The package README includes public imports, adapter responsibilities, error behavior and native prerequisites.

## Implementation boundaries

The manager owns explicit connector acquisition/admission/shutdown; execution policy and shared types remain database-owned. Tenant projection and keyset construction are inert borrowed consumers. Native pin cleanup and migration lock/journal coordination have separate owners and must settle in order. Use the package README source map to find these boundaries.

The root is Node-only. Connector package names are executable trusted host configuration, and private error details/native results must not be serialized blindly. Legacy JSON validation uses serialization before traversal, so host getters/toJSON are not sandboxed. Known connection-field redaction cannot discover arbitrary custom secret names. Validate data-only HTTP input and authorization before invoking this API.
