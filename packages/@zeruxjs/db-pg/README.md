# @zeruxjs/db-pg

PostgreSQL JSON-query connector. Database operations compile to parameterized SQL using `$1`, `$2`, etc.

```ts
import { createConnector } from '@zeruxjs/db-pg';
const pg = await createConnector({connectionString:process.env.DATABASE_URL, max:10});
// Execute normalized operations via a @zeruxjs/db manager, or `connector.execute(operation, context)`.
await pg.disconnect();
```

Accepts injected `pool`, `client`, or `executor` for tests and managed connections. Connectors close only pools they created; external clients are not closed. The dialect and pool lifecycle live in separate modules. Enable PostgreSQL TLS on untrusted networks. Use the pinned transaction API below for multi-operation atomicity; a JSON operation array alone is not a transaction.

## Pinned transactions and request ownership

Pool-backed connectors now implement the shared `PinnedTransactionAdapter` contract. `manager.transaction(fn, options)`, `facade.transaction`, or the explicit connector's `transaction` reserve one pool client through BEGIN, all callback operations, COMMIT/ROLLBACK, settings reset and release. They never use unpinned pool.query for transaction work. Negotiation accepts read-uncommitted/read-committed/repeatable-read/serializable; PostgreSQL treats read-uncommitted as read-committed. Nesting/savepoints and transparent retries remain unsupported. Standard transactional table/index DDL is supported; CREATE/DROP DATABASE and switching databases remain excluded inside a pin by the shared contract.

Injected pools need the standard `connect(): Promise<PoolClient>` API with client `query`, `end` and `release` methods to advertise transactions/cancellation. A query-only pool/client/executor preserves the legacy interface and remains caller-owned, with both capabilities unsupported. Injection is a trusted executable adapter contract, not proof of a real backend. Original errors and causes remain private; use host-owned sanitized API errors instead of serializing SQL/results or driver errors.

```ts
import { createConnector, type PgPoolLike } from '@zeruxjs/db-pg';

// Supply an explicitly configured pg-compatible pool; the host owns its shutdown.
export async function claim(pool: PgPoolLike, jobId: string, expectedRevision: number) {
  const connector = await createConnector({ pool,
    acquireTimeoutMs: 1000, statementTimeoutMs: 2000,
    queryTimeoutMs: 3000, maxPendingAcquires: 16
  });
  try {
    return await connector.transaction(async tx => {
      const result = await tx.update({ table: 'jobs',
        values: { revision: expectedRevision + 1 },
        where: { and: [
          { field: 'id', operator: 'eq', value: jobId },
          { field: 'revision', operator: 'eq', value: expectedRevision }
        ] }, returning: ['id', 'revision'] });
      if (result.affectedCount !== 1) throw new Error('Claim conflict');
      return result.rows;
    }, { isolation: 'read-committed', timeoutMs: 2500 });
  } finally {
    await connector.disconnect(); // releases this wrapper; does not end the injected pool
  }
}
```

Authorize tenant/resource access before this callback. A successful transaction or row count is not authorization. The example assumes an application-owned jobs schema with verified column types and uniqueness; it neither creates an application nor contacts a database until the host calls it with a configured pool. Owned pools are created from connection settings and connect lazily; importing this module starts no telemetry/network service.

## Separate acquisition, execution and cleanup phases

The connector validates configuration and compiles direct operations before acquiring resources. Native-compatible pool operations lease one client per complete structured operation, including multi-statement DDL. Acquisition and execution are separate bounded phases:

| Option | Default | Allowed | Meaning |
| --- | --- | --- | --- |
| acquireTimeoutMs | 5000 | 1–60000 ms | Wait for pool.connect independently of statement work |
| maxPendingAcquires | 32 | 1–1024 | Bound this connector's combined native acquisitions/leases, or legacy in-flight waits |
| statementTimeoutMs | 10000 | 1–600000 ms | Server statement_timeout, shortened by request deadlines |
| queryTimeoutMs | 15000 | 1–600000 ms | Client watchdog; ordinary operation execution also shares this phase budget |
| lockTimeoutMs | 5000 | 0–600000 ms | Server lock_timeout; zero disables only the lock-specific limit |
| shutdownTimeoutMs | 5000 | 1–60000 ms | Bound waiting for wrapper cleanup/owned pool shutdown |
| max | 10 | 1–1024 | Owned pg pool size; injected pool sizing remains host-owned |

