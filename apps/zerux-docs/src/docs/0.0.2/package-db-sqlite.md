---
{
  "title": "SQLite",
  "description": "Choose a native SQLite driver, understand synchronous transactions and take safe backups.",
  "section": "Packages",
  "order": 5,
  "sources": [
    "packages/@zeruxjs/db-sqllite/README.md",
    "packages/@zeruxjs/db-sqllite/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/db-sqlite"
}
---

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

This package participates in the runtime's **database** integration. Start with [database configuration](configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Choose filename and driver explicitly for persistent applications. Without a filename the adapter creates an in-memory database, which disappears on restart. The node driver uses built-in node:sqlite on supported runtimes; better-sqlite3 is an optional alternative. An auto driver does not mean permission or open errors should be hidden behind a different database.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-sqlite';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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
