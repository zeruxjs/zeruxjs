# MySQL

Use MySQL2 pooling with the shared parameterized query model.


## Create a connector

```ts
import { createConnector } from '@zeruxjs/db-mysql';
const connector = await createConnector({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  connectionLimit: 10
});
await connector.disconnect();
```

## SQL and normalization

The compiler uses question-mark placeholders for values. MySQL2 `[rows, fields]` tuples are unwrapped before result normalization so field metadata is not mistaken for data. The connector can accept a host-owned client, pool or executor.

## Dialect limits

Do not request PostgreSQL-style RETURNING on unsupported MySQL statements: unsupported behavior rejects rather than being ignored. Auth user-insert workflows can configure `supportsReturning: false` and use inserted IDs. DDL and arrays of operations are not automatically atomic.

## Ownership and deployment

Only connector-created pools are closed by disconnect. Budget connections across replicas, configure transport and credentials, and use native pinned transactions when required. Verify SQL modes, schema and migration behavior on the actual MySQL version you operate.

## Install and select the integration

```sh
npm install @zeruxjs/db-mysql@0.0.3
```

This package participates in the runtime's **database** integration. Start with [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.3/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Configure mysql2/promise pool options such as host, user, database and connectionLimit, or inject an existing pool/client/executor. Use the manager for application-level named operations. Parameter values use question-mark placeholders; the connector normalizes mysql2 row/metadata tuples rather than exposing the driver response as application rows.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-mysql';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.3/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Only connector-owned pools are disconnected automatically. Use a pinned native connection for transactions; executing several JSON operations does not create atomicity. MySQL INSERT RETURNING differs from PostgreSQL/SQLite, so configure auth supportsReturning appropriately. Treat database errors as failures, avoid exposing SQL/credentials in public responses and verify affected-row semantics for each write.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.


## Public entry points

Manifest reference for `@zeruxjs/db-mysql@0.0.3`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.3",
    "@zeruxjs/db-sql-core": "0.0.3",
    "mysql2": "^3.24.6"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/db-mysql

MySQL JSON-query connector using parameterized `?` placeholders and `mysql2/promise` (loaded only when needed).

```ts
import { createConnector } from '@zeruxjs/db-mysql';
const mysql = await createConnector({host:'localhost', user:'app', database:'demo', connectionLimit:10});
await mysql.disconnect();
```

Accepts injected `client`, `pool`, or `executor`. MySQL2-style `[rows, fields]` tuples are unwrapped before result normalization, avoiding falsely treating metadata as data rows. The adapter tracks whether it created the pool and never closes an externally owned pool. SQL statements are built by `@zeruxjs/db-sql-core` with placeholders rather than interpolating values. SQL DDL and multi-operation pipelines are not automatically atomic; use the underlying client for transactions and migrations.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/db-mysql/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-mysql/README.md)
- [packages/@zeruxjs/db-mysql/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-mysql/package.json)
