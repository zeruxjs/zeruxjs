# @zeruxjs/db

JSON-structured database operations, named connections and connector lifecycle management for ZeruxJS or standalone Node.js applications. Drivers are provided by `@zeruxjs/db-mysql`, `@zeruxjs/db-pg`, `@zeruxjs/db-sqlite` and `@zeruxjs/db-mongo`.

Import `createDatabaseManager` for an explicit manager, or `configureDatabaseManager` with the `db`/`query` convenience exports for the active manager. Connector capabilities differ; inspect the adapter README before relying on a database-specific operation. Tenant facades and migration runners are explicit opt-in APIs.

## Lifecycle and safety

`createDatabaseManager(config)` connects each connector sequentially; an initialization failure now disconnects already-created connections. Always call `await manager.disconnect()` on application shutdown (idempotent). Further queries after disconnect fail closed. Query result references are own-property only and cannot traverse prototypes. Connector package names must be package specifiers, not user-provided arbitrary file paths. Query JSON is size/depth bounded. Array queries are **not automatically transactions**; use the pinned extension below with a verified adapter, or an explicitly owned native transaction, where atomicity is required.

## Tenant and migration APIs

`createTenantDatabaseFacade(base, {tenantId, tables: {logical:physical}, tenantColumn?})` exposes only tenant-bound select/insert/update/delete. It rejects joins, unions, subqueries, cross-database routes, nonallowlisted tables and tenant-field changes. Construct it **only** from a server-verified principal, never a query parameter. `createDatabaseMigrationRunner(migrations,{transaction})` requires an actual exclusive and transaction-pinned host implementation for both journal and operations. It checks ordered IDs and SHA-256 drift and requires approval for reverse migrations. This contract does not automatically provide native transactions for any driver.

## Execution capabilities and limits

Managers/facades returned by this package expose `capabilities(slug?)` / `capabilities()`. The interface member is optional for compatibility with hand-written legacy implementations. Each of `returning`, `transactions`, `cancellation`, `schema`, `indexes`, and `nativeAggregation` is `supported`, `unsupported` or `unknown`. Metadata describes the structured connector API, not everything the native engine can do. Unmodified third-party connectors report unknown. Known unsupported returning/schema/index requests fail before driver execution; batch preflight checks every operation before starting any. `queryOptions.require` rejects both unknown and unsupported requirements. Coarse schema/index support does not imply every dialect-specific action is implemented; owning compilers still reject unsupported actions before issuing their statements.

Bundled SQL connectors inherit dialect returning support and schema/index support from SQL core; native aggregation is not a separate SQL API. Mongo advertises generated native aggregation pipelines and its implemented schema/index subset, but not returning. PostgreSQL pool-backed connectors now implement the pinned transaction extension and destructive cancellation; query-only injected PostgreSQL transports remain unsupported. MySQL pool-backed connectors implement pinned async DML transactions with cooperative deadlines and explicit matched/changed row policy, but not native cancellation or transactional DDL. MongoDB client-backed connectors can opt into deployment-probed session transactions with snapshot isolation and no callback replay, but not native cancellation/transactional DDL. Other bundled connectors report shared async transactions/native cancellation as unsupported; SQLite separately owns its synchronous API. `query([...])` remains a batch, and the migration runner still requires a real host-owned exclusive transaction. Native pool/session capabilities do not establish an abstraction guarantee.

`DatabaseManagerConfig.execution` accepts `maxPending` (default 64), `maxBatch` (default 128), `shutdownGraceMs` (default 5000) and `onMetric`. Pending/batch limits must be integers in 1–4096; grace is 1–60000 ms. `maxBatch` bounds both operation arrays and rows in each multi-row insert. An independent parallel batch must fit the currently available pending slots or fails before starting; dependent batches execute sequentially. Arrays are not queued or made atomic. Existing JSON depth/8 MiB input limits remain. These limits do not cap returned row bytes: use a bounded select or keyset page and driver-specific result limits.

All manager, connection, convenience and tenant CRUD/query methods accept a separate optional `{signal, timeoutMs, deadline, require}` argument. Signals/callbacks never enter query JSON. Deadlines are Unix milliseconds up to ten minutes ahead; timeout is 1–600000 ms and the earlier deadline wins. Batch timeout/deadline is shared across operations. Pre-aborted/expired requests fail before execution. Native cancellation is cooperative through `DatabaseExecutionContext.signal/deadline`; `require:['cancellation']` demands an explicit driver guarantee. The manager can stop an async caller waiting, but cannot claim the engine stopped or a write rolled back. A synchronous SQLite call cannot be interrupted; it is checked before/after execution. Never automatically retry a timed-out write without an idempotency policy.

