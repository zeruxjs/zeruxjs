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
npm install @zeruxjs/db-sqlite@0.0.2
```

This package participates in the runtime's **database** integration. Start with [database configuration](/zeruxjs/docs/0.0.2/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Choose filename and driver explicitly for persistent applications. Without a filename the adapter creates an in-memory database, which disappears on restart. The node driver uses built-in node:sqlite on supported runtimes; better-sqlite3 is an optional alternative. An auto driver does not mean permission or open errors should be hidden behind a different database.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-sqlite';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.2/typescript.md) for the complete NodeNext checker configuration.

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


## Public entry points

Manifest reference for `@zeruxjs/db-sqlite@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.2",
    "@zeruxjs/db-sql-core": "0.0.2"
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

The JSON-query adapter uses prepared statements, returns rows from `SELECT` and `RETURNING`, provides accurate change counts, and maps the project's truncate operation to SQLite `DELETE FROM`. `CREATE DATABASE`, `DROP DATABASE`, and `USE` are deliberately rejected (SQLite cannot perform these operations). For advanced SQL or transactions, obtain the native connection with `getNativeConnection()` and use native SQLite APIs. Transactions on synchronous drivers should not include `await` between BEGIN/COMMIT operations.

Connection ownership: an injected `databaseInstance` is never closed by the connector; a database opened by the connector is closed by `disconnect()`.

## Online backup and restoration

`createSqliteConsistentBackup(db.getNativeConnection(), "/absolute/private/backup.sqlite")` requires the built-in Node `DatabaseSync`; it uses SQLite's live backup interface, validates integrity and refuses existing destination paths. Backups must be protected by filesystem permissions/encryption, rotation and separate storage. To restore, stop all writers, copy a **verified** snapshot to a new database location, and test before cutover; do not overwrite an opened SQLite database or directly copy an active WAL DB. See `test/section74-backup.test.mjs`.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/db-sqllite/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-sqllite/README.md)
- [packages/@zeruxjs/db-sqllite/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-sqllite/package.json)
