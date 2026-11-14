import { createPinnedTransaction } from '@zeruxjs/db';
import type {
  DatabaseConnector,
  DatabaseExecutionContext,
  DatabaseTransaction,
  NormalizedConnectionConfig,
  PinnedTransactionAdapter,
} from '@zeruxjs/db';
import { compileSql, createSqlConnector } from '@zeruxjs/db-sql-core';
import { createManagedPool, pgPolicy, pgError } from './pool.js';
import type { PgConnectorOptions } from './pool.js';
import { createPgSessions } from './session.js';
import type { PgPoolStatus } from './session.js';
import { pgDialect } from './dialect.js';
export interface PgConnector extends DatabaseConnector {
  /** Actual pool-backed pinned runner; query-only injection rejects before callback invocation. */
  transaction: DatabaseTransaction;
  /** Read only fixed-label wrapper/native pool counters.
   * @returns {PgPoolStatus} No credentials, SQL, tenant labels or backend IDs.
   */
  getPoolStatus(): PgPoolStatus;
  /** Fence work and close this session owner, ending only an owned native pool.
   * @returns {Promise<void>} Idempotent receipt; injected uncooperative cleanup can exceed its observation deadline.
   */
  disconnect(): Promise<void>;
  /** Expose a privileged configured native handle only while open.
   * @returns {unknown} Trusted escape hatch bypassing structured/lifecycle guarantees.
   */
  getNativeConnection(): unknown;
}
/** Create one explicit native lease owner or compatible borrowed query-only wrapper.
 * @param {PgConnectorOptions} options - Trusted explicit connection/pool/executor settings.
 * @param {NormalizedConnectionConfig} connection - Optional private normalized connection identity.
 * @returns {Promise<PgConnector>} Closeable connector; injected pools remain host-owned.
 */
