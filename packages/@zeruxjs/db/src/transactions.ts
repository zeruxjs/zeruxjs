import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  DatabaseExecutionContext,
  DatabaseResult,
  QueryOperation,
  MaybePromise,
  DatabaseQueryOptions,
  DatabaseFacade,
} from './types.js';
import { createDatabaseError } from './utils.js';
import { queryOptions } from './execution.js';
export type TransactionIsolation =
  | 'read-uncommitted'
  | 'read-committed'
  | 'repeatable-read'
  | 'serializable'
  | 'snapshot';
export interface TransactionOptions extends Pick<
  DatabaseQueryOptions,
  'signal' | 'deadline' | 'timeoutMs'
> {
  /** Explicit supported isolation; omitted uses the documented adapter default. */
  isolation?: TransactionIsolation;
}
export interface PinnedTransactionCapabilities {
  /** Declared native guarantees, maximum five; never synthesized. */
  isolationLevels: readonly TransactionIsolation[];
  /** Cooperative native lifetime policy or explicitly unsupported. */
  timeout: 'cooperative' | 'unsupported';
  /** Always false for this shared contract; nesting rejects. */
  savepoints: false;
  /** True only when this adapter actually rolls back its supported DDL. */
  transactionalDdl: boolean;
}
/** Adapter methods must all target the acquired native connection/session. Acquire failures own their partial cleanup. */
export interface PinnedTransactionSession {
  /** Begin on the acquired native connection/session only.
   * @param {TransactionOptions} options - Explicit isolation and cooperative caller controls; omitted isolation uses native default.
   * @param {DatabaseExecutionContext} context - Connection-bound cooperative signal/deadline passed to the native pin.
   * @returns {MaybePromise<void>} Native begin completion; no pool re-routing.
   */
  begin(
    options: TransactionOptions,
    context: DatabaseExecutionContext
  ): MaybePromise<void>;
  /** Execute on this same acquired pin with cooperative query controls.
   * @param {QueryOperation} operation - Validated JSON operation; no cross-connection routing.
   * @param {DatabaseExecutionContext} context - Connection-bound cooperative signal/deadline passed to the native pin.
   * @returns {MaybePromise<DatabaseResult>} Native operation result; no callback replay.
   */
  execute(
    operation: QueryOperation,
    context: DatabaseExecutionContext
  ): MaybePromise<DatabaseResult>;
  /** Commit this acquired session once.
   * @returns {MaybePromise<void>} Native commit receipt; failure can be indeterminate.
   */
  commit(): MaybePromise<void>;
  /** Roll back this acquired session after failure.
   * @returns {MaybePromise<void>} Native rollback receipt; release must still follow failure.
   */
  rollback(): MaybePromise<void>;
  /** Return or discard the acquired native session exactly once after settlement.
   * @returns {MaybePromise<void>} Native cleanup receipt, not proof a prior commit was undone.
   */
  release(): MaybePromise<void>;
}
export interface PinnedTransactionAdapter {
  /** Native pin guarantees checked before acquisition. */
  readonly capabilities: PinnedTransactionCapabilities;
  /** Acquire one native connection/session and own any partial acquisition failure.
   * @param {DatabaseExecutionContext} context - Connection-bound cooperative signal/deadline passed to the native pin.
   * @returns {MaybePromise<PinnedTransactionSession>} Exclusive native pin; every session operation must target it.
   */
  acquire(
    context: DatabaseExecutionContext
  ): MaybePromise<PinnedTransactionSession>;
}
export type TransactionDatabase = Omit<DatabaseFacade, 'native' | 'options'> & {
  readonly signal: AbortSignal;
  transaction<T>(
    run: (db: TransactionDatabase) => MaybePromise<T>,
    options?: TransactionOptions
  ): Promise<T>;
};
export type DatabaseTransaction = <T>(
  run: (db: TransactionDatabase) => MaybePromise<T>,
  options?: TransactionOptions
) => Promise<T>;
/** Async-local owner guard preventing callback access through an unpinned outer manager. */
const owners = new AsyncLocalStorage<object>();
/** Check whether this async callback already owns the specified manager/runner.
 * @param {object} owner - Stable private manager identity.
 * @returns {boolean} Whether unpinned/reentrant operations must reject. */
