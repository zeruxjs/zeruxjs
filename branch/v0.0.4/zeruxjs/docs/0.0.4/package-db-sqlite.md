# SQLite

Choose a native SQLite driver, understand synchronous transactions and take safe backups.


## Driver choice

```ts
import { createConnector } from '@zeruxjs/db-sqlite';
const connector = await createConnector({
  filename: './private/app.sqlite', driver: 'node'
});
await connector.disconnect();
```

`driver` accepts node, better-sqlite3 or auto. With no filename the connection is in memory. The native driver requires a Node runtime supporting node:sqlite; opening/permission errors are surfaced rather than disguised as a fallback. Install the optional better-sqlite3 peer only if selecting that driver.

## Supported operations

Prepared statements support SELECT, writes and supported RETURNING statements. The framework truncate operation becomes DELETE FROM. SQLite does not support CREATE DATABASE, DROP DATABASE or USE; those operations reject.

## Native transactions

Use `getNativeConnection()` for advanced SQLite APIs. With synchronous drivers, do not put an await between BEGIN and COMMIT: unrelated work can interleave on a shared connection. An array of JSON operations is not a transaction.

## Backup and restoration

`createSqliteConsistentBackup(native, absoluteDestination)` uses the Node live-backup interface, checks integrity and refuses an existing destination. Stop writers before restoration and test the verified copy at a new location. Do not copy an active WAL database as though the main file were a complete snapshot. Protect backup files and keep copies outside the serving host.

## Ownership

Injected databaseInstance values are not closed by the adapter. Connector-created databases close on disconnect. A local SQLite file is not a distributed database for independent filesystem hosts.

## Install and select the integration

```sh
npm install @zeruxjs/db-sqlite@0.0.4
```

This package participates in the runtime's **database** integration. Start with [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Choose filename and driver explicitly for persistent applications. Without a filename the adapter creates an in-memory database, which disappears on restart. The node driver uses built-in node:sqlite on supported runtimes; better-sqlite3 is an optional alternative. An auto driver does not mean permission or open errors should be hidden behind a different database.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-sqlite';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Connector-owned handles close on disconnect; injected databaseInstance handles remain caller-owned. SQLite cannot CREATE DATABASE, DROP DATABASE or USE another database through SQL, so unsupported operations reject. Use the native consistent backup interface for live backups, protect snapshots and restore to a new unopened location after integrity verification. Do not await between BEGIN and COMMIT on a synchronous driver.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### SqliteOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `filename` | `string` | Yes |
| `driver` | `SqliteDriver` | Yes |
| `databaseInstance` | `SqliteDatabase` | Yes |
| `readonly` | `boolean` | Yes |


## Owned synchronous transactions and policies

The public `SqliteConnector.transactionSync` API owns one synchronous BEGIN/callback/COMMIT interval. Its scoped CRUD/query facade rejects promises, async callbacks, nesting and use after scope completion. Failures roll back, including caught query failures. It is separate from the shared async transaction extension, which remains unsupported. Multi-statement DDL uses SQL-core's synchronous path; no await crosses the interval.

Configure bounded `busyTimeoutMs`, explicit `journalMode` (preserve/wal/delete), readonly policy and optional bigint row output before opening resources. WAL still permits one writer; busy waiting blocks the JavaScript thread and does not provide retries or force cancellation. The callback timeout/signal is cooperative, checked around native work. Borrowed handles remain host-owned and requested policy changes persist on them. Captured native handles remain privileged; transactions do not authorize tenant access.

Safe integer reads preserve large native values without guessing numeric precision. RETURNING capability follows the detected native SQLite version; injected executor-only versions are unknown. Backup loads Node SQLite lazily and retains online copying, integrity checks and cleanup of owned random temporary WAL/SHM sidecars. The README provides a public-import example using a disposable directory and explains missing optional native-driver prerequisites. No application files or user-managed processes are changed by these checks.


## Public entry points

