# @zeruxjs/db-mongo

JSON-query MongoDB connector for `@zeruxjs/db`. Accept an injected MongoDB-compatible `db`/`client`/`executor`, or an optional native `mongodb` peer dependency and a `uri`. Client ownership is explicit: injected clients are never disconnected; a URI-created client is connected/disconnected by the connector lifecycle. Operations use typed Mongo operators, reject unsafe field names and document keys, and fail closed for unfiltered updates/deletes unless `allowUnfilteredWrites: true` is set.

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

The connector reports structured capabilities: generated native aggregation and its existing schema/index subset, without returning or native cancellation. Transactions remain unsupported unless explicitly enabled and deployment-probed. Unsupported `returning` now fails before native execution rather than being ignored. Update results preserve `modifiedCount` as `affectedCount`, including zero, and expose separate exact `matchedCount`/`changedCount` when supplied by the driver. A matched no-op update is not a changed row. See `@zeruxjs/db` for execution budgets and cancellation limits; a cancelled caller does not prove an engine write stopped.

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

## Implementation and ownership map

- `src/index.ts` preserves the public factory/types/query-helper exports. `src/connector.ts` owns native transport selection, pre-mutation validation, normalized counts, the existing analytics aggregation shapes and connector drain.
- `src/query.ts` owns allowlisted field/selector/projection/sort translation. `$literal` keeps aggregation strings as data; these helpers do not authorize tenant access or sandbox trusted host accessors.
- `src/session.ts` owns the opt-in hello prerequisite probe, explicit session argument injection, live session capacity and bounded uncertain-commit attempts. Every release waits for endSession and never replays a callback.

Root runtime imports require Node. Native clients/options/executors are trusted host configuration; the wrapper cannot sandbox an injected function or override all native driver retry/BSON policy. Native records, generated pipelines and original causes stay private until an application deliberately sanitizes a response. Read limits must be chosen explicitly; input validation does not impose a universal returned-byte ceiling.

Offline tests own injected databases/session fixtures and temporary packed consumers. Wrapper teardown is registered independently of assertions. The optional live test needs a disposable replica-set/sharded deployment and is kept separate; no server, operator database or credential is created/read by the readability pass.