Timed-out/cancelled work retains its pending slot until the underlying driver promise settles. This prevents cancellation from bypassing the resource limit. Disconnect rejects new work immediately, aborts active query contexts, waits up to the grace period for actual settlement, then releases connectors in reverse order. Each driver owns its native close behavior; an uncooperative promise/driver cannot be forcibly terminated by a generic abstraction. Initialization rollback and native-access-after-disconnect rejection remain in force.

Metrics are frozen `{operation, table?, durationMs, count?, outcome}` records. Count prefers `affectedCount` using nullish precedence, so zero never falls back to another count. Invalid/nonidentifier table names are omitted. No connection options, SQL, parameters, values, raw failures, result bodies, cursors, tenant IDs, cookies or credentials are included. Hook exceptions/rejections do not change query results; hooks must be nonblocking synchronous code. For request correlation, an application may explicitly read `getRequestCorrelation()` from `zeruxjs` inside its hook, or use its own context carrier. Database code does not import the framework or start telemetry on import. Original driver exceptions stay private and can be handled by the host's trusted error sink; never serialize whole results/errors to clients.

## Counts and compare-and-swap

`affectedCount` retains its existing driver meaning and zero-row CAS behavior. `rowCount` describes returned rows or a driver command count; the manager never invents affected rows from `rows.length`. Optional `matchedCount`/`changedCount` distinguish matching from modification when the driver supplies them. `counts` declares exact/approximate/unknown precision and `affectedMeaning` (`matched`, `changed` or `engine`). Legacy results without metadata are unknown. Approximate/unknown counts must not establish CAS success. Counts must be safe nonnegative integers; malformed driver counts fail with `INVALID_RESULT`. A count error after execution does not roll back a write.

