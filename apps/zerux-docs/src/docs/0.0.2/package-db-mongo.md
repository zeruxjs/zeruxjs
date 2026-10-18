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

## Install and select the integration

```sh
npm install @zeruxjs/db-mongo@0.0.2
```

This package participates in the runtime's **database** integration. Start with [database configuration](configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Install the optional native MongoDB driver when using a URI rather than injecting a compatible executor/client. Configure a database explicitly and select the adapter through a named db connection. Use supported typed where operators instead of passing raw arbitrary Mongo selectors from HTTP input. Decide client ownership before sharing a connection.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-mongo';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Injected clients remain caller-owned; URI-created clients are closed by the adapter. Unfiltered updates/deletes are rejected unless deliberately enabled. Unsupported schema alterations fail instead of pretending to succeed. Aggregation translation, indexes, native sessions and multi-document transactions require testing with the application schema and real MongoDB deployment.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### MongoConnectorOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `db` | `MongoDbLike` | Yes |
| `client` | `{ db(name?: string): MongoDbLike; }` | Yes |
| `database` | `string` | Yes |
| `uri` | `string` | Yes |
| `url` | `string` | Yes |
| `clientOptions` | `Record<string, unknown>` | Yes |
| `allowUnfilteredWrites` | `boolean` | Yes |
| `executor` | `(operation: QueryOperation) => Promise<unknown> \| unknown` | Yes |
| `fixedDatabase` | `boolean` | Yes |
| `locked` | `boolean` | Yes |
| `lockDatabase` | `boolean` | Yes |
