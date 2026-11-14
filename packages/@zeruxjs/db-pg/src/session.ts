import type { DatabaseExecutionContext } from '@zeruxjs/db';
import type {
  PgPoolLike,
  PgPoolClientLike,
  PgConnectorOptions,
} from './pool.js';
import { pgPolicy, pgError } from './pool.js';
export interface PgPoolStatus {
  /** Whether this wrapper owns native pool shutdown. */
  owned: boolean;
  /** Permanent admission fence after close begins. */
  closed: boolean;
  /** Native connect promises retained until actual settlement. */
  pendingAcquisitions: number;
  /** Borrowed legacy work still pending, including timed-out caller waits. */
  legacyPending: number;
  /** Clients retained through reset/release/destructive settlement. */
  activeLeases: number;
  /** Fixed local count of acquisition observation deadlines. */
  acquisitionTimeouts: number;
  /** Fixed local count of destroyed clients released as unusable. */
  discarded: number;
  /** Count of abandoned acquisitions discarded after late arrival. */
  lateReleases: number;
  /** Fixed local lifecycle/native error count without raw payloads. */
  failures: number;
  /** Optional safe native pool total. */
  total?: number;
  /** Optional safe native pool idle count. */
  idle?: number;
  /** Optional safe native pool wait count. */
  waiting?: number;
}
type Context = Pick<DatabaseExecutionContext, 'signal' | 'deadline'>;
/** Fixed read-only query snapshotting the two timeout settings before lease use. */
const readSettings =
  "SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout";
/** Fixed parameterized session-setting update used for bounded work and restoration. */
const setSettings =
  "SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $2, false)";
/** Fixed parameterized transaction-local timeout update. */
const localSettings =
  "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)";
export interface PgSessionLease {
  /** True prohibits healthy reuse after connection/cancellation/reset uncertainty. */
  bad: boolean;
  /** Destroy this leased connection via public end and retain its actual settlement.
   * @returns {Promise<void>} Idempotent destructive shutdown, never healthy reuse.
   */
  terminate(): Promise<void>;
  /** Own one native query through watchdog/end/query settlement.
   * @param {string} sql - Prepared SQL or fixed module-owned control statement.
   * @param {unknown[]} params - Separate native parameter values.
   * @param {Context} context - Caller signal/deadline; combined with session-owner shutdown.
   * @returns {Promise<unknown>} Private native result; no client returns healthy while cancellation is in progress.
   */
  raw(sql: string, params?: unknown[], context?: Context): Promise<unknown>;
  /** Snapshot original native timeout settings before changing a lease.
   * @param {Context} context - Caller signal/deadline; combined with session-owner shutdown.
   * @returns {Promise<void>} Baseline strings retained for verified reset.
   */
  initialize(context?: Context): Promise<void>;
  /** Apply bounded native statement/lock settings, local only inside an actual transaction.
   * @param {Context} context - Caller signal/deadline; combined with session-owner shutdown.
   * @param {boolean} local - Use transaction-local settings only when inside an actual pin.
   * @returns {Promise<void>} Native setting completion.
   */
  configure(context: Context, local?: boolean): Promise<void>;
  /** Configure then execute one prepared statement on this exact native client.
   * @param {string} sql - Prepared SQL or fixed module-owned control statement.
   * @param {unknown[]} params - Separate native parameter values.
   * @param {Context} context - Caller signal/deadline; combined with session-owner shutdown.
   * @param {boolean} local - Use transaction-local settings only when inside an actual pin.
   * @returns {Promise<unknown>} Private native outcome after watchdog checks.
   */
  query(
    sql: string,
    params: unknown[],
    context: Context,
    local?: boolean
  ): Promise<unknown>;
  /** Await work/end, restore/read back settings when healthy, then release or discard once.
   * @returns {Promise<void>} Actual cleanup barrier; reset failures destroy the client.
   */
  finish(): Promise<void>;
}
export interface PgSessions {
  /** Bound queued acquisition while retaining native capacity until actual settlement.
   * @param {Context} context - Caller signal/deadline; combined with session-owner shutdown.
   * @returns {Promise<PgSessionLease>} Initialized-by-caller lease; late abandoned clients are discarded.
   */
  acquire(context?: Context): Promise<PgSessionLease>;
  /** Read fixed-label wrapper counters and validated optional pool totals.
   * @returns {PgPoolStatus} Current local ownership/queue/cleanup counters.
   */
  status(): PgPoolStatus;
  /** Bound caller waits on a borrowed query-only transport without native mutation/cancellation.
   * @param {() => Promise<T>} run - One trusted native query-only callback; never auto-replayed.
   * @param {Context} context - Caller signal/deadline; combined with session-owner shutdown.
   * @returns {Promise<T>} Caller result; native work remains counted until settlement.
   */
  legacy<T>(run: () => Promise<T>, context?: Context): Promise<T>;
  /** Fence work, terminate retained leases and end only an owned native pool.
   * @returns {Promise<void>} Observation receipt; cleanup can continue after shutdown timeout.
   */
  close(): Promise<void>;
}
/** Own native acquisition/settings/reset and destructive cleanup separately from pool ownership.
 * @param {PgPoolLike} pool - Explicit native-compatible or borrowed query-only pool.
 * @param {boolean} owned - Whether this owner must end the native pool.
 * @param {PgConnectorOptions} options - Trusted connector budget policy.
 * @returns {PgSessions} Closeable scoped owner; no native connection is acquired on construction.
 */
