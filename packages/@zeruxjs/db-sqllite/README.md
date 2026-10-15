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