Manifest reference for `@zeruxjs/db-sqlite@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.4",
    "@zeruxjs/db-sql-core": "0.0.4"
  },
  "peerDependencies": {
    "better-sqlite3": "^12.6.2"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/db-sqlite

SQLite connector for `@zeruxjs/db` using Node's built-in `node:sqlite` on supported runtimes or optional `better-sqlite3`.

```ts
import { createConnector } from '@zeruxjs/db-sqlite';
const db = await createConnector({filename: './app.sqlite', driver:'node'});
// `driver` can be `node`, `better-sqlite3`, or `auto` (default).
// With no filename, an in-memory database is created.
// Call db.disconnect() to close a connector-owned database.
```

Native SQLite requires Node.js 22.13+ for loading without an experimental startup flag; the API may emit an experimental warning in Node 22. An optional installed `better-sqlite3` package can be selected explicitly. Database opening and permission errors are propagated instead of masked by fallback.

The JSON-query adapter uses prepared statements, returns rows from `SELECT` and `RETURNING`, provides accurate change counts, and maps the project's truncate operation to SQLite `DELETE FROM`. `CREATE DATABASE`, `DROP DATABASE`, and `USE` are deliberately rejected (SQLite cannot perform these operations). Use `transactionSync` below for owned synchronous structured transactions, or explicitly own advanced native SQL through `getNativeConnection()`. Never await between native BEGIN/COMMIT operations.

Connection ownership: an injected `databaseInstance` is never closed by the connector; a database opened by the connector is closed by `disconnect()`.

## Online backup and restoration

`createSqliteConsistentBackup(db.getNativeConnection(), "/absolute/private/backup.sqlite")` requires the built-in Node `DatabaseSync`; it uses SQLite's live backup interface, validates integrity and refuses existing destination paths. Backups must be protected by filesystem permissions/encryption, rotation and separate storage. To restore, stop all writers, copy a **verified** snapshot to a new database location, and test before cutover; do not overwrite an opened SQLite database or directly copy an active WAL DB. See `test/backup.test.mjs`.

## Synchronous transactions

`createConnector` returns a `SqliteConnector`. Its `transactionSync(callback, options?)` runs BEGIN, the callback and COMMIT on the same synchronous handle without yielding. This is deliberately separate from `@zeruxjs/db`'s async `transaction` extension: shared `capabilities.transactions` remains unsupported. `synchronousTransactions` is true only when this connector has a native/injected synchronous database handle; executor/client/pool injection alone cannot provide it. Call `manager.dbAccess(slug)` and narrow to `SqliteConnector` when explicitly using this native extension through a manager. Never treat capability metadata or a transaction as tenant authorization.

The callback receives a frozen scoped facade with `execute`/branch/v0.0.4/`query` for one structured operation and `select`/branch/v0.0.4/`insert`/branch/v0.0.4/`update`/branch/v0.0.4/`delete` convenience methods. Multi-statement table/index creation also runs synchronously through SQL-core's explicit synchronous path. Async functions are rejected before BEGIN; returned promises/thenables trigger rollback. Escaped continuations cannot use the closed facade or captured connector to write later. Captured raw native handles remain privileged host-owned escape hatches; trusted callback code is not sandboxed.

Callback/query failure rolls back; caught query failures still make the transaction rollback-only. Nested or externally active transactions are rejected instead of emulated as savepoints. Commit errors retain a private cause and may be indeterminate; rollback failures aggregate the original error and quarantine the handle. Disconnect can still close a quarantined owned handle. Do not automatically retry a callback after any such failure. Closing the connector releases an owned handle once; borrowed handles are never closed, including failed initialization.

Options are `mode: 'deferred' | 'immediate' | 'exclusive'`, `timeoutMs` (1–60000, default 30000) and `signal`. Default mode is immediate for writable connections and deferred for readonly configuration. Timeout uses monotonic elapsed-time checks before/after native operations and callback completion. It cannot interrupt synchronous native work or JavaScript, and timers cannot fire while that work blocks the event loop. Pre-aborted signals reject before BEGIN. Operation-level async query options are deliberately rejected; synchronous callbacks cannot await a promise deadline. There is no await anywhere inside the owned BEGIN/COMMIT interval.

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnector, createSqliteConsistentBackup,
  type SqliteDatabase, type SqliteConnector } from '@zeruxjs/db-sqlite';

const directory = await mkdtemp(path.join(os.tmpdir(), 'sqlite-example-'));
let connector: SqliteConnector | undefined;
try {
  connector = await createConnector({
    filename: path.join(directory, 'data.sqlite'), driver: 'node',
    journalMode: 'wal', busyTimeoutMs: 1000
  });
  connector.transactionSync(tx => {
    tx.execute({ op: 'createTable', table: 'items', columns: [
      { name: 'id', type: 'integer', primary: true },
      { name: 'label', type: 'text' }
    ] });
    tx.insert({ table: 'items', values: { id: 1, label: 'example' } });
  }, { mode: 'immediate', timeoutMs: 2000 });
  await createSqliteConsistentBackup(connector.getNativeConnection() as SqliteDatabase,
    path.join(directory, 'snapshot.sqlite'));
} finally {
  await connector?.disconnect();
  await rm(directory, { recursive: true, force: true });
}
```

