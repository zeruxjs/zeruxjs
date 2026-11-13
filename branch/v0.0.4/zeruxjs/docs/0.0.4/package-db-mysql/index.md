# MySQL

Use MySQL2 pooling with the shared parameterized query model.


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

This package participates in the runtime's **database** integration. Start with [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Configure mysql2/promise pool options such as host, user, database and connectionLimit, or inject an existing pool/client/executor. Use the manager for application-level named operations. Parameter values use question-mark placeholders; the connector normalizes mysql2 row/metadata tuples rather than exposing the driver response as application rows.

## TypeScript: inputs, results and ownership

```ts
import { createConnector } from '@zeruxjs/db-mysql';

type Inputs = Parameters<typeof createConnector>;
type Result = Awaited<ReturnType<typeof createConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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

## Source ownership

Pool policy/borrowed ownership lives in `pool.ts`; native placeholders and dialect support live in `dialect.ts`; queued acquisitions, precision/count checks and pinned cleanup live in `index.ts`. Late acquisitions retain capacity until actual settlement and release exactly once. Trusted injected functions and native results are not sandboxed/public data. See the package README source map and distinguish local scripted/lazy-pool checks from live InnoDB deployment acceptance.


## Public entry points

Manifest reference for `@zeruxjs/db-mysql@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.4",
    "@zeruxjs/db-sql-core": "0.0.4",
    "mysql2": "^3.24.6"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/db-mysql

MySQL JSON-query connector using parameterized `?` placeholders and `mysql2/promise` (loaded only when needed).

```ts
import { createConnector } from '@zeruxjs/db-mysql';
const mysql = await createConnector({host:'localhost', user:'app', database:'demo', connectionLimit:10});
await mysql.disconnect();
```

Accepts injected `client`, `pool`, or `executor`. MySQL2-style `[rows, fields]` tuples are unwrapped before result normalization, avoiding falsely treating metadata as data rows. The adapter tracks whether it created the pool and never closes an externally owned pool. SQL statements are built by `@zeruxjs/db-sql-core` with placeholders rather than interpolating values. SQL DDL and multi-operation pipelines are not automatically atomic; use the pinned API below for supported transactional DML; DDL can implicitly commit.

## Pinned transactions

Pool-backed connectors expose the shared `transaction` and `transactionAdapter` contracts. Each callback reserves one `getConnection()` lease through START TRANSACTION, callback operations, COMMIT/ROLLBACK and release. Read-uncommitted/read-committed/repeatable-read/serializable use one-shot `SET TRANSACTION` isolation, without changing session defaults. No nested transactions/savepoints, automatic retries or transactional DDL are advertised. Tables must use a transactional engine such as InnoDB. The manager also consumes this adapter; use its transaction facade inside callbacks.

```ts
import { createConnector, type MySqlPoolLike } from '@zeruxjs/db-mysql';

export async function claim(pool: MySqlPoolLike, id: string, revision: number) {
  // The host must configure this injected pool with FOUND_ROWS enabled.
  const db = await createConnector({ pool, affectedRowsMode: 'matched',
    acquireTimeoutMs: 1000, maxPendingAcquires: 16 });
  try {
    return await db.transaction(async tx => {
      const result = await tx.update({ table: 'jobs', values: { revision: revision + 1 },
        where: { and: [ { field: 'id', operator: 'eq', value: id },
          { field: 'revision', operator: 'eq', value: revision } ] } });
      if (result.affectedCount !== 1) throw new Error('Claim conflict');
      return result.affectedCount;
    }, { isolation: 'read-committed', timeoutMs: 2000 });
  } finally { await db.disconnect(); }
}
```

Authorize the tenant/resource before this callback. The example assumes an existing application-owned jobs table and unique ID; counts do not authorize access. Importing/defining this function opens no connection.

## Budgets and cleanup

`acquireTimeoutMs` defaults to 5000 (1–60000 ms), `maxPendingAcquires` to 32 (1–1024), and owned `connectionLimit` to 10 (1–1024). Acquisition has its own deadline shortened by the request deadline/AbortSignal. Timed-out queued acquisitions retain their capacity until they actually settle; late unused connections are released once. Owned pools also set connectTimeout and a finite queueLimit. The wrapper bounds submissions; application-wide manager execution limits remain independently enforced.

