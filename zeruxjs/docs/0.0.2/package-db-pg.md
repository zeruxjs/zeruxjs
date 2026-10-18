# PostgreSQL

Use the PostgreSQL connector with named managers or injected pools.


## Connection setup

Use `@zeruxjs/db-pg`, not the older draft spelling db-pgsql. The adapter compiles values into numbered PostgreSQL placeholders.

```ts
import { createConnector } from '@zeruxjs/db-pg';
const connector = await createConnector({
  connectionString: process.env.DATABASE_URL, max: 10
});
await connector.disconnect();
```

## Ownership and pooling

You can inject a pool, client or executor for a host-managed connection or test seam. The adapter closes only a pool it created. Align pool size with replica count and database limits; ten web replicas each opening ten connections need a different budget from a single application.

## Transactions and results

Normalized write results expose affected counts, including zero-row compare-and-swap misses. Operations compile independently unless the application supplies a real pinned native transaction. Never implement a transaction by issuing BEGIN on one pooled connection and later queries on another.

## Deployment

Configure TLS for untrusted networks and least-privilege database roles. Index fields used by tenant filters, pagination and analytics queries. Run real-engine migrations and concurrency checks for your deployment; SQLite coverage does not establish PostgreSQL parity.


## Public entry points

Manifest reference for `@zeruxjs/db-pg@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.2",
    "@zeruxjs/db-sql-core": "0.0.2",
    "pg": "^8.16.3"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/db-pg

PostgreSQL JSON-query connector. Database operations compile to parameterized SQL using `$1`, `$2`, etc.

```ts
import { createConnector } from '@zeruxjs/db-pg';
const pg = await createConnector({connectionString:process.env.DATABASE_URL, max:10});
// Execute normalized operations via a @zeruxjs/db manager, or `connector.execute(operation, context)`.
await pg.disconnect();
```

Accepts injected `pool`, `client`, or `executor` for tests and managed connections. Connectors close only pools they created; external clients are not closed. The dialect and pool lifecycle live in separate modules. Enable PostgreSQL TLS on untrusted networks. Use database-native transactions for multi-operation atomicity; the JSON query pipeline is not a transaction manager.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/db-pg/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-pg/README.md)
- [packages/@zeruxjs/db-pg/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-pg/package.json)
