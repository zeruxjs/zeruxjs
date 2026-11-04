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

## Install and select the integration

```sh
npm install @zeruxjs/db-mysql@0.0.4
```

This package participates in the runtime's **database** integration. Start with [database configuration](configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Configure mysql2/promise pool options such as host, user, database and connectionLimit, or inject an existing pool/client/executor. Use the manager for application-level named operations. Parameter values use question-mark placeholders; the connector normalizes mysql2 row/metadata tuples rather than exposing the driver response as application rows.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-mysql';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Only connector-owned pools are disconnected automatically. Use a pinned native connection for transactions; executing several JSON operations does not create atomicity. MySQL INSERT RETURNING differs from PostgreSQL/SQLite, so configure auth supportsReturning appropriately. Treat database errors as failures, avoid exposing SQL/credentials in public responses and verify affected-row semantics for each write.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Pinned DML transactions and count policy

`createConnector` exposes `transaction(fn, options)` on pool-backed transports and the shared manager transaction adapter. The adapter pins getConnection through commit/rollback/release; SQL DDL is excluded because MySQL can implicitly commit. Isolation uses one-shot SET TRANSACTION. Query-only clients/executors reject this capability. Cooperative timeout/cancellation drains native work before rollback, and may exceed the deadline; native query cancellation is unsupported.

Owned pools enable FOUND_ROWS by default (`affectedRowsMode: 'matched'`), preserving zero CAS misses and separate changedRows. Choose `'changed'` to disable FOUND_ROWS; injected pools must declare their actual host-owned handshake policy. Owned BIGINT/DECIMAL values preserve strings; no parser can repair precision already lost by a borrowed transport. Generic RETURNING rejects before acquisition.

`acquireTimeoutMs` (default 5000) and `maxPendingAcquires` (32) bound acquisition independently. Late acquisitions release once, failed transaction cleanup destroys uncertain connections, and disconnect waits before ending only owned pools. TLS objects enforce certificate/hostname verification; multiple statements and insecure TLS verification reject. See the package README for the runnable public-import claim example and exact limits. Live acceptance requires a dedicated `ZX_TEST_MYSQL_URL`; fixtures do not prove backend behavior.
