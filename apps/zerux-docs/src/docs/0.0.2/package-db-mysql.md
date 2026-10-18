---
{
  "title": "MySQL",
  "description": "Use MySQL2 pooling with the shared parameterized query model.",
  "section": "Packages",
  "order": 4,
  "sources": [
    "packages/@zeruxjs/db-mysql/README.md",
    "packages/@zeruxjs/db-mysql/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/db-mysql"
}
---

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
