---
{
  "title": "MongoDB",
  "description": "Use normalized operations with explicit client ownership and Mongo-specific limits.",
  "section": "Packages",
  "order": 6,
  "sources": [
    "packages/@zeruxjs/db-mongo/README.md",
    "packages/@zeruxjs/db-mongo/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/db-mongo"
}
---

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
