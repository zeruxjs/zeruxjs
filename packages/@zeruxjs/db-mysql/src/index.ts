import { createPinnedTransaction } from '@zeruxjs/db';
import type {
  DatabaseConnector,
  DatabaseTransaction,
  DatabaseExecutionContext,
  NormalizedConnectionConfig,
  PinnedTransactionAdapter,
  QueryOperation,
} from '@zeruxjs/db';
import { compileSql, createSqlConnector } from '@zeruxjs/db-sql-core';
import { createManagedPool, validateOptions } from './pool.js';
import type { MySqlConnectorOptions } from './pool.js';
import { mysqlDialect } from './dialect.js';
export type {
  MySqlConnectorOptions,
  MySqlPoolLike,
  MySqlConnectionLike,
} from './pool.js';
export interface MySqlConnector extends DatabaseConnector {
  /** Actual pool-backed pinned runner; query-only injection rejects before callback use. */
  transaction: DatabaseTransaction;
  /** Fence new work and await accepted work/acquisitions/pins before ending owned pools.
   * @returns {Promise<void>} Idempotent receipt; uncooperative native work can delay shutdown.
   */
  disconnect(): Promise<void>;
}
/** Create a scoped MySQL lease owner around explicit borrowed transports or a lazy owned pool.
 * @param {MySqlConnectorOptions} options - Trusted explicit native/transport settings; never browser claims.
 * @param {NormalizedConnectionConfig} connection - Optional private configured manager connection identity.
 * @returns {Promise<MySqlConnector>} Closeable wrapper; injected native pools are never ended.
 */
