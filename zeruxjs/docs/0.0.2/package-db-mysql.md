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


## Public entry points

Manifest reference for `@zeruxjs/db-mysql@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.2",
    "@zeruxjs/db-sql-core": "0.0.2",
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


## Implementation sources

- [packages/@zeruxjs/db-mysql/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-mysql/README.md)
- [packages/@zeruxjs/db-mysql/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-mysql/package.json)
