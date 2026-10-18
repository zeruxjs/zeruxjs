# MongoDB

Use normalized operations with explicit client ownership and Mongo-specific limits.


## Connect through the manager

```ts
import { createDatabaseManager } from '@zeruxjs/db';
const manager = await createDatabaseManager({ connections: [{
  name: 'Main', slug: 'main', connector: '@zeruxjs/db-mongo',
  options: { uri: process.env.MONGO_URL, database: 'app' }
}] });
await manager.disconnect();
```

The optional Mongo driver is loaded for URI-based connections. Injected db/client/executor objects support host-managed infrastructure. URI-created clients are owned by the manager; injected clients are not disconnected automatically.

## Operation boundary

The adapter translates normalized operations into Mongo operators and aggregation pipelines. Joins, groups and unions need schema-specific verification; this is not a complete SQL engine. Unsupported alterations and selector operators reject explicitly.

## Writes and authorization

Unsafe field/document keys are rejected. Unfiltered update/delete fails closed unless explicitly enabled. Still enforce tenant and operation authorization in application code: preventing unsafe syntax does not decide which user may modify a document.

## Transactions and production

Use real Mongo sessions/transactions for atomic multi-document work and journals. Configure authentication, TLS, selection timeouts, retries and indexes for your deployment. An operation array is not automatically a transaction, and SQLite tests do not certify Mongo concurrency behavior.


## Public entry points

Manifest reference for `@zeruxjs/db-mongo@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.2"
  },
  "peerDependencies": {
    "mongodb": ">=6.0.0"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/db-mongo

JSON-query MongoDB connector for `@zeruxjs/db`. Accept an injected MongoDB-compatible `db`/`client`/`executor`, or an optional native `mongodb` peer dependency and a `uri`. Client ownership is explicit: injected clients are never disconnected; a URI-created client is connected/disconnected by the database manager. Operations use typed Mongo operators, reject unsafe field names and document keys, and fail closed for unfiltered updates/deletes unless `allowUnfilteredWrites: true` is set.

```ts
import { createDatabaseManager } from '@zeruxjs/db';
const manager = await createDatabaseManager({
  connections: [{ name: 'Main', slug: 'main', connector: '@zeruxjs/db-mongo', options: {
    uri: process.env.MONGO_URL, database: 'app'
  }}]
});
try { await manager.select({ op: 'select', table: 'users', where: { field: 'active', operator: 'eq', value: true } }); }
finally { await manager.disconnect(); }
```

The Mongo implementation is not a complete SQL engine: joins, groups and unions use aggregation pipelines and need schema-specific testing. Document keys beginning with `$` or containing unsafe identifiers are intentionally rejected. Production deployments should configure Mongo driver authentication, TLS, retries, serverSelectionTimeoutMS, least-privilege users and indexes.

Section 74: Mongo `alterTable` now explicitly rejects unsupported alterations rather than returning a fabricated success. Index operations accept only valid named fields; unsupported selector operators are rejected. Use real MongoDB sessions/transactions for multi-document atomicity and migration journals; a JSON operation array is not a transaction.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/db-mongo/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-mongo/README.md)
- [packages/@zeruxjs/db-mongo/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-mongo/package.json)
