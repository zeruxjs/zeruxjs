---
{
  "title": "PostgreSQL",
  "description": "Use the PostgreSQL connector with named managers or injected pools.",
  "section": "Packages",
  "order": 3,
  "sources": [
    "packages/@zeruxjs/db-pg/README.md",
    "packages/@zeruxjs/db-pg/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/db-pg"
}
---

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
