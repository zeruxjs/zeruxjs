# Querying databases

Configure named connections and use the JSON operation facade safely.


## Choose a connector

The manager package `@zeruxjs/db` validates and routes operations. SQL adapters share `@zeruxjs/db-sql-core`; the runtime package names are `@zeruxjs/db-pg`, `@zeruxjs/db-mysql`, `@zeruxjs/db-sqlite` and `@zeruxjs/db-mongo`. The SQLite source folder has a historical spelling; use its package manifest name in imports.

## Configure a named connection

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

export default {
  db: {
    default: 'main',
    connections: [{
      name: 'Primary database', slug: 'main', connector: '@zeruxjs/db-pg',
      options: {
        host: process.env.DB_HOST,
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 5432)
      }
    }]
  }
} satisfies ZeruxConfig;
```

One connection can become the default automatically; multiple connections require a selected default. Bootstrap initializes the manager before loading application modules and strips raw DB configuration from the public runtime config. This does not make direct environment access safe to expose.

## Virtual imports

With the Zerux loader active, `db` resolves to the default facade and `db:reporting` to a named facade. These are framework virtual imports, not npm packages. Ordinary Node scripts should construct a manager through `@zeruxjs/db` instead.

```ts
import { select } from 'db';

const result = await select({
  table: 'articles', columns: ['id', 'title'],
  where: { field: 'published', operator: 'eq', value: true },
  orderBy: [{ by: 'id', direction: 'desc' }],
  limit: 20
});
```

## Operation model

Operations are JSON data, with explicit table, columns, conditions, ordering and limits. SQL adapters compile values into parameters and validate identifiers. Do not accept an arbitrary client-supplied operation tree as authorization: choose tables, allowed fields and tenant filters in trusted code.

| Facade operations | Purpose |
| --- | --- |
| `select`, `insert`, `update`, `delete` | Data access |
| `createTable`, `alterTable`, `dropTable`, `turcunateTable` | Schema/table operations; the truncate method retains its historical spelling |
| `createIndex`, `dropIndex` | Index management |
| `createDb`, `dropDb`, `switchDB` | Database administration |
| `query` | A structured operation or array of operations |
| `dbAccess(slug)` / native access | Trusted connector-specific operations |

## Batch dependencies and atomicity

Array queries can execute independent operations in parallel and sequence `dependsOn` dependencies. `$ref` can refer to earlier result paths. An array is not automatically a transaction. For an atomic multi-write operation, supply a real driver transaction with appropriate connection pinning; do not infer atomicity from JavaScript order.

## Tenants and migrations

`createTenantDatabaseFacade` restricts allowlisted tables and binds a server-verified tenant. It rejects unsupported query shapes rather than attempting to prove arbitrary joins safe. The migration runner needs a host implementation that provides exclusive execution and a transaction-pinned journal/operation context. See the database package guide before adoption.

## Shutdown and errors

Managers disconnect previously opened connectors when partial initialization fails. Call `disconnect()` during standalone shutdown; framework-managed managers are closed by the service lifecycle. Queries after disconnect fail closed. Error details are internal diagnostics, not safe public API payloads.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/database.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/database.ts)
- [packages/@zeruxjs/db/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db/src/index.ts)
- [packages/@zeruxjs/db/src/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db/src/types.ts)