export async function createConnector(
  options: PgConnectorOptions = {},
  connection?: NormalizedConnectionConfig
): Promise<PgConnector> {
  /** Validated separate acquisition/query/statement/lock/shutdown limits. */
  const policy = pgPolicy(options);
  /** Private shallow configuration snapshot, never browser/public state. */
  const config = { ...options };
  /** Explicit native resource owner; injected transports remain borrowed. */
  const { pool, owned } = await createManagedPool(config);
  /** Whether the actual transport exposes a compatible pinned pool.connect API. */
  const native = typeof pool.connect === 'function';
  if (
    !native &&
    (config.statementTimeoutMs !== undefined ||
      config.lockTimeoutMs !== undefined)
  ) {
    throw pgError('PG_NATIVE_SETTINGS_UNAVAILABLE');
  }
  /** Scoped acquisition/lease/settings-reset owner, distinct from the native pool owner. */
  const sessions = createPgSessions(pool, owned, config);
  /** Private configured identity for direct connector execution. */
  const fallback = {
    connection: connection ?? {
      name: 'PostgreSQL',
      slug: 'default',
      connector: '@zeruxjs/db-pg',
      options: {},
    },
  };
  /** Shared SQL-core compatibility facade; operation compilation remains in its owner. */
  const base = createSqlConnector(pgDialect, {
    executor: (sql, params) => pool.query(sql, params),
  });
  /** Validate explicit connection identity before native dispatch.
   * @param {DatabaseExecutionContext} context - Private connection-bound controls.
   * @returns {void} Rejects malformed identity without selecting a driver from request input. */
  const validateContext = (context: DatabaseExecutionContext) => {
    if (
      !context ||
      typeof context !== 'object' ||
      !context.connection ||
      typeof context.connection.slug !== 'string' ||
      typeof context.connection.connector !== 'string'
    ) {
      throw pgError('INVALID_PG_EXECUTION_CONTEXT');
    }
  };
  /** Bind SQL-core normalization to one explicit native executor.
   * @param {(sql:string,params:unknown[])=>Promise<unknown>} run - Pinned or explicitly borrowed native dispatch.
   * @returns {ReturnType<typeof createSqlConnector>} Structured SQL facade using that exact executor. */
  const normalize = (
    run: (sql: string, params: unknown[]) => Promise<unknown>
  ) => createSqlConnector(pgDialect, { executor: run });
  /** Actual native pin extension; query-only transports cannot advertise it. */
  const adapter: PinnedTransactionAdapter | undefined = native
    ? {
        capabilities: {
          isolationLevels: [
            'read-committed',
            'read-uncommitted',
            'repeatable-read',
            'serializable',
          ],
          timeout: 'cooperative',
          savepoints: false,
          transactionalDdl: true,
        },
        /** Acquire and initialize one native client before exposing its pinned session.
         * @param {DatabaseExecutionContext} context - Explicit connection-bound controls.
         * @returns {Promise<import("@zeruxjs/db").PinnedTransactionSession>} Exact native pin; initialization failure destroys/finishes its lease.
         */
        async acquire(context) {
          validateContext(context);
          /** One acquired client held through native settlement, reset and release/discard. */
          const lease = await sessions.acquire(context);
          try {
            await lease.initialize(context);
          } catch (error) {
            await lease.terminate();
            try {
              await lease.finish();
            } catch (cleanup) {
              throw new AggregateError(
                [error, cleanup],
                'PostgreSQL acquisition cleanup failed'
              );
            }
            throw error;
          }
          let begun = false,
            done = false;
          return {
            /** Begin once with allowlisted isolation and transaction-local native settings.
             * @param {import("@zeruxjs/db").TransactionOptions} options - Negotiated isolation and cooperative lifetime policy.
             * @returns {Promise<void>} Native begin/settings receipt; no callback replay.
             */
            async begin(options) {
              if (
                !options ||
                typeof options !== 'object' ||
                Array.isArray(options)
              ) {
                throw pgError('INVALID_PG_TRANSACTION_OPTIONS');
              }
              /** Fixed allowlist of one-shot BEGIN isolation keywords. */
              const levels: Record<string, string> = {
                'read-uncommitted': 'READ UNCOMMITTED',
                'read-committed': 'READ COMMITTED',
                'repeatable-read': 'REPEATABLE READ',
                serializable: 'SERIALIZABLE',
              };
              if (
                begun ||
                (options.isolation !== undefined &&
                  !Object.hasOwn(levels, options.isolation))
              ) {
                throw pgError('INVALID_PG_TRANSACTION_OPTIONS');
              }
              /** Validated optional BEGIN isolation suffix; no arbitrary SQL is interpolated. */
              const isolation = options.isolation
                ? ` ISOLATION LEVEL ${levels[options.isolation]}`
                : '';
              begun = true;
              await lease.raw(`BEGIN${isolation}`, [], context);
              await lease.configure(context, true);
            },
            /** Compile before acquisition and execute on the exact selected lease.
             * @param {import("@zeruxjs/db").QueryOperation} operation - Structured operation checked by the shared compiler.
             * @param {DatabaseExecutionContext} ctx - Current pin-bound execution controls.
             * @returns {Promise<import("@zeruxjs/db").DatabaseResult>} Normalized private outcome; cleanup settles before exposure.
             */
            execute(operation, ctx) {
              validateContext(ctx);
              if (!begun || done) {
                throw pgError('PG_TRANSACTION_SCOPE_CLOSED');
              }
              return normalize((sql, params) =>
                lease.query(sql, params, ctx, true)
              ).execute(operation, ctx);
            },
            /** Commit only this acquired native transaction; failure marks it unusable.
             * @returns {Promise<void>} Native commit receipt or explicit indeterminate failure.
             */
            async commit() {
              if (!begun || done) {
                throw pgError('PG_TRANSACTION_SCOPE_CLOSED');
              }
              try {
                await lease.raw('COMMIT', [], context);
                done = true;
              } catch (error) {
                await lease.terminate();
                throw error;
              }
            },
            /** Confirm rollback only while the acquired client remains usable.
             * @returns {Promise<void>} Destructive cancellation cannot supply confirmed rollback.
             */
            async rollback() {
              if (lease.bad) {
                throw pgError('PG_ROLLBACK_UNCONFIRMED');
              }
              if (done) {
                return;
              }
              try {
                await lease.raw('ROLLBACK');
                done = true;
              } catch (error) {
                await lease.terminate();
                throw error;
              }
            },
            /** Terminate incomplete state and await the lease reset/release barrier.
             * @returns {Promise<void>} Native cleanup receipt.
             */
            async release() {
              if (begun && !done && !lease.bad) {
                await lease.terminate();
              }
              await lease.finish();
            },
          };
        },
      }
    : undefined;
  /** Inert shared pinned runner over this explicit native session adapter. */
  const transaction = adapter
    ? createPinnedTransaction(adapter, fallback.connection)
    : undefined;
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      transactions: native ? 'supported' : 'unsupported',
      cancellation: native ? 'supported' : 'unsupported',
    },
    ...(adapter ? { transactionAdapter: adapter } : {}),
    /** Compile before acquisition and execute on the exact selected lease.
     * @param {import("@zeruxjs/db").QueryOperation} operation - Structured operation checked by the shared compiler.
     * @param {DatabaseExecutionContext} context - Explicit connection-bound controls.
     * @returns {Promise<import("@zeruxjs/db").DatabaseResult>} Normalized private outcome; cleanup settles before exposure.
     */
    async execute(operation, context: DatabaseExecutionContext = fallback) {
      // Reject unsafe compiler input before any pool acquisition or settings mutation.
      compileSql(pgDialect, operation);
      validateContext(context);
      if (!native) {
        return sessions.legacy(
          () => Promise.resolve(base.execute(operation, context)),
          context
        );
      }
      /** One acquired client held through native settlement, reset and release/discard. */
      const lease = await sessions.acquire(context);
      /** Operation-wide client watchdog combined with the earlier request deadline. */
      const executionContext = {
        ...context,
        deadline: Math.min(
          context.deadline ?? Infinity,
          Date.now() + policy.queryTimeoutMs
        ),
      };
      let failure: unknown,
        failed = false,
        result;
      try {
        await lease.initialize(executionContext);
        result = await normalize((sql, params) =>
          lease.query(sql, params, executionContext)
        ).execute(operation, context);
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        try {
          await lease.finish();
        } catch (cleanup) {
          failure = failed
            ? new AggregateError(
                [failure, cleanup],
                'PostgreSQL execution cleanup failed'
              )
            : cleanup;
          failed = true;
        }
      }
      if (failed) {
        throw failure;
      }
      return result!;
    },
    transaction: (run, options) =>
      transaction
        ? transaction(run, options)
        : Promise.reject(pgError('UNSUPPORTED_PG_TRANSACTION')),
    getPoolStatus: sessions.status,
    disconnect: sessions.close,
    /** Expose a privileged configured native handle only while open.
     * @returns {unknown} Trusted escape hatch bypassing structured/lifecycle guarantees.
     */
    getNativeConnection() {
      if (sessions.status().closed) {
        throw pgError('PG_CONNECTOR_CLOSED');
      }
      return pool;
    },
  };
}
export type {
  PgConnectorOptions,
  PgPoolLike,
  PgPoolClientLike,
} from './pool.js';
export type { PgPoolStatus } from './session.js';
export default createConnector;