export function createPgSessions(
  pool: PgPoolLike,
  owned: boolean,
  options: PgConnectorOptions
): PgSessions {
  /** Validated phase budgets shared only within this session owner. */
  const policy = pgPolicy(options);
  /** Native client leases retained until reset/release or destructive discard settles. */
  const leases = new Set<PgLease>();
  /** Native pool acquisitions retained until actual settlement, including late arrivals. */
  const pending = new Set<Promise<unknown>>();
  /** Query-only borrowed operations retained after caller timeout until actual settlement. */
  const legacyWork = new Set<Promise<unknown>>();
  /** Session-owner cancellation scope, combined with each caller signal. */
  const shutdown = new AbortController();
  let closed = false,
    closing: Promise<void> | undefined,
    acquisitionTimeouts = 0,
    discarded = 0,
    lateReleases = 0,
    failures = 0;
  /** Count idle native errors without collecting SQL, backend IDs or credentials.

 * @returns {void} Only increments a fixed local diagnostic count. */
  const onPoolError = () => {
    failures++;
  };
  pool.on?.('error', onPoolError);
  /** Expose only safe bounded native pool counters.
   * @param {unknown} value - Candidate native count.
   * @returns {number|undefined} Safe count up to one million, otherwise absent. */
  const safeCount = (value: unknown) =>
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1000000
      ? value
      : undefined;
  /** Read path/value-free wrapper and optional native-pool counters.

 * @returns {PgPoolStatus} Current owned/closed/queue/lease/failure counters. */
  const status = (): PgPoolStatus => ({
    owned,
    closed,
    pendingAcquisitions: pending.size,
    legacyPending: legacyWork.size,
    activeLeases: leases.size,
    acquisitionTimeouts,
    discarded,
    lateReleases,
    failures,
    total: safeCount(pool.totalCount),
    idle: safeCount(pool.idleCount),
    waiting: safeCount(pool.waitingCount),
  });
  /** Validate request controls and combine them with session-owner shutdown.
   * @param {Context} ctx - Caller signal/deadline only.
   * @returns {Context} Fresh combined cooperative execution context. */
  const context = (ctx: Context): Context => {
    if (
      (ctx.signal !== undefined && !(ctx.signal instanceof AbortSignal)) ||
      (ctx.deadline !== undefined &&
        (!Number.isSafeInteger(ctx.deadline) || ctx.deadline < 0))
    ) {
      throw pgError('INVALID_PG_EXECUTION_CONTEXT');
    }
    return {
      signal: AbortSignal.any([
        shutdown.signal,
        ...(ctx.signal ? [ctx.signal] : []),
      ]),
      deadline: ctx.deadline,
    };
  };
  /** Bound queued acquisition while retaining native capacity until actual settlement.
   * @param {Context} raw - Uncombined caller controls before validation.
   * @returns {Promise<PgSessionLease>} Initialized-by-caller lease; late abandoned clients are discarded.
   */
  async function acquire(raw: Context = {}): Promise<PgLease> {
    /** Validated caller/shutdown controls; native work may outlive observation deadlines. */
    const ctx = context(raw);
    if (closed || ctx.signal?.aborted) {
      throw pgError('PG_ACQUIRE_CANCELLED');
    }
    if (pending.size + leases.size >= policy.maxPendingAcquires) {
      throw pgError('PG_POOL_SATURATED');
    }
    if (!pool.connect) {
      throw pgError('UNSUPPORTED_PG_PINNED_CLIENT');
    }
    /** Acquisition wait shortened by the request deadline, separate from query work. */
    const ms = Math.min(
      policy.acquireTimeoutMs,
      ctx.deadline === undefined ? Infinity : ctx.deadline - Date.now()
    );
    if (ms <= 0) {
      throw pgError('PG_ACQUIRE_TIMEOUT');
    }
    let abandoned = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      abort: () => void = () => {};
    /** Actual native acquisition promise retaining admission through settlement. */
    const source = Promise.resolve()
      .then(() => pool.connect!())
      .then((client) => {
        if (
          !client ||
          typeof client.query !== 'function' ||
          typeof client.release !== 'function' ||
          typeof client.end !== 'function'
        ) {
          try {
            client?.release?.(true);
          } catch {
            failures++;
          }
          throw pgError('INVALID_PG_POOL_CLIENT');
        }
        if (abandoned || closed) {
          lateReleases++;
          client.release(true);
          throw pgError('PG_ACQUIRE_CANCELLED');
        }
        /** Acquired native owner added only after validating the public client surface. */
        const lease = new PgLease(client);
        leases.add(lease);
        return lease;
      });
    pending.add(source);
    void source.finally(() => pending.delete(source)).catch(() => {});
    /** Caller-facing acquisition cancellation; abandoned native connect remains counted. */
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => {
        abandoned = true;
        reject(pgError('PG_ACQUIRE_CANCELLED'));
      };
      ctx.signal!.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        abandoned = true;
        acquisitionTimeouts++;
        reject(pgError('PG_ACQUIRE_TIMEOUT'));
      }, ms);
      if (ctx.signal!.aborted) {
        abort();
      }
    });
    try {
      return await Promise.race([source, cancelled]);
    } catch (error) {
      failures++;
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      ctx.signal!.removeEventListener('abort', abort);
    }
  }
  /** Exclusive native client owner; no healthy release precedes work/end/reset settlement. */
  class PgLease {
    /** Permanent unhealthy-state marker; prevents reuse after uncertainty. */
    bad = false;
    /** Exactly-once native release fence. */
    private released = false;
    /** Shared actual reset/release receipt. */
    private finishing?: Promise<void>;
    /** Shared destructive public end receipt, safe under reentry. */
    private ending?: Promise<void>;
    /** Private original native end failure, never a status label. */
    private endingError?: unknown;
    /** Separate presence bit preserving even falsy native failures. */
    private hasEndingError = false;
    /** Private native event cause for trusted failure diagnostics. */
    private connectionError?: unknown;
    /** Accepted native queries retained until their actual settlement. */
    private active = new Set<Promise<unknown>>();
    /** Original native timeout settings verified before healthy reuse. */
    private baseline?: { statement_timeout: string; lock_timeout: string };
    /** Mark this client unusable and initiate idempotent destructive cleanup.
     * @param {unknown} error - Private native failure, never status metadata.
     * @returns {void} Retains end settlement through the existing lease owner.
     */
    private onError = (error: unknown) => {
      this.bad = true;
      this.connectionError = error;
      failures++;
      void this.terminate();
    };
    /** Retain one native client and its exact lifecycle error listener.
     * @param {PgPoolClientLike} client - One native client exclusively owned by this lease until release.
     */
    constructor(private client: PgPoolClientLike) {
      client.on?.('error', this.onError);
    }
    /** Destroy this leased connection via public end and retain its actual settlement.
     * @returns {Promise<void>} Idempotent destructive shutdown, never healthy reuse.
     */
    terminate() {
      this.bad = true;
      return (this.ending ??= Promise.resolve().then(async () => {
        try {
          await this.client.end();
        } catch (error) {
          failures++;
          this.hasEndingError = true;
          this.endingError = error;
        }
      }));
    }
    /** Own one native query through watchdog/end/query settlement.
     * @param {string} sql - Prepared SQL or fixed module-owned control statement.
     * @param {unknown[]} params - Separate native parameter values.
     * @param {Context} rawContext - Explicit caller controls; cleanup can use its own context.
     * @returns {Promise<unknown>} Private native result; no client returns healthy while cancellation is in progress.
     */
    async raw(
      sql: string,
      params: unknown[] = [],
      rawContext: Context = {}
    ): Promise<unknown> {
      /** Validated caller/shutdown controls; native work may outlive observation deadlines. */
      const ctx = context(rawContext);
      if (this.released || this.bad || ctx.signal?.aborted) {
        throw pgError('PG_CLIENT_UNAVAILABLE', this.connectionError);
      }
      /** Client query watchdog shortened by the current request deadline. */
      const budget = Math.min(
        policy.queryTimeoutMs,
        ctx.deadline === undefined ? Infinity : ctx.deadline - Date.now()
      );
      if (budget <= 0) {
        throw pgError('PG_QUERY_TIMEOUT');
      }
      let aborted = false,
        timedOut = false;
      /** Terminate the leased native connection through its public end API.

 * @returns {void} Destructive cancellation begins; no healthy reuse is allowed. */
      const abort = () => {
        aborted = true;
        void this.terminate();
      };
      /** Owned phase timer removed on every caller terminal path. */
      const timer = setTimeout(() => {
        timedOut = true;
        abort();
      }, budget);
      ctx.signal!.addEventListener('abort', abort, { once: true });
      /** Actual native query/drain work, kept until settlement independently of caller waiting. */
      const work = Promise.resolve().then(() => {
        if (ctx.signal!.aborted) {
          abort();
          throw pgError('PG_QUERY_CANCELLED');
        }
        return this.client.query(sql, params);
      });
      this.active.add(work);
      try {
        /** Native query result returned only after destructive termination checks. */
        const value = await work;
        if (this.ending) {
          await this.ending;
        }
        if (aborted) {
          throw pgError(timedOut ? 'PG_QUERY_TIMEOUT' : 'PG_QUERY_CANCELLED');
        }
        if (this.bad) {
          throw pgError('PG_CLIENT_UNAVAILABLE', this.connectionError);
        }
        return value;
      } catch (error) {
        // Non-SQL errors (including pg query_timeout) cannot establish backend readiness.
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          typeof error.code !== 'string' ||
          !/^[0-9A-Z]{5}$/.test(error.code)
        ) {
          await this.terminate();
        }
        if (this.ending) {
          await this.ending;
        }
        if (aborted) {
          throw pgError(
            timedOut ? 'PG_QUERY_TIMEOUT' : 'PG_QUERY_CANCELLED',
            error
          );
        }
        throw error;
      } finally {
        this.active.delete(work);
        clearTimeout(timer);
        ctx.signal!.removeEventListener('abort', abort);
      }
    }
    /** Snapshot original native timeout settings before changing a lease.
     * @param {Context} ctx - Current validated cooperative context.
     * @returns {Promise<void>} Baseline strings retained for verified reset.
     */
    async initialize(ctx: Context = {}) {
      /** Native settings query response validated before snapshot/reset decisions. */
      const result = (await this.raw(readSettings, [], ctx)) as {
        rows?: Array<{ statement_timeout?: unknown; lock_timeout?: unknown }>;
      };
      /** One native timeout-settings record checked for exact string values. */
      const row = result?.rows?.[0];
      if (
        !row ||
        typeof row.statement_timeout !== 'string' ||
        typeof row.lock_timeout !== 'string'
      ) {
        throw pgError('PG_SETTINGS_UNAVAILABLE');
      }
      this.baseline = {
        statement_timeout: row.statement_timeout,
        lock_timeout: row.lock_timeout,
      };
    }
    /** Apply bounded native statement/lock settings, local only inside an actual transaction.
     * @param {Context} ctx - Current validated cooperative context.
     * @param {boolean} local - Use transaction-local settings only when inside an actual pin.
     * @returns {Promise<void>} Native setting completion.
     */
    async configure(ctx: Context, local = false) {
      /** Remaining server statement budget, clamped to a positive value. */
      const remaining =
        ctx.deadline === undefined
          ? policy.statementTimeoutMs
          : Math.max(1, ctx.deadline - Date.now());
      /** Smaller configured statement timeout or request lifetime. */
      const statement = Math.min(policy.statementTimeoutMs, remaining);
      /** Configured native lock timeout, preserving explicit zero-disable semantics. */
      const lock =
        policy.lockTimeoutMs === 0
          ? 0
          : Math.min(policy.lockTimeoutMs, statement);
      await this.raw(
        local ? localSettings : setSettings,
        [String(statement), String(lock)],
        ctx
      );
    }
    /** Configure then execute one prepared statement on this exact native client.
     * @param {string} sql - Prepared SQL or fixed module-owned control statement.
     * @param {unknown[]} params - Separate native parameter values.
     * @param {Context} ctx - Current validated cooperative context.
     * @param {boolean} local - Use transaction-local settings only when inside an actual pin.
     * @returns {Promise<unknown>} Private native outcome after watchdog checks.
     */
    async query(sql: string, params: unknown[], ctx: Context, local = false) {
      await this.configure(ctx, local);
      return this.raw(sql, params, ctx);
    }
    /** Await work/end, restore/read back settings when healthy, then release or discard once.
     * @returns {Promise<void>} Actual cleanup barrier; reset failures destroy the client.
     */
    finish() {
      return (this.finishing ??= Promise.resolve().then(async () => {
        try {
          await Promise.allSettled([...this.active]);
          if (this.ending) {
            await this.ending;
          }
          if (this.hasEndingError) {
            throw pgError('PG_END_FAILED', this.endingError);
          }
          if (!this.bad && this.baseline) {
            await this.raw(setSettings, [
              this.baseline.statement_timeout,
              this.baseline.lock_timeout,
            ]);
            /** Native settings query response validated before snapshot/reset decisions. */
            const result = (await this.raw(readSettings)) as {
              rows?: Array<{
                statement_timeout?: unknown;
                lock_timeout?: unknown;
              }>;
            };
            /** One native timeout-settings record checked for exact string values. */
            const row = result?.rows?.[0];
            if (
              row?.statement_timeout !== this.baseline.statement_timeout ||
              row.lock_timeout !== this.baseline.lock_timeout
            ) {
              throw pgError('PG_SETTINGS_RESET_FAILED');
            }
          }
        } catch (error) {
          failures++;
          await this.terminate();
          throw error;
        } finally {
          if (this.ending) {
            await this.ending;
          }
          this.released = true;
          this.client.off?.('error', this.onError);
          try {
            this.client.release(this.bad);
          } finally {
            leases.delete(this);
            if (this.bad) {
              discarded++;
            }
          }
        }
      }));
    }
  }
  return {
    acquire,
    status,
    /** Bound caller waits on a borrowed query-only transport without native mutation/cancellation.
     * @param {() => Promise<T>} run - One trusted native query-only callback; never auto-replayed.
     * @param {Context} raw - Uncombined caller controls before validation.
     * @returns {Promise<T>} Caller result; native work remains counted until settlement.
     */
    async legacy<T>(run: () => Promise<T>, raw: Context = {}): Promise<T> {
      /** Validated caller/shutdown controls; native work may outlive observation deadlines. */
      const ctx = context(raw);
      if (closed || ctx.signal?.aborted) {
        throw pgError('PG_QUERY_CANCELLED');
      }
      if (ctx.deadline !== undefined && ctx.deadline <= Date.now()) {
        throw pgError('PG_QUERY_TIMEOUT');
      }
      if (legacyWork.size >= policy.maxPendingAcquires) {
        throw pgError('PG_POOL_SATURATED');
      }
      /** Actual native query/drain work, kept until settlement independently of caller waiting. */
      const work = Promise.resolve().then(() => {
        if (ctx.signal!.aborted) {
          throw pgError('PG_QUERY_CANCELLED');
        }
        return run();
      });
      legacyWork.add(work);
      void work.finally(() => legacyWork.delete(work)).catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined,
        abort = () => {};
      /** Caller-facing legacy timeout/cancellation, never native operation completion. */
      const stopped = new Promise<never>((_, reject) => {
        abort = () => reject(pgError('PG_QUERY_CANCELLED'));
        ctx.signal!.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () => reject(pgError('PG_QUERY_TIMEOUT')),
          Math.max(
            1,
            Math.min(
              policy.queryTimeoutMs,
              ctx.deadline === undefined ? Infinity : ctx.deadline - Date.now()
            )
          )
        );
      });
      try {
        return await Promise.race([work, stopped]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        ctx.signal!.removeEventListener('abort', abort);
      }
    },
    /** Fence work, terminate retained leases and end only an owned native pool.
     * @returns {Promise<void>} Observation receipt; cleanup can continue after shutdown timeout.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      return (closing = Promise.resolve().then(async () => {
        shutdown.abort();
        /** Actual native query/drain work, kept until settlement independently of caller waiting. */
        const work = (async () => {
          /** Every destructive lease cleanup outcome retained before pool shutdown. */
          const results = await Promise.allSettled(
            [...leases].map(async (lease) => {
              await lease.terminate();
              await lease.finish();
            })
          );
          /** Private cleanup failures aggregated after every owned action was attempted. */
          const errors = results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map((r) => r.reason);
          try {
            if (owned) {
              await pool.end?.();
            }
          } catch (error) {
            errors.push(error);
          } finally {
            pool.off?.('error', onPoolError);
          }
          if (errors.length) {
            throw new AggregateError(
              errors,
              'PostgreSQL shutdown cleanup failed'
            );
          }
        })();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(pgError('PG_SHUTDOWN_TIMEOUT')),
                policy.shutdownTimeoutMs
              );
            }),
          ]);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      }));
    },
  };
}