export const ownsTransaction = (owner: object) => owners.getStore() === owner;
/** Create fixed transaction diagnostics with private failure detail.
 * @param {string} code - Stable internal classification.
 * @param {unknown} cause - Optional private original failure.
 * @returns {Error & {details: import('./types.js').DatabaseErrorShape}} Abstraction error; commit failure can be indeterminate. */
export const transactionError = (code: string, cause?: unknown) =>
  createDatabaseError({
    code,
    message:
      (
        {
          UNSUPPORTED_TRANSACTION: 'Pinned transactions are unavailable',
          INVALID_TRANSACTION_OPTIONS: 'Invalid transaction options',
          UNSUPPORTED_ISOLATION: 'Transaction isolation is unavailable',
          UNSUPPORTED_TRANSACTION_TIMEOUT: 'Transaction timeout is unavailable',
          NESTED_TRANSACTION_UNSUPPORTED:
            'Nested transactions require an explicit savepoint implementation',
          TRANSACTION_SCOPE_CLOSED: 'Transaction callback scope is closed',
          TRANSACTION_SCOPE_REQUIRED:
            'Use the pinned transaction facade inside its callback',
          TRANSACTION_ROLLBACK_ONLY: 'Transaction is rollback-only',
          TRANSACTION_COMMIT_FAILED:
            'Transaction commit failed; outcome may be indeterminate',
          TRANSACTION_ABORTED: 'Transaction cancelled or deadline exceeded',
          TRANSACTION_DDL_UNSUPPORTED: 'Transactional DDL is unavailable',
        } as Record<string, string>
      )[code] ?? 'Transaction failed',
    ...(cause !== undefined ? { cause } : {}),
  });
/** Validate isolation/cancellation/deadline before any lease acquisition.
 * @param {TransactionOptions} options - Explicit isolation and cooperative caller controls; omitted isolation uses native default.
 * @returns {TransactionOptions} Validated options with resolved absolute deadline.
 */
