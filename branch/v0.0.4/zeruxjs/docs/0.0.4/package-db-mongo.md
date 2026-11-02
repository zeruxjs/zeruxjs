# MongoDB

Use normalized operations with explicit client ownership and Mongo-specific limits.


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
npm install @zeruxjs/db-mongo@0.0.4
```

This package participates in the runtime's **database** integration. Start with [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Install the optional native MongoDB driver when using a URI rather than injecting a compatible executor/client. Configure a database explicitly and select the adapter through a named db connection. Use supported typed where operators instead of passing raw arbitrary Mongo selectors from HTTP input. Decide client ownership before sharing a connection.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-mongo';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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
| `client` | `MongoClientLike` | Yes |
| `database` | `string` | Yes |
| `uri` | `string` | Yes |
| `url` | `string` | Yes |
| `clientOptions` | `Record<string, unknown>` | Yes |
| `allowUnfilteredWrites` | `boolean` | Yes |
| `executor` | `(operation: QueryOperation) => Promise<unknown> \| unknown` | Yes |
| `fixedDatabase` | `boolean` | Yes |
| `locked` | `boolean` | Yes |
| `lockDatabase` | `boolean` | Yes |

## Opt-in pinned session lifecycle

Set `transactions: true` with a client (or URI-created client) to run a bounded hello deployment probe before advertising transactions. Replica-set/mongos session/wire support is required; standalone fails before a callback starts. This is a prerequisite check, not certification of FCV, permissions or all shard restrictions. db-only/executor injection cannot opt in. See the package README for a compiled public-import example.

The shared transaction facade passes one session through CRUD/find/aggregation and cursor creation. Only snapshot isolation is negotiated, with primary reads and majority writes. DDL, database switching, savepoints and native cancellation are unsupported. Callback execution is once; TransientTransactionError is returned after cleanup. `maxCommitAttempts` defaults to 1 (maximum 3), retrying only UnknownTransactionCommitResult on commit, without replaying writes or external side effects. Driver-internal command retries are separate.

`maxSessions` defaults to 32; `maxCommitTimeMS` to 10000 and `probeTimeoutMS` to 5000. Cooperative deadlines drain native work before abort/endSession and may exceed their duration. Disconnect waits for accepted work/sessions and only closes URI-created clients; initialization failure rolls back owned acquisition. Injected clients retain host ownership.

Projection/group literals are wrapped in $literal; executable expression objects and unsafe fields reject. Index definitions validate before namespace creation. Unfiltered-write protection applies to executors too: supply a predicate or explicitly enable the trusted bulk policy. Existing matched/modified counts and narrow analytics aggregation shapes are preserved. BSON parser behavior remains driver-owned; no lossless JSON-number conversion is claimed. Live checks require a disposable replica-set/sharded `ZX_TEST_MONGO_URI`; offline fixtures do not prove engine/failover/precision behavior.


## Public entry points

Manifest reference for `@zeruxjs/db-mongo@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.4"
  },
  "peerDependencies": {
    "mongodb": ">=6.0.0"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/db-mongo

JSON-query MongoDB connector for `@zeruxjs/db`. Accept an injected MongoDB-compatible `db`/branch/v0.0.4/`client`/branch/v0.0.4/`executor`, or an optional native `mongodb` peer dependency and a `uri`. Client ownership is explicit: injected clients are never disconnected; a URI-created client is connected/disconnected by the connector lifecycle. Operations use typed Mongo operators, reject unsafe field names and document keys, and fail closed for unfiltered updates/deletes unless `allowUnfilteredWrites: true` is set.

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

Mongo `alterTable` now explicitly rejects unsupported alterations rather than returning a fabricated success. Index operations accept only valid named fields; unsupported selector operators are rejected. Use the explicitly enabled pinned session API below for multi-document atomicity; a JSON operation array is not a transaction.

The connector reports structured capabilities: generated native aggregation and its existing schema/index subset, without returning or native cancellation. Transactions remain unsupported unless explicitly enabled and deployment-probed. Unsupported `returning` now fails before native execution rather than being ignored. Update results preserve `modifiedCount` as `affectedCount`, including zero, and expose separate exact `matchedCount`/branch/v0.0.4/`changedCount` when supplied by the driver. A matched no-op update is not a changed row. See `@zeruxjs/db` for execution budgets and cancellation limits; a cancelled caller does not prove an engine write stopped.

## Pinned transactions

Transactions are opt-in with `transactions: true` and require a client owning both its database and sessions (or an owned URI-created client). Factory initialization then connects the owned client and runs `hello` against admin before exposing a supported capability. It requires logical sessions plus a replica-set or mongos response with a compatible wire version; standalone deployments fail before a callback/session starts. This probe does not certify FCV, permissions, storage-engine support or all shard restrictions; native errors remain authoritative. Without opt-in, no probe or transaction session starts. Installing/importing the optional driver alone enables nothing.

```ts
import { createConnector, type MongoClientLike } from '@zeruxjs/db-mongo';

export async function claim(client: MongoClientLike, id: string, revision: number) {
  // The host supplies a connected replica-set/sharded client, never request-selected credentials.
  const db = await createConnector({ client, database: 'app', transactions: true });
  try {
    return await db.transaction(async tx => {
      const result = await tx.update({ table: 'jobs', values: { revision: revision + 1 },
        where: { and: [ { field: 'id', operator: 'eq', value: id },
          { field: 'revision', operator: 'eq', value: revision } ] } });
      if (result.matchedCount !== 1) throw new Error('Claim conflict');
      return result.changedCount;
    }, { isolation: 'snapshot', timeoutMs: 2000 });
  } finally { await db.disconnect(); } // ends wrapper sessions; the host still owns client.close()
}
```

Authorize tenant/resource access first; neither a transaction nor a match count grants access. The example assumes a host-owned jobs collection and unique ID. Use the manager transaction facade for named connections. Session propagation covers insertOne/insertMany/find/aggregate/updateMany/deleteMany and cursor creation; every callback operation and journal write through that facade uses the same native session. Work is serialized by the shared contract. Default/explicit snapshot isolation uses primary reads, snapshot read concern and majority write concern. Other SQL isolation levels, nesting/savepoints, database switching and transactional DDL are rejected. Existing schema/index operations remain available outside transactions; this package does not provide a distributed migration lock.

## Retry, deadlines and ownership

Callbacks run **once**. TransientTransactionError is returned to the application after abort/endSession; the adapter never invokes `withTransaction` or replays callbacks with possible external side effects. `maxCommitAttempts` defaults to 1 (allowed 1–3), and retries only commitTransaction on UnknownTransactionCommitResult, on the same session without replaying writes. The driver may also perform its documented internal command retries; the adapter bound counts calls to the public driver method. A failed/uncertain commit is not proof of rollback; resolve indeterminate outcomes using application idempotency. Configure a replay contract in application code before retrying an entire operation.

`maxSessions` defaults to 32 (1–1024). `maxCommitTimeMS` defaults to 10000 (1–60000), passed to startTransaction. `probeTimeoutMS` defaults to 5000 (1–60000): it bounds waiting for hello; URI-created clients also default server selection/connect timeouts to that value, with explicit clientOptions remaining host policy. No session exists during the probe. A borrowed driver may continue a timed-out read-only probe; its transport stays host-owned. Deployments must also enforce their transaction lifetime, lock and socket policies.

AbortSignal/deadlines are cooperative through the shared transaction API: further submissions stop, native work settles, then abortTransaction and endSession complete. No arbitrary Promise or write is forcibly cancelled; cancellation capability remains unsupported. Cleanup can exceed the requested deadline. Every acquired session ends once, including callback/commit/abort failures; internal causes/cleanup errors are retained. Disconnect rejects new work and waits for accepted work/sessions before closing only URI-created clients. URI initialization failure closes the partially acquired owned client. Injected clients are never closed; db-only/executor injection cannot own a matching session and rejects transaction opt-in. Do not shut down the wrapper from inside its own transaction callback.

## Query and result boundaries

Projection/group expressions support validated columns and explicit literal values; aggregation literals use `$literal` so strings such as `$private` remain data. Arbitrary executable expression objects, unsafe `$`/prototype field names, unsupported sort directions and malformed logical selectors reject at runtime. Selector depth is 32, logical nodes 10000 and each AND/OR has at most 1000 children; document traversal is bounded to 100000 nodes/depth 32. Index validation occurs before createCollection mutates a namespace. Existing narrow analytics COUNT/numeric aggregation shapes are preserved; these are not full SQL join/union/function semantics.

Unfiltered update/delete protection now also applies to injected executors; add a real predicate or explicitly configure the existing allowUnfilteredWrites policy for trusted bulk administration. Executors remain trusted executable code. Unknown expressions previously forwarded to Mongo now reject instead of acting as a raw expression escape hatch. Count fields must be nonnegative safe integers, and modifiedCount/affectedCount zero remains distinct from matchedCount. BSON values and precision retain the native driver's parser policy; this change does not coerce Decimal128/Long/ObjectId into lossless JSON numbers. Driver results/causes/pipelines are internal data: sanitize API errors and never serialize private request values or credentials to clients.

See official [Node driver transaction APIs](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/) and [deployment prerequisites](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/). Opt-in live checks require `ZX_TEST_MONGO_URI` pointing to a disposable replica-set/sharded database. Offline session fixtures do not establish native transaction, failover or BSON precision acceptance, and no database/application is started automatically.


## Implementation sources

- [packages/@zeruxjs/db-mongo/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-mongo/README.md)
- [packages/@zeruxjs/db-mongo/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-mongo/package.json)
