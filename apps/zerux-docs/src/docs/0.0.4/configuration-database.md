---
{
  "title": "Database configuration",
  "description": "Set up db with exact runtime options, typed JavaScript/TypeScript examples and lifecycle policies.",
  "section": "Configuration",
  "order": 110,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/services.ts"
  ],
  "related": [
    "package-db",
    "database-queries",
    "package-db-pg",
    "tenant-data"
  ]
}
---

## Before you configure it

Install the runtime and the packages used by this feature in the application directory. Keep the dependency lockfile committed. Configure only services the application actually uses; a public package name is not automatic service registration.

```sh
npm install zeruxjs @zeruxjs/db @zeruxjs/db-pg
```

## JavaScript application setup

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  db: {
  default: 'main',
  connections: [{ name: 'Primary', slug: 'main', connector: '@zeruxjs/db-pg',
    options: { connectionString: process.env.DATABASE_URL, max: 10 } }],
},
};
```

This example is a server configuration. Supply the referenced environment values through the server process before starting it. The documentation site's static exporter does not start this service merely because it imports a config file.

## What each setting does

The database manager is initialized before cache and other managed services. `db` takes precedence over the legacy `database` alias. `connectorManager` changes the manager module and defaults to `@zeruxjs/db`; each connection's `connector` selects a driver. Prefer the correctly spelled `connections` and `connector` fields in new applications, even where legacy aliases are accepted.

Give each connection a unique slug and a human-readable name. Select the default explicitly in multi-database applications so an unqualified operation cannot silently target a different backend after a configuration change. PostgreSQL can use `connectionString` and pool `max`; MySQL can use `host`, `user`, `password`, `database` and `connectionLimit`; SQLite uses `filename` and `driver`; MongoDB uses `uri` and `database`. These driver options are not universal: copy the shape from the actual adapter guide.

Do not create a manager per HTTP request. Configure connections once per runtime generation; request code obtains a facade from the initialized service or a virtual `db`/`db:slug` import. Those specifiers work only with the Zerux loader. Ordinary Node programs must import the real manager package.

## TypeScript configuration

For a TypeScript application, use `zerux.config.ts`. Validate the service object separately so errors point to its option rather than a large application object. `NonNullable` removes the optional top-level absence; it does not invent defaults or validate external data at runtime.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

type Options = NonNullable<ZeruxConfig['db']>;
const options = {
  default: 'main',
  connections: [{ name: 'Primary', slug: 'main', connector: '@zeruxjs/db-pg',
    options: { connectionString: process.env.DATABASE_URL, max: 10 } }],
} satisfies Options;
export default { db: options } satisfies ZeruxConfig;
```

In JavaScript, the JSDoc annotation provides editor assistance. In TypeScript, `satisfies` checks the shape while preserving inferred literal values. Neither changes the runtime behavior or establishes a network connection during a typecheck. See [TypeScript application development](typescript.md) for strict settings and validation boundaries.

## Lifecycle and failure policy

A configured connection failure rejects database startup. Already-created connections are disconnected by the manager when later connection creation fails. Runtime shutdown owns the managed manager. A standalone caller must call `disconnect()` in `finally`.

Connection setup does not create an application schema, run migrations, authorize SQL operations or begin a transaction. Parameterized values are separate from authorization. For multiple writes that must be atomic, use a transaction implementation pinned to one native connection; an array of JSON operations is not an automatic transaction.

## Verify a real integration

1. Start the application with just this feature and its declared dependencies configured.
2. Check service readiness, then perform one operation through the application API.
3. Test a failure path such as unavailable infrastructure or a rejected input.
4. Restart the runtime and verify that owned resources close and state behaves according to the chosen storage model.
5. Repeat with the production build and the real deployment identity; a successful static docs build does not test external services.

## Declared options

The following table is captured from the source contract used by runtime bootstrap. Optional means a property may be omitted; it does not mean every combination is meaningful. Callback and nested adapter shapes must satisfy the full declared type.

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `default` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `connections` | `DatabaseConnection[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `connection` | `DatabaseConnection[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |

## Continue with the package

- [db](package-db.md)
- [database queries](database-queries.md)
- [db pg](package-db-pg.md)
- [tenant data](tenant-data.md)
