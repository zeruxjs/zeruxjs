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

`createSqliteConsistentBackup(db.getNativeConnection(), "/absolute/private/backup.sqlite")` requires the built-in Node `DatabaseSync`; it uses SQLite's live backup interface, validates integrity and refuses existing destination paths. Backups must be protected by filesystem permissions/encryption, rotation and separate storage. To restore, stop all writers, copy a **verified** snapshot to a new database location, and test before cutover; do not overwrite an opened SQLite database or directly copy an active WAL DB. See `test/backup.test.ts`.

## Synchronous transactions

`createConnector` returns a `SqliteConnector`. Its `transactionSync(callback, options?)` runs BEGIN, the callback and COMMIT on the same synchronous handle without yielding. This is deliberately separate from `@zeruxjs/db`'s async `transaction` extension: shared `capabilities.transactions` remains unsupported. `synchronousTransactions` is true only when this connector has a native/injected synchronous database handle; executor/client/pool injection alone cannot provide it. Call `manager.dbAccess(slug)` and narrow to `SqliteConnector` when explicitly using this native extension through a manager. Never treat capability metadata or a transaction as tenant authorization.

The callback receives a frozen scoped facade with `execute`/`query` for one structured operation and `select`/`insert`/`update`/`delete` convenience methods. Multi-statement table/index creation also runs synchronously through SQL-core's explicit synchronous path. Async functions are rejected before BEGIN; returned promises/thenables trigger rollback. Escaped continuations cannot use the closed facade or captured connector to write later. Captured raw native handles remain privileged host-owned escape hatches; trusted callback code is not sandboxed.

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

## Source ownership map

- `src/index.ts` owns transport selection, initialization rollback, readonly guards and connector shutdown.
- `src/driver.ts` owns driver selection, explicit native policy and prepared-result precision. `openSqlite` returns a new handle requiring `close`; `createSqliteExecutor` borrows its handle and never closes it.
- `src/sync-transaction.ts` owns BEGIN/COMMIT/ROLLBACK state, escaped-continuation guards and rollback-failure quarantine. Callbacks and captured native handles remain trusted application code.
- `src/backup.ts` owns the online-copy verification handle and random temporary main/WAL/SHM paths. Publication uses a no-overwrite hard link; parent-directory trust, symlink ancestors, filesystem permissions and concurrent operators remain host responsibilities.
- `src/dialect.ts` declares the supported shared compiler subset; it opens no database.

Native errors and rows remain private application data. Redact them before returning HTTP responses or telemetry. These helpers do not provide a SQL sandbox, asynchronous pinned transactions or tenant authorization. Source comments describe synchronous cancellation checks; they do not promise interruption of blocking native work.