SQL reports the exact engine command counter when supplied, preserving PostgreSQL `rowCount`, MySQL `affectedRows` and SQLite `changes`. Their meanings differ: [PostgreSQL UPDATE](https://www.postgresql.org/docs/current/sql-update.html) includes unchanged matched rows (subject to trigger behavior); [MySQL affected rows](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html) depends on FOUND_ROWS policy; [SQLite changes](https://www.sqlite.org/c3ref/changes.html) excludes auxiliary trigger/foreign-key effects. Do not treat them all as changed-value counts. Mongo preserves `modifiedCount` as affected count and separately exposes `matchedCount`, following its [update result contract](https://www.mongodb.com/docs/manual/reference/method/db.collection.updatemany/). A no-op Mongo update can match one row and change zero. CAS consumers should condition on a version/unique key and actually advance the version; verify precise counts for their configured adapter.

## Keyset example using public imports

```ts
import { createDatabaseManager, createKeysetPage } from '@zeruxjs/db';

const manager = await createDatabaseManager({
  connections: [{ name: 'App', slug: 'main', connector: '@zeruxjs/db-sqlite',
    options: { filename: ':memory:', driver: 'node' } }],
  execution: { maxPending: 8, maxBatch: 64, onMetric(metric) { console.log(metric); } }
});
try {
  await manager.createTable({ op: 'createTable', table: 'items',
    columns: [{ name: 'id', type: 'integer', primary: true }] });
  await manager.insert({ op: 'insert', table: 'items', values: [{ id: 1 }, { id: 2 }] });
  const page = createKeysetPage({ table: 'items',
    order: [{ column: 'id', direction: 'asc' }], uniqueKey: 'id', limit: 1 });
  const result = await manager.select(page.operation, { timeoutMs: 1000 });
  if (result.rows?.length) {
    const after = page.continuation(result.rows.at(-1) as Record<string, unknown>);
    const next = createKeysetPage({ table: 'items',
      order: [{ column: 'id', direction: 'asc' }], uniqueKey: 'id', limit: 1, after });
    await manager.select(next.operation, { timeoutMs: 1000 });
  }
} finally {
  await manager.disconnect();
}
```

Install the SQLite connector explicitly; the example requires a Node version providing `node:sqlite`. The helper creates lexicographic predicates for 1–4 flat ascending/descending keys and a limit in 1–1000, without offsets. The last key must equal the declared unique tie-breaker. The host must enforce uniqueness, non-null keys, stable collation and ordering, and include sort keys in selected rows. Null/nonfinite/missing/oversized continuation values, mismatched table/order and offset options are rejected. Only scalar string/number/boolean cursor values are supported; opaque objects such as Mongo ObjectIds require an owner-defined scalar representation or a separate native API. Continuations are structured data, not signed credentials or authorization. Bind filter/tenant context server-side when accepting a cursor; never trust its table/order to choose an allowlist. Passing the generated operation through a tenant facade retains that facade's tenant predicate and table allowlist. Concurrent writes can move rows between pages; this is not a snapshot transaction.

## Pinned transaction extension

`manager.transaction(fn, options)` and its connection-bound facade equivalent negotiate before acquiring a lease. The methods are optional in the structural interfaces to preserve legacy implementations; managers created here implement them and reject unsupported connectors with `UNSUPPORTED_TRANSACTION`. A connector must both advertise `capabilities.transactions: 'supported'` and provide `transactionAdapter`. PostgreSQL native-compatible pools, supported MySQL pools and explicitly enabled deployment-probed MongoDB clients implement the native pin extension. Query-only transports and SQLite shared async transactions remain unsupported; inspect the adapter-specific guarantees above. `db.transaction` delegates to the active default facade; a batch array still has no transaction semantics.

`PinnedTransactionAdapter` declares `isolationLevels`, `timeout: 'cooperative' | 'unsupported'`, `savepoints: false` and `transactionalDdl`. `transactionCapabilities()` reports these choices without acquiring a connection. `TransactionOptions` accepts an explicit isolation level, `timeoutMs` (1–600000), Unix-ms `deadline` and `signal`. Unsupported isolation/timeout fails before acquisition; omitted isolation is the adapter's documented native default. There is no implicit downgrade or automatic retry. Nested `tx.transaction(...)` and reentering the same manager/runner reject with `NESTED_TRANSACTION_UNSUPPORTED`; savepoints are deliberately not implemented in this phase. Engines' native [savepoints](https://www.postgresql.org/docs/current/sql-savepoint.html) are not an emulated nested transaction API.

An adapter's `acquire(context)` returns one `PinnedTransactionSession` with `begin`, `execute`, `commit`, `rollback`, and `release`. Every method MUST use that same native connection/session, never the pool's unpinned query method. The adapter owns partial acquire cleanup. The shared runner attempts rollback on begin/callback/query/commit failure, and release once after commit or rollback, including rollback failure. Commit failures are `TRANSACTION_COMMIT_FAILED` with a private cause and potentially indeterminate outcome; rollback/release failures aggregate the original error. An adapter must discard an unusable connection rather than return it as healthy. A release error does not undo a successful commit; do not automatically retry these failures.

Callbacks receive a frozen `TransactionDatabase` with CRUD/query methods and a cooperative signal, without native handles or private options. Only this facade routes to the pinned executor. Captured outer-manager queries/native access/disconnect and explicit cross-connection routes are denied in its callback scope. Previously captured native clients remain host-owned escape hatches: the library cannot sandbox trusted application code. A captured transaction facade rejects after the callback ends. Accepted work runs FIFO on the lease, and unawaited accepted query promises drain before commit. Any query failure marks the scope rollback-only even if caught. Use `await` for every operation; batches inside the callback use the same pin and remain part of the surrounding transaction.

A transaction occupies one manager pending slot; its per-lease operation queue also uses the configured pending/batch limits and existing redacted metrics. Abort/deadline stops further submissions and asks the adapter to cancel cooperatively. Unlike a standalone query wait, a transaction does not resolve/reject until accepted native work, rollback and release settle: this prevents a migration lock from being released over outstanding writes. Uncooperative callbacks, acquire, native work or cleanup can exceed the deadline; this is not forced cancellation. Native commit begun before timeout can be indeterminate. Schema/database switching is forbidden inside a pin; table/index DDL additionally requires `transactionalDdl: true`. This declaration must reflect actual rollback behavior, including engine-specific implicit commits; [MySQL DDL](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html) must not be advertised as generally rollbackable.

```ts
import { createPinnedTransaction, createTenantDatabaseFacade,
  type PinnedTransactionAdapter } from '@zeruxjs/db';

// The host supplies an explicitly configured, verified native pinned adapter.
export async function savePair(adapter: PinnedTransactionAdapter, verifiedTenantId: string) {
  const transaction = createPinnedTransaction(adapter, {
    name: 'Main', slug: 'main', connector: 'host-owned-adapter', options: {}
  }, { maxPending: 8, maxBatch: 16 });
  return transaction(async tx => {
    const tenant = createTenantDatabaseFacade(tx, {
      tenantId: verifiedTenantId, tables: { messages: 'messages' }
    });
    await tenant.insert({ table: 'messages', values: { id: 'first', body: 'one' } });
    await tenant.insert({ table: 'messages', values: { id: 'second', body: 'two' } });
  }, { isolation: 'serializable', timeoutMs: 2000 });
}
```

`createPinnedTransaction` is inert until called and loads no drivers. It is an adapter extension point, not an in-memory implementation or proof of live rollback. The deterministic pinned executor in `test/transactions.test.cjs` verifies the shared lifecycle with synthetic state; it is not a production database adapter.

## Owned migration coordination

Existing host-provided `ExclusiveMigrationTransaction` callbacks remain compatible. To bind the journal to the new pin, use `createPinnedMigrationTransaction(transaction, { lock, lockName, journalTable, lockTimeoutMs?, transactionOptions? })`, then pass it as the migration runner's `transaction`. Provision the journal table (`id`, `checksum`, `appliedAt`) in that same database beforehand; bootstrapping the journal is explicitly host-owned. Journal select/insert/delete use only the callback's pinned facade. Applied migrations and journal writes commit or roll back together only when the supplied adapter's actual transaction/DDL semantics support that guarantee.

`MigrationLock.acquire({name, owner, signal})` must return a lease with the exact generated owner, `assertOwned()`, and owner-fenced `release(owner)`. An optional lease signal must abort on ownership loss. The lock name identifies the database/journal domain across all processes and runners. The host must supply real cross-process exclusion, fencing/renewal and bounded acquisition; no in-memory production lock is supplied. Lock acquisition receives a cooperative deadline (default 30000 ms; configurable 1–60000). Ownership is checked before the transaction, for journal operations and before committing callback results. Locks remain held through transaction cleanup and are released in finally with the generated owner; mismatch/release errors never silently pass. A lease implementation must never release another owner's lock, including when acquisition returns malformed ownership. Hold native advisory locks or provide equivalent database-safe fencing; a stale lease must not permit writes. These callbacks do not themselves prove distributed coordination.

The migration runner bounds definitions/journal records to 4096 and total up/down operations to 4096. Checksum drift reports a private reason/id and expected/actual SHA-256 checksums without SQL/operation values. Unknown/duplicate/malformed records and noncontiguous history fail closed. Reverse migration requires an authorizer returning exactly `true`; truthy strings/objects are denied. The authorizer must verify a real operator approval and deployment policy. A request parameter is not approval, and reverse migrations may destroy data. Failed journal work or lost lock ownership rolls back through the same pin.

## Implementation and ownership map

- `src/types.ts` owns structured operations, native counts, capability and execution contracts. `src/index.ts` retains compatibility exports, including the historical `turcunateTable` spelling; the active manager is process-global and replacement does not disconnect a previous owner.
- `src/manager.ts` owns explicit connector package resolution, startup rollback, admission, result normalization, fixed-shape metrics and reverse shutdown. `src/execution.ts` validates separate cancellation/deadline/capability policy before dispatch.
- `src/utils.ts` owns compatible configuration normalization, result references and JSON cloning. This legacy validator serializes before traversal: trusted host getters/toJSON can execute, so it is not an inert-object sandbox. Raw network input must first pass the application's data-only validation and authorization.
- `src/tenant.ts` owns a detached logical-table allowlist and mandatory tenant predicates. Construct it from verified identity; a caller-supplied tenant string proves nothing. `src/pagination.ts` binds continuations to explicit table/order, leaving uniqueness, collation and filter authorization with the host.
- `src/transactions.ts` owns FIFO native pins and rollback/release settlement. `src/migration-coordination.ts` keeps the host-fenced lock through that same cleanup; `src/migrations.ts` checks ordered definitions/journal drift and exact rollback approval.

Root runtime imports require Node. Connector package names are trusted executable host configuration; a valid package specifier is not an allowlist or authorization grant. Public Error.details/native results can retain private values or causes. Known connection-field redaction is a compatibility summary, not discovery of every custom secret name; review custom fields before exposing them. Input budgets do not bound returned row bytes, and cooperative cancellation never establishes that a native write rolled back.

The package-local checks use explicitly injected connectors, synthetic lock/pin state, locally packed declarations and disposable in-memory SQLite. They do not qualify live PostgreSQL/MySQL/MongoDB, distributed migration exclusion or crash recovery.
