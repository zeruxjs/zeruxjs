# @zeruxjs/db-pg

PostgreSQL JSON-query connector. Database operations compile to parameterized SQL using `$1`, `$2`, etc.

```ts
import { createConnector } from '@zeruxjs/db-pg';
const pg = await createConnector({connectionString:process.env.DATABASE_URL, max:10});
// Execute normalized operations via a @zeruxjs/db manager, or `connector.execute(operation, context)`.
await pg.disconnect();
```

Accepts injected `pool`, `client`, or `executor` for tests and managed connections. Connectors close only pools they created; external clients are not closed. The dialect and pool lifecycle live in separate modules. Enable PostgreSQL TLS on untrusted networks. Use database-native transactions for multi-operation atomicity; the JSON query pipeline is not a transaction manager.
