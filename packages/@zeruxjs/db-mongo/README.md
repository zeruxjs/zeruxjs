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