The example uses only a disposable directory and requires a functioning Node SQLite/backup API. Production filenames and backup destinations are trusted host configuration, never arbitrary request parameters. Authorize the principal and tenant/table access before entering the callback.

## Busy timeout, WAL and readonly policy

`busyTimeoutMs` explicitly sets PRAGMA busy_timeout to an integer in 0–60000 ms. It can block the Node thread while waiting; it is not a retry queue or transaction deadline. `journalMode` is `preserve` (default), `wal` or `delete`. The requested mode is verified rather than silently downgraded: requesting WAL for an in-memory database fails. Journal mode changes on disk persist beyond this connector. Borrowed handles receive policy changes only when explicitly requested; those changes are not reverted on disconnect. A readonly configuration must preserve journal mode and rejects writes through its structured/synchronous facade, including borrowed handles.

SQLite WAL still has [one writer at a time](https://www.sqlite.org/wal.html). BEGIN IMMEDIATE may fail with [SQLITE_BUSY](https://www.sqlite.org/lang_transaction.html) when another handle holds the writer lock; exclusive mode has different reader effects outside WAL. Keep callbacks short and move remote I/O outside them. There is no automatic callback retry, shared cache, read-uncommitted mode, background checkpoint worker, or server-managed application restart. Hosts own checkpointing and connection budgets. Policies requiring native controls reject for executor-only injection instead of being ignored.

## Integer precision, driver selection and backups

Prepared statements enable the driver's integer-safe mode when available (`setReadBigInts` for Node, `safeIntegers` for better-sqlite3). Default row conversion keeps safe integers as numbers and preserves larger signed 64-bit integers as decimal strings. `readBigInts:true` leaves row integers as bigint; callers must choose their JSON serialization policy. Write change counts remain safe numbers, small insert IDs retain their numeric form, and large bigint insert IDs retain SQL-core's string representation. This avoids converting a successful large-rowid write to an unsafe number after execution. Injected database implementations without integer controls cannot promise the same precision; requesting explicit bigint mode fails there. DECIMAL affinity, floating-point values, dates and timezones are not arbitrary-precision contracts.

`sqliteVersion` is read from the configured native handle. RETURNING is reported supported only for a detected SQLite version at least 3.35; unknown injected executor versions report unknown. Actual driver methods and backend feature support still matter. Driver selection remains explicit/auto as before: auto falls back only when node:sqlite cannot be imported, never after opening, permission, configuration or integrity errors. Online backup loads node:sqlite lazily, so importing this package does not require Node's driver when an optional better-sqlite3 setup is chosen.

Backups retain native online copying, integrity_check verification and no-overwrite publication. The integrity-check handle closes before temporary main/WAL/SHM files are removed; cleanup failures retain the primary failure. Backup and restore tests use disposable file/WAL databases, verify rolled-back rows are absent and leave application paths untouched. Optional better-sqlite3 acceptance requires its installed working native binding; the package does not install or download it automatically. See [Node SQLite](https://nodejs.org/api/sqlite.html) and [better-sqlite3 transactions](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) for driver-specific runtime behavior.

Statement row metadata is preferred over SQL keyword matching, so a quoted column/default containing RETURNING cannot hide write counts. Older injected drivers without reader/column metadata reject ambiguous raw WITH statements; this helper is not a general SQL parser. Structured compiler output remains supported.


## Implementation sources

- [packages/@zeruxjs/db-sqllite/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-sqllite/README.md)
- [packages/@zeruxjs/db-sqllite/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-sqllite/package.json)