export function validateTransactionOptions(options: TransactionOptions = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (k) => !['isolation', 'signal', 'deadline', 'timeoutMs'].includes(k)
    )
  ) {
    throw transactionError('INVALID_TRANSACTION_OPTIONS');
  }
  if (
    options.isolation !== undefined &&
    ![
      'read-uncommitted',
      'read-committed',
      'repeatable-read',
      'serializable',
      'snapshot',
    ].includes(options.isolation)
  ) {
    throw transactionError('INVALID_TRANSACTION_OPTIONS');
  }
  /** Validated negotiation/deadline snapshot before resource acquisition. */
  const parsed = queryOptions({
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.deadline !== undefined ? { deadline: options.deadline } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  return { ...options, ...parsed };
}
/** Require declared pin/isolation/timeout support without acquiring a resource.
 * @param {PinnedTransactionAdapter | undefined} adapter - Explicit host/connector-provided pin implementation.
 * @param {TransactionOptions} options - Explicit isolation and cooperative caller controls; omitted isolation uses native default.
 * @returns {TransactionOptions} Validated negotiated options; no downgrade or savepoint emulation.
 */
export function negotiateTransaction(
  adapter: PinnedTransactionAdapter | undefined,
  options: TransactionOptions = {}
) {
  if (!adapter || typeof adapter.acquire !== 'function') {
    throw transactionError('UNSUPPORTED_TRANSACTION');
  }
  /** Adapter-declared pin/isolation/DDL guarantees, checked before use. */
  const caps = adapter.capabilities;
  /** Explicit supported isolation vocabulary; no implicit downgrade. */
  const isolation = [
    'read-uncommitted',
    'read-committed',
    'repeatable-read',
    'serializable',
    'snapshot',
  ];
  if (
    !caps ||
    !Array.isArray(caps.isolationLevels) ||
    caps.isolationLevels.length > 5 ||
    caps.isolationLevels.some((v) => !isolation.includes(v)) ||
    !['cooperative', 'unsupported'].includes(caps.timeout) ||
    caps.savepoints !== false ||
    typeof caps.transactionalDdl !== 'boolean'
  ) {
    throw transactionError('UNSUPPORTED_TRANSACTION');
  }
  /** Validated negotiation/deadline snapshot before resource acquisition. */
  const parsed = validateTransactionOptions(options);
  if (
    options.isolation !== undefined &&
    !caps.isolationLevels.includes(options.isolation)
  ) {
    throw transactionError('UNSUPPORTED_ISOLATION');
  }
  if (parsed.deadline !== undefined && caps.timeout !== 'cooperative') {
    throw transactionError('UNSUPPORTED_TRANSACTION_TIMEOUT');
  }
  return { ...options, ...parsed };
}
/** Retain one native session through FIFO work, commit/rollback and release settlement.
 * @param {object} owner - Private manager/runner identity for async reentry guards.
 * @param {PinnedTransactionAdapter} adapter - Explicit host/connector-provided pin implementation.
 * @param {DatabaseExecutionContext} context - Connection-bound cooperative signal/deadline passed to the native pin.
 * @param {(db: TransactionDatabase) => MaybePromise<T>} run - Trusted application callback; accepted work drains before commit/release.
 * @param {(execute: PinnedTransactionSession['execute']) => DatabaseFacade} facade - Factory binding all query dispatch to the supplied pinned execute function.
 * @param {TransactionOptions} options - Explicit isolation and cooperative caller controls; omitted isolation uses native default.
 * @returns {Promise<T>} Callback result only after cleanup; commit failure may be indeterminate.
 */
export async function runPinnedTransaction<T>(
  owner: object,
  adapter: PinnedTransactionAdapter,
  context: DatabaseExecutionContext,
  run: (db: TransactionDatabase) => MaybePromise<T>,
  facade: (execute: PinnedTransactionSession['execute']) => DatabaseFacade,
  options: TransactionOptions = {}
): Promise<T> {
  if (ownsTransaction(owner)) {
    throw transactionError('NESTED_TRANSACTION_UNSUPPORTED');
  }
  /** Validated negotiation/deadline snapshot before resource acquisition. */
  const parsed = negotiateTransaction(adapter, options);
  if (typeof run !== 'function') {
    throw transactionError('INVALID_TRANSACTION_OPTIONS');
  }
  /** Transaction-owned cooperative cancellation retained through rollback/release. */
  const controller = new AbortController();
  /** Signal cancellation without releasing the native lease prematurely.

 * @returns {void} Only aborts the transaction-owned signal. */
  const abort = () => controller.abort();
  if (
    parsed.signal?.aborted ||
    (parsed.deadline !== undefined && parsed.deadline <= Date.now())
  ) {
    throw transactionError('TRANSACTION_ABORTED');
  }
  parsed.signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (parsed.deadline !== undefined) {
    timer = setTimeout(abort, Math.max(0, parsed.deadline - Date.now()));
  }
  /** Connection-bound execution context passed to the acquired pin. */
  const ctx = {
    ...context,
    signal: controller.signal,
    deadline: parsed.deadline,
  };
  let session: PinnedTransactionSession | undefined,
    scopeOpen = true,
    begun = false,
    committed = false,
    failed = false,
    commitAttempt = false;
  /** Accepted native/facade promises drained before commit, rollback or release. */
  const pending = new Set<Promise<unknown>>();
  let tail: Promise<unknown> = Promise.resolve();
  let failure: unknown,
    value: T | undefined,
    hasFailure = false;
  /** Fence captured facade use after callback closure, cancellation or deadline.

 * @returns {void} Rejects stale scope without unpinning accepted work. */
  const check = () => {
    if (!scopeOpen) {
      throw transactionError('TRANSACTION_SCOPE_CLOSED');
    }
    if (
      controller.signal.aborted ||
      (parsed.deadline !== undefined && parsed.deadline <= Date.now())
    ) {
      throw transactionError('TRANSACTION_ABORTED');
    }
  };
  try {
    session = await adapter.acquire(ctx);
    if (
      !session ||
      ['begin', 'execute', 'commit', 'rollback', 'release'].some(
        (k) => typeof (session as any)[k] !== 'function'
      )
    ) {
      throw transactionError('UNSUPPORTED_TRANSACTION');
    }
    check();
    begun = true;
    await session.begin(parsed, ctx);
    check();
    /** Facade whose execute path targets only the acquired native session. */
    const base = facade((operation, queryContext) => {
      check();
      if (
        operation.connection !== undefined &&
        operation.connection !== context.connection.slug
      ) {
        throw transactionError('TRANSACTION_SCOPE_REQUIRED');
      }
      if (
        ['createDb', 'dropDb', 'switchDB'].includes(operation.op) ||
        (!adapter.capabilities.transactionalDdl &&
          [
            'createTable',
            'dropTable',
            'alterTable',
            'turcunateTable',
            'createIndex',
            'dropIndex',
          ].includes(operation.op))
      ) {
        throw transactionError('TRANSACTION_DDL_UNSUPPORTED');
      }
      /** Combined transaction/query cancellation; native cooperation remains adapter-owned. */
      const signal = AbortSignal.any([
        controller.signal,
        ...(queryContext.signal ? [queryContext.signal] : []),
      ]);
      /** FIFO lease work; any failure marks the enclosing scope rollback-only. */
      const tracked = tail
        .then(() => {
          if (failed) {
            throw transactionError('TRANSACTION_ROLLBACK_ONLY');
          }
          if (signal.aborted) {
            throw transactionError('TRANSACTION_ABORTED');
          }
          return session!.execute(operation, {
            ...queryContext,
            signal,
            deadline:
              Math.min(
                parsed.deadline ?? Infinity,
                queryContext.deadline ?? Infinity
              ) === Infinity
                ? undefined
                : Math.min(
                    parsed.deadline ?? Infinity,
                    queryContext.deadline ?? Infinity
                  ),
          });
        })
        .then(
          (value) => {
            if (!value.ok) {
              failed = true;
            }
            return value;
          },
          (error) => {
            failed = true;
            throw error;
          }
        );
      tail = tracked.catch(() => {});
      pending.add(tracked);
      void tracked.finally(() => pending.delete(tracked)).catch(() => {});
      return tracked;
    });
    /** Frozen public transaction facade omitting private options and native escape hatches. */
    const tx: any = {
      slug: base.slug,
      name: base.name,
      connector: base.connector,
      signal: controller.signal,
      capabilities: base.capabilities,
      transaction: async () => {
        throw transactionError('NESTED_TRANSACTION_UNSUPPORTED');
      },
    };
    // Expose only the fixed facade methods; every accepted promise participates in final drain.
    for (const name of [
      'query',
      'createDb',
      'dropDb',
      'switchDB',
      'createTable',
      'dropTable',
      'alterTable',
      'turcunateTable',
      'createIndex',
      'dropIndex',
      'insert',
      'select',
      'update',
      'delete',
    ] as const) {
      tx[name] = (...args: unknown[]) => {
        check();
        try {
          /** Accepted facade result; synchronous and asynchronous failures both poison the scope. */
          const result = (base[name] as (...args: any[]) => any)(...args);
          /** Observed facade promise retained so fire-and-forget work drains before commit. */
          const observed = Promise.resolve(result).catch((error) => {
            failed = true;
            throw error;
          });
          pending.add(observed);
          void observed.finally(() => pending.delete(observed)).catch(() => {});
          return observed;
        } catch (error) {
          failed = true;
          throw error;
        }
      };
    }
    value = await owners.run(owner, () => run(Object.freeze(tx)));
    check();
    scopeOpen = false;
    await Promise.allSettled([...pending]);
    if (failed) {
      throw transactionError('TRANSACTION_ROLLBACK_ONLY');
    }
    if (
      controller.signal.aborted ||
      (parsed.deadline !== undefined && parsed.deadline <= Date.now())
    ) {
      throw transactionError('TRANSACTION_ABORTED');
    }
    commitAttempt = true;
    await session.commit();
    committed = true;
  } catch (error) {
    hasFailure = true;
    if (commitAttempt) {
      failure = transactionError('TRANSACTION_COMMIT_FAILED', error);
    } else if (controller.signal.aborted) {
      failure = transactionError('TRANSACTION_ABORTED', error);
    } else {
      failure = error;
    }
  } finally {
    scopeOpen = false;
    controller.abort();
    await Promise.allSettled([...pending]);
    if (session) {
      if (begun && !committed) {
        try {
          await session.rollback();
        } catch (error) {
          failure = new AggregateError(
            hasFailure ? [failure, error] : [error],
            'Transaction rollback failed'
          );
          hasFailure = true;
        }
      }
      try {
        await session.release();
      } catch (error) {
        failure = new AggregateError(
          hasFailure ? [failure, error] : [error],
          'Transaction lease release failed'
        );
        hasFailure = true;
      }
    }
    if (timer) {
      clearTimeout(timer);
    }
    parsed.signal?.removeEventListener('abort', abort);
  }
  if (hasFailure) {
    throw failure;
  }
  return value as T;
}