export async function createConnector(
  options: MySqlConnectorOptions = {},
  connection?: NormalizedConnectionConfig
): Promise<MySqlConnector> {
  /** Validated acquisition/admission ceilings, resolved before creating the native pool. */
  const limits = validateOptions(options);
  /** Explicit transport owner; injected pools/clients are never ended by this wrapper. */
  const { pool, owned } = await createManagedPool(options);
  /** Native pin lifetimes retained through final release or destructive discard. */
  const leases = new Set<Promise<void>>();
  /** Private connection identity used for direct calls without a manager context. */
  const fallback = {
    connection: connection ?? {
      name: 'MySQL',
      slug: 'default',
      connector: '@zeruxjs/db-mysql',
      options: {},
    },
  };
  let closed = false,
    closing: Promise<void> | undefined;
  /** Queued native acquisitions retaining capacity until actual settlement, even after timeout. */
  const pending = new Set<Promise<unknown>>();
  /** Accepted work retained until settlement before connector shutdown. */
  const active = new Set<Promise<unknown>>();
  /** Fence lifecycle/cancellation and validate the explicit execution context.
   * @param {DatabaseExecutionContext} ctx - Connection-bound controls outside operation JSON.
   * @returns {void} Cooperative fence only; native writes are not forcibly cancelled. */
  const check = (ctx: DatabaseExecutionContext) => {
    if (closed) {
      throw new Error('MySQL connector closed');
    }
    if (
      !ctx ||
      !ctx.connection ||
      typeof ctx.connection.slug !== 'string' ||
      typeof ctx.connection.connector !== 'string' ||
      (ctx.signal !== undefined && !(ctx.signal instanceof AbortSignal)) ||
      (ctx.deadline !== undefined &&
        (!Number.isSafeInteger(ctx.deadline) || ctx.deadline < 0))
    ) {
      throw new Error('Invalid MySQL execution context');
    }
    if (
      ctx.signal?.aborted ||
      (ctx.deadline !== undefined && ctx.deadline <= Date.now())
    ) {
      throw new Error('MySQL operation cancelled or deadline exceeded');
    }
  };
  /** Acquire one validated native lease with separate queued-capacity and deadline ownership.
   * @param {DatabaseExecutionContext} ctx - Connection-bound cooperative signal/deadline.
   * @returns {Promise<import("./pool.js").MySqlConnectionLike>} Native lease; late abandoned acquisitions release once before capacity frees.
   */
  async function acquire(ctx: DatabaseExecutionContext) {
    check(ctx);
    if (pending.size + leases.size >= limits.maxPendingAcquires) {
      throw new Error('MySQL acquisition capacity exceeded');
    }
    let abandoned = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    /** Actual native acquisition/operation promise retained independently from the caller race. */
    const work = Promise.resolve()
      .then(() => pool.getConnection!())
      .then((client) => {
        if (
          !client ||
          typeof client.execute !== 'function' ||
          typeof client.query !== 'function' ||
          typeof client.release !== 'function' ||
          typeof client.destroy !== 'function'
        ) {
          client?.destroy?.();
          throw new Error('Invalid MySQL pool connection');
        }
        if (abandoned || closed) {
          client.release();
          throw new Error('MySQL acquisition cancelled');
        }
        return client;
      });
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          abort = () => {
            abandoned = true;
            reject(new Error('MySQL acquisition cancelled'));
          };
          ctx.signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(
            () => {
              abandoned = true;
              reject(new Error('MySQL acquisition deadline exceeded'));
            },
            Math.max(
              1,
              Math.min(
                limits.acquireTimeoutMs,
                (ctx.deadline ?? Infinity) - Date.now()
              )
            )
          );
          if (ctx.signal?.aborted) {
            abort();
          }
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      ctx.signal?.removeEventListener('abort', abort);
    }
  }
  /** Explicit host FOUND_ROWS assertion, or matched default only for owned pools. */
  const mode = options.affectedRowsMode ?? (owned ? 'matched' : undefined);
  /** Bind one native executor to SQL-core normalization and MySQL count/precision policy.
   * @param {(sql:string,params:unknown[])=>Promise<[unknown,unknown]>} execute - Pinned or explicitly borrowed native execution callback.
   * @returns {(operation:QueryOperation,ctx:DatabaseExecutionContext)=>Promise<import("@zeruxjs/db").DatabaseResult>} Bound operation dispatcher without automatic retries. */
  const normalize =
    (
      execute: (sql: string, params: unknown[]) => Promise<[unknown, unknown]>
    ) =>
    async (operation: QueryOperation, ctx: DatabaseExecutionContext) => {
      let header: Record<string, unknown> | undefined;
      /** Normalized native result whose counts retain adapter/FOUND_ROWS semantics. */
      const result = await createSqlConnector(mysqlDialect, {
        executor: async (sql, params) => {
          /** Native rows/header unwrapped from mysql2 field metadata before SQL-core sees it. */
          const [value] = await execute(sql, params);
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            header = value as Record<string, unknown>;
          }
          // Rounded injected numbers cannot be repaired by converting them to strings.
          /** Bounded result-inspection worklist; precision lost by an injected parser is not repaired. */
          const queue: unknown[] = [value];
          /** Already inspected object identities; prevents cyclic native results from looping. */
          const seen = new WeakSet<object>();
          let visited = 0;
          // Bound result inspection before exposing native numeric values; no lossy repair is attempted.
          while (queue.length) {
            if (++visited > 100000) {
              throw new Error('MySQL result inspection limit exceeded');
            }
            /** Next native result node inspected without coercing unsafe numbers to strings. */
            const item = queue.pop();
            if (
              typeof item === 'number' &&
              Number.isInteger(item) &&
              !Number.isSafeInteger(item)
            ) {
              throw new Error('Unsafe MySQL integer result');
            }
            if (
              item &&
              typeof item === 'object' &&
              !seen.has(item) &&
              !ArrayBuffer.isView(item)
            ) {
              seen.add(item);
              // Retain each unseen native child within the fixed inspection ceiling.
              for (const value of Object.values(item)) {
                if (queue.length >= 100000) {
                  throw new Error('MySQL result inspection limit exceeded');
                }
                queue.push(value);
              }
            }
          }
          return value;
        },
      }).execute(operation, ctx);
      if (operation.op === 'update' && mode && header) {
        result.counts = {
          ...result.counts,
          affected: 'exact',
          affectedMeaning: mode,
        };
        if (mode === 'matched') {
          result.matchedCount = result.affectedCount;
          result.counts.matched = 'exact';
        } else {
          result.changedCount = result.affectedCount;
          result.counts.changed = 'exact';
        }
        // mysql2's changedRows is distinct from FOUND_ROWS affectedRows.
        if (
          Number.isSafeInteger(header.changedRows) &&
          Number(header.changedRows) >= 0
        ) {
          result.changedCount = Number(header.changedRows);
          result.counts.changed = 'exact';
        }
      }
      return result;
    };
  /** Actual pool-backed native pin extension; query-only injection leaves it absent. */
  const adapter: PinnedTransactionAdapter | undefined = pool.getConnection
    ? {
        capabilities: {
          isolationLevels: [
            'read-uncommitted',
            'read-committed',
            'repeatable-read',
            'serializable',
          ],
          timeout: 'cooperative',
          savepoints: false,
          transactionalDdl: false,
        },
        /** Acquire one validated native lease with separate queued-capacity and deadline ownership.
         * @param {DatabaseExecutionContext} ctx - Connection-bound cooperative signal/deadline.
         * @returns {Promise<import("./pool.js").MySqlConnectionLike>} Native lease; late abandoned acquisitions release once before capacity frees.
         */
        async acquire(ctx) {
          /** One acquired native pool lease, released or destroyed exactly once. */
          const client = await acquire(ctx);
          let complete!: () => void;
          /** Actual pin cleanup receipt used by shutdown/admission. */
          const lifetime = new Promise<void>((resolve) => {
            complete = resolve;
          });
          leases.add(lifetime);
          let begun = false,
            done = false,
            bad = false,
            released = false;
          /** Send transaction-control SQL only on this acquired lease; failures mark it unsafe for reuse.
           * @param {string} sql - Fixed internally generated transaction-control statement.
           * @param {unknown[]} params - Explicit native parameters, default empty.
           * @returns {Promise<[unknown,unknown]>} Native control outcome; failure requires destructive discard. */
          const run = async (sql: string, params: unknown[] = []) => {
            try {
              return await client.query(sql, params);
            } catch (error) {
              bad = true;
              throw error;
            }
          };
          return {
            /** Apply only an allowlisted one-shot isolation, then begin on the acquired lease.
             * @param {import("@zeruxjs/db").TransactionOptions} opts - Negotiated isolation and cooperative lifetime controls.
             * @returns {Promise<void>} Native begin receipt; no transactional DDL is advertised.
             */
            async begin(opts) {
              if (
                begun ||
                !opts ||
                typeof opts !== 'object' ||
                Array.isArray(opts)
              ) {
                throw new Error('Invalid MySQL transaction state');
              }
              /** Fixed allowlist translating shared isolation names to one-shot SET TRANSACTION values. */
              const levels: Record<string, string> = {
                'read-uncommitted': 'READ UNCOMMITTED',
                'read-committed': 'READ COMMITTED',
                'repeatable-read': 'REPEATABLE READ',
                serializable: 'SERIALIZABLE',
              };
              if (opts.isolation !== undefined) {
                if (!Object.hasOwn(levels, opts.isolation)) {
                  throw new Error('Invalid MySQL isolation');
                }
                await run(
                  `SET TRANSACTION ISOLATION LEVEL ${levels[opts.isolation]}`
                );
              }
              begun = true;
              await run('START TRANSACTION');
            },
            /** Compile/validate before acquisition and execute on the explicit current pin/lease.
             * @param {QueryOperation} op - Structured operation validated by SQL core before acquisition.
             * @param {DatabaseExecutionContext} context - Current pin-bound execution controls.
             * @returns {Promise<import("@zeruxjs/db").DatabaseResult>} Native normalized outcome with count/precision checks.
             */
            async execute(op, context) {
              if (!begun || done || released) {
                throw new Error('MySQL transaction closed');
              }
              check(context);
              return normalize((sql, params) => client.execute(sql, params))(
                op,
                context
              );
            },
            /** Commit only this acquired native transaction.
             * @returns {Promise<void>} Native receipt; failure can be indeterminate and poisons reuse.
             */
            async commit() {
              if (!begun || done || released) {
                throw new Error('MySQL transaction closed');
              }
              await run('COMMIT');
              done = true;
            },
            /** Roll back only an active uncommitted transaction.
             * @returns {Promise<void>} Native rollback receipt; failed cleanup still releases/discards.
             */
            async rollback() {
              if (!begun || done) {
                return;
              }
              await run('ROLLBACK');
              done = true;
            },
            /** Release healthy native state or destroy an uncertain connection exactly once.
             * @returns {void} Resolves the lease lifetime after final native cleanup initiation.
             */
            release() {
              if (released) {
                return;
              }
              released = true;
              try {
                if (bad || (begun && !done)) {
                  client.destroy();
                } else {
                  client.release();
                }
              } finally {
                leases.delete(lifetime);
                complete();
              }
            },
          };
        },
      }
    : undefined;
  /** Inert shared pinned runner over this explicit native adapter. */
  const transaction = adapter
    ? createPinnedTransaction(adapter, fallback.connection)
    : undefined;
  /** Shared SQL-core facade for compatibility methods; native calls still use this wrapper policy. */
  const base = createSqlConnector(mysqlDialect, {
    executor: async (sql, params) => (await pool.execute(sql, params))[0],
  });
  /** Retain accepted native work until actual settlement and enforce wrapper admission.
   * @param {() => Promise<T>} run - Trusted native-work callback or application transaction callback.
   * @returns {Promise<T>} Native completion; no automatic write/callback replay.
   */
  async function tracked<T>(run: () => Promise<T>): Promise<T> {
    if (active.size >= limits.maxPendingAcquires) {
      throw new Error('MySQL execution capacity exceeded');
    }
    /** Actual native acquisition/operation promise retained independently from the caller race. */
    const work = Promise.resolve().then(run);
    active.add(work);
    try {
      return await work;
    } finally {
      active.delete(work);
    }
  }
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      transactions: adapter ? 'supported' : 'unsupported',
      cancellation: 'unsupported',
    },
    ...(adapter ? { transactionAdapter: adapter } : {}),
    /** Compile/validate before acquisition and execute on the explicit current pin/lease.
     * @param {QueryOperation} op - Structured operation validated by SQL core before acquisition.
     * @param {DatabaseExecutionContext} ctx - Connection-bound cooperative signal/deadline.
     * @returns {Promise<import("@zeruxjs/db").DatabaseResult>} Native normalized outcome with count/precision checks.
     */
    execute(op, ctx = fallback) {
      compileSql(mysqlDialect, op);
      check(ctx);
      return tracked(async () => {
        if (!pool.getConnection) {
          return normalize((sql, params) => pool.execute(sql, params))(op, ctx);
        }
        /** One acquired native pool lease, released or destroyed exactly once. */
        const client = await acquire(ctx);
        let bad = false;
        try {
          check(ctx);
          return await normalize((sql, params) => client.execute(sql, params))(
            op,
            ctx
          );
        } catch (error) {
          bad = true;
          throw error;
        } finally {
          if (bad) {
            client.destroy();
          } else {
            client.release();
          }
        }
      });
    },
    /** Use the actual pool-backed native pin; query-only transport rejects.
     * @param {Parameters<DatabaseTransaction>[0]} run - Trusted application callback; use only its pinned facade.
     * @param {import("@zeruxjs/db").TransactionOptions} opts - Negotiated isolation and cooperative lifetime controls.
     * @returns {Promise<unknown>} Callback result after native commit/rollback/release, without replay.
     */
    transaction(run, opts) {
      check(fallback);
      return tracked(() =>
        transaction
          ? transaction(run, opts)
          : Promise.reject(new Error('MySQL pinned transactions unavailable'))
      );
    },
    /** Fence new work and await accepted work/acquisitions/pins before ending owned pools.
     * @returns {Promise<void>} Idempotent receipt; uncooperative native work can delay shutdown.
     */
    disconnect() {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        await Promise.allSettled([...active, ...pending, ...leases]);
        if (owned) {
          await pool.end?.();
        }
      }));
    },
    /** Expose the privileged configured pool only while the wrapper is open.
     * @returns {import("./pool.js").MySqlPoolLike} Native handle bypassing structured wrapper guarantees.
     */
    getNativeConnection() {
      if (closed) {
        throw new Error('MySQL connector closed');
      }
      return pool;
    },
  };
}
export default createConnector;