Execution cancellation is **cooperative**, not native query cancellation: the shared transaction runner observes AbortSignal/deadlines, stops submissions, drains accepted native work, rolls back and releases. A running mysql2 Promise is never treated as forcibly cancelled, and cancellation capability remains unsupported. Timeout can therefore exceed its requested duration. Configure host/server query and lock budgets separately. Failed commit/rollback or incomplete transaction cleanup destroys the connection instead of returning uncertain state to the pool. A failed COMMIT may have an indeterminate outcome; never automatically retry a write. Disconnect rejects new work and waits for accepted work/leases before ending only owned pools; an uncooperative driver/callback can delay shutdown. Query-only injected clients/executors preserve the legacy API and reject pinned transactions.

## Counts, precision and TLS

Owned pools default to `affectedRowsMode: 'matched'` (FOUND_ROWS enabled). UPDATE affectedCount/matchedCount includes unchanged matches, with changedCount supplied separately when mysql2 provides changedRows. Set `'changed'` to disable FOUND_ROWS and make affectedCount/changedCount count changed rows. Zero remains zero. Advancing a version in a version-checked CAS avoids no-op ambiguity. Inserts/upserts/deletes retain engine-specific affectedRows semantics; no matched count is invented for them. Generic RETURNING is rejected by the compiler before acquisition.

For injected pools, affectedRowsMode is a **host assertion** about their handshake configuration, not a connection reconfiguration. Omit it to retain `affectedMeaning: 'engine'` and avoid claiming matched versus changed semantics. The wrapper cannot inspect or repair the host's FOUND_ROWS policy.

Owned pools set supportBigNumbers/bigNumberStrings true and decimalNumbers false: BIGINT and DECIMAL remain strings, including insert IDs beyond safe integer precision. Ordinary safe numeric columns keep mysql2 types. Disabling this policy is rejected. Injected transports own their parsers; unsafe integer numbers are rejected rather than converted after precision was lost. Result inspection is bounded to 100000 visited values. Fractional values already rounded by an injected parser cannot be recovered; configure its decimal policy before use. No global parsers are changed.

Multiple statements are always disabled; requesting them rejects before pool creation. TLS is explicit through an ssl object (for example `{ ca: process.env.DB_CA }`); certificate and hostname verification are enabled for owned pools. Insecure verification flags and deprecated string profiles reject. Omitted ssl retains local/plain transport compatibility; configure TLS for remote hosts. Injected transports retain host-owned TLS, parser, engine and multi-statement policies. Driver errors/SQL/native results are trusted internal data: sanitize at your HTTP boundary, never serialize them to clients.

See the official [pool ownership](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool) and [TLS configuration](https://sidorares.github.io/node-mysql2/docs/documentation/ssl) documentation. Offline fixtures prove orchestration only. Opt-in live acceptance requires `ZX_TEST_MYSQL_URL` pointing to a disposable MySQL database; no application database or server is started automatically.

## Implementation and ownership map

- `src/pool.ts` validates trusted connection/precision/TLS policy and separates lazy owned pools from borrowed pool/client/executor transports. Injected client tuple handling retains its existing compatibility heuristic.
- `src/dialect.ts` owns MySQL quoting/placeholders and the explicit SQL-core support subset. It never interpolates parameter values.
- `src/index.ts` owns queued acquisitions, late-lease release, accepted native work, exact count/precision checks and transaction-control/session cleanup. A failed transaction-control statement poisons reuse; uncertain connections are destroyed rather than returned as healthy.

Root runtime imports require Node. Native executors/pools/options are trusted host configuration and are not sandboxed. Borrowed transports retain handshake/TLS/parser policy; declaring affectedRowsMode does not change their native handshake. Native results/errors/SQL/parameters remain private until the host sanitizes them. The wrapper cannot recover an already rounded injected number or force-cancel native JavaScript.

Offline fixtures use scripted leases and a lazily configured owned pool without issuing network requests. Packed public imports and the borrowed-pool example check the actual declarations. Live InnoDB rollback/precision/TLS/server semantics require the separately configured dedicated MySQL acceptance endpoint.


## Implementation sources

- [packages/@zeruxjs/db-mysql/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-mysql/README.md)
- [packages/@zeruxjs/db-mysql/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-mysql/package.json)