Owned pools also use pg's documented connectionTimeoutMillis. Early wrapper timeout/abort cannot remove an arbitrary pg queued acquisition, so its slot remains occupied until connect actually settles; a late client is discarded with release(true), never handed to a cancelled request. Caller-owned pools are never ended by this connector. Shutdown aborts its leases and rejects new work; cleanup may continue after a shutdown-timeout rejection if an injected adapter ignores termination. No arbitrary Promise is forcibly cancelled, and no user-managed application is restarted.

Before using a lease, the connector snapshots statement_timeout and lock_timeout. Ordinary operations install bounded session settings; transactions use SET LOCAL through parameterized set_config. Commit/rollback is followed by restoring and reading back the original settings before a healthy release. A reset mismatch/failure discards the client. The callback's structured facade cannot set arbitrary session/role/search_path state; previously captured native handles remain privileged host-owned escape hatches. Do not mutate a leased session through another reference or release it independently.

## Cancellation and failure semantics

The installed pg promise query API has no documented AbortSignal hook; this connector does not invent one or use pg private cancellation fields. Server statement_timeout/lock_timeout enforce backend query budgets. AbortSignal or the client watchdog uses the public client.end() API to terminate the leased connection, waits for query/end settlement, and releases it only as destroyed. This is **destructive cancellation**, not a reusable-client CancelRequest protocol implementation. Network failure/client-side pg query_timeout cannot establish backend readiness and also causes destruction. Choose queryTimeoutMs with enough headroom for server cancellation/response latency if preserving connections matters. See [pg client settings](https://node-postgres.com/apis/client) and [pool release ownership](https://node-postgres.com/apis/pool).

No client returns to the healthy pool while cancellation or rollback is in progress. A backend statement timeout can leave an aborted transaction; normal rollback must complete before reset/reuse. Destructive abort loses explicit rollback confirmation and reports PG_ROLLBACK_UNCONFIRMED through shared cleanup errors. A timeout/disconnect or failed COMMIT can leave write outcome indeterminate; never retry automatically without an application idempotency policy. An uncooperative injected client whose end/query promises never settle retains its lease rather than allowing unsafe reuse. Server policies and native protocol behavior still require live acceptance.

Query-only injected transports receive a bounded caller wait, but no native settings or termination are applied to their borrowed resource. An outstanding legacy operation remains counted in legacyPending until it actually settles. Explicit server timeout options reject for those transports instead of being silently ignored. Capability cancellation remains unsupported there.

`getPoolStatus()` returns only owned/closed state, safe total/idle/waiting counters when supplied by pg, pending acquisitions, legacy waits, active leases, discarded/late-client counts, acquisition timeouts and failure counters. No connection URLs, credentials, tenant labels, SQL, parameters or backend identifiers are returned. Counters describe this wrapper and optional shared-pool totals, not a distributed utilization guarantee; idle pool/client errors are consumed for lifecycle safety and reflected without payloads.

Affected counts continue to come from rowCount, including zero-row CAS misses; rows/RETURNING and PostgreSQL placeholder ordering are still normalized by SQL-core. NUMERIC/DECIMAL and int8 retain pg's configured parser behavior, commonly strings; timestamp/timezone interpretation is still a driver/application policy. No global type parsers are installed. Tests use injected pool clients for deterministic failure/cleanup checks. `test/pg-live.test.mjs` is opt-in through ZX_TEST_PG_URL for a dedicated disposable database and uses random table names; without that prerequisite native transaction, cancellation and numeric precision acceptance is explicitly skipped.
