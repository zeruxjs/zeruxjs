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
