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

## Install and select the integration

```sh
npm install @zeruxjs/db-pg@0.0.2
```

This package participates in the runtime's **database** integration. Start with [database configuration](configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Provide PostgreSQL Pool options such as connectionString and max, or inject an application-owned client/pool/executor. Choose TLS and certificate verification for the actual network. Values compile to dollar-numbered parameters. A named manager connection makes database selection explicit instead of embedding a global pool in each route.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-pg';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Close only resources owned by this instance. A transaction requires one native client pinned for its full duration; separate pooled queries can run on different connections. Verify row counts and RETURNING behavior for inserts/updates. Run schema migrations separately from pool initialization, and review database grants rather than treating parameterized values as permission checks.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.
