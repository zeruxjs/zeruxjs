import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  DatabaseResult,
  QueryOperation,
  SelectOperation,
  InsertOperation,
  UpdateOperation,
  DeleteOperation,
} from '@zeruxjs/db';
import type { SqliteDatabase } from './driver.js';
import { sqliteError, syncValue } from './driver.js';
export interface SqliteSyncTransaction {
  /** Run one structured operation on this active synchronous transaction.
   * @param {QueryOperation} operation - Structured operation; per-query async controls remain unsupported.
   * @returns {DatabaseResult} Private normalized synchronous result.
   */
  execute(operation: QueryOperation): DatabaseResult;
  /** Alias structured execution within this same transaction scope.
   * @param {QueryOperation} operation - Structured operation; per-query async controls remain unsupported.
   * @returns {DatabaseResult} Private normalized synchronous result.
   */
  query(operation: QueryOperation): DatabaseResult;
  /** Select through the scoped transaction without exposing the native handle.
   * @param {Omit<SelectOperation, 'op' | 'connection'>} operation - Structured operation; per-query async controls remain unsupported.
   * @returns {DatabaseResult} Private rows and count.
   */
  select(operation: Omit<SelectOperation, 'op' | 'connection'>): DatabaseResult;
  /** Insert through the scoped transaction.
   * @param {Omit<InsertOperation, 'op' | 'connection'>} operation - Structured operation; per-query async controls remain unsupported.
   * @returns {DatabaseResult} Native normalized insertion outcome.
   */
  insert(operation: Omit<InsertOperation, 'op' | 'connection'>): DatabaseResult;
  /** Update through the scoped transaction.
   * @param {Omit<UpdateOperation, 'op' | 'connection'>} operation - Structured operation; per-query async controls remain unsupported.
   * @returns {DatabaseResult} Native normalized update outcome.
   */
  update(operation: Omit<UpdateOperation, 'op' | 'connection'>): DatabaseResult;
  /** Delete through the scoped transaction.
   * @param {Omit<DeleteOperation, 'op' | 'connection'>} operation - Structured operation; per-query async controls remain unsupported.
   * @returns {DatabaseResult} Native normalized deletion outcome.
   */
  delete(operation: Omit<DeleteOperation, 'op' | 'connection'>): DatabaseResult;
}
export interface SqliteSyncTransactionOptions {
  /** Native deferred/immediate/exclusive BEGIN mode; no savepoint emulation. */
  mode?: 'deferred' | 'immediate' | 'exclusive';
  /** Cooperative elapsed budget 1–60000ms, default 30000; cannot interrupt blocking work. */
  timeoutMs?: number;
  /** Optional abort signal checked synchronously around operations/callback completion. */
  signal?: AbortSignal;
}
export type SqliteSyncTransactionRunner = <T>(
  run: (
    tx: SqliteSyncTransaction
  ) => T & (T extends PromiseLike<unknown> ? never : unknown),
  options?: SqliteSyncTransactionOptions
) => T;

/** Async context fences escaped continuations from reusing the outer connector. */
const scopes = new AsyncLocalStorage<{
  /** Native handle identity used only for escaped-continuation fencing. */
  db: SqliteDatabase;
}>();

/** Per-native-handle active/quarantine state shared across wrappers without retaining dead handles. */
const handles = new WeakMap<
  SqliteDatabase,
  {
    /** True while a wrapper owns the native BEGIN/COMMIT interval. */
    active: boolean; /** Rollback failure quarantine; only cleanup may still use the outer wrapper. */
    broken: boolean;
  }
>();
/** Prevent outer-wrapper use from a transaction continuation and deny quarantined handles.
 * @param {SqliteDatabase} db - Synchronous native handle; owner remains the connector/host.
 * @param {boolean} allowBroken - Permit quarantined-handle access only for close; default false.
 * @returns {void} Throws when access would escape transaction ownership.
 */
export function assertSqliteOutsideTransaction(
  db: SqliteDatabase,
  allowBroken = false
) {
  if (scopes.getStore()?.db === db) {
    throw sqliteError('SQLITE_USE_TRANSACTION_FACADE');
  }
  if (!allowBroken && handles.get(db)?.broken) {
    throw sqliteError('SQLITE_TRANSACTION_HANDLE_UNUSABLE');
  }
}
/** Own one synchronous BEGIN/callback/COMMIT interval, with rollback-only failure state and native-handle quarantine.
 * @param {SqliteDatabase} db - Synchronous native handle; owner remains the connector/host.
 * @param {(operation: QueryOperation) => DatabaseResult} execute - Trusted synchronous structured executor using this same handle.
 * @param {() => boolean} isClosed - Connector lifecycle predicate checked before BEGIN.
 * @param {SqliteSyncTransactionOptions['mode']} defaultMode - Default BEGIN mode, immediate unless readonly selects deferred.
 * @returns {SqliteSyncTransactionRunner} Scoped runner; callbacks never yield or automatically retry.
 */
export function createSyncTransaction(
  db: SqliteDatabase,
  execute: (operation: QueryOperation) => DatabaseResult,
  isClosed: () => boolean,
  defaultMode: SqliteSyncTransactionOptions['mode'] = 'immediate'
): SqliteSyncTransactionRunner {
  let state = handles.get(db);
  if (!state) {
    state = { active: false, broken: false };
    handles.set(db, state);
  }
  return <T>(
    run: (tx: SqliteSyncTransaction) => T,
    options: SqliteSyncTransactionOptions = {}
  ): T => {
    /** Read native transaction state to detect external or nested BEGIN ownership.

 * @returns {boolean} True when the native handle reports an active transaction. */
    const nativeActive = () =>
      db.isTransaction === true || db.inTransaction === true;
    if (isClosed()) {
      throw sqliteError('SQLITE_CONNECTOR_CLOSED');
    }
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some(
        (k) => !['mode', 'timeoutMs', 'signal'].includes(k)
      )
    ) {
      throw sqliteError('INVALID_SQLITE_TRANSACTION_OPTIONS');
    }

    /** Validated native BEGIN mode; readonly connectors default to deferred. */
    const mode = options.mode ?? defaultMode;

    /** Bounded monotonic elapsed budget; cannot interrupt blocking native work. */
    const timeoutMs = options.timeoutMs ?? 30000;
    if (
      !['deferred', 'immediate', 'exclusive'].includes(mode) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000 ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    ) {
      throw sqliteError('INVALID_SQLITE_TRANSACTION_OPTIONS');
    }
    if (typeof run !== 'function' || run.constructor.name === 'AsyncFunction') {
      throw sqliteError('SQLITE_ASYNC_TRANSACTION_CALLBACK');
    }
    if (state!.active || nativeActive()) {
      throw sqliteError('SQLITE_NESTED_TRANSACTION_UNSUPPORTED');
    }
    assertSqliteOutsideTransaction(db);

    /** Monotonic expiration checked around synchronous operations and callback completion. */
    const deadline = performance.now() + timeoutMs;

    /** Reject aborted/expired work at cooperative synchronous boundaries.

 * @returns {void} Throws before commit when the configured budget is exhausted. */
    const check = () => {
      if (options.signal?.aborted || performance.now() >= deadline) {
        throw sqliteError('SQLITE_TRANSACTION_ABORTED');
      }
    };
    check();
    let begun = false,
      committing = false,
      finished = false,
      failed = false,
      hasFailure = false,
      value: T | undefined,
      failure: unknown;

    /** Execute only while this facade is live and mark any failure rollback-only.
     * @param {QueryOperation} operation - Structured operation using the same native transaction.
     * @param {unknown[]} extra - Reject unsupported non-undefined per-query asynchronous options.
     * @returns {DatabaseResult} Synchronous private normalized result. */
    const call = (operation: QueryOperation, ...extra: unknown[]) => {
      if (finished) {
        throw sqliteError('SQLITE_TRANSACTION_SCOPE_CLOSED');
      }
      try {
        check();
        if (extra.some((v) => v !== undefined)) {
          throw sqliteError('SQLITE_SYNC_QUERY_OPTIONS_UNSUPPORTED');
        }

        /** Observed synchronous operation result; caught failures still poison this transaction. */
        const result = syncValue(execute(operation));
        check();
        if (!result.ok) {
          failed = true;
        }
        return result;
      } catch (error) {
        failed = true;
        throw error;
      }
    };

    /** Frozen scoped facade; never exposes the privileged native database handle. */
    const tx: SqliteSyncTransaction = Object.freeze({
      execute: call,
      query: call,
      select: (
        op: Omit<SelectOperation, 'op' | 'connection'>,
        ...extra: unknown[]
      ) => call({ ...op, op: 'select' }, ...extra),
      insert: (
        op: Omit<InsertOperation, 'op' | 'connection'>,
        ...extra: unknown[]
      ) => call({ ...op, op: 'insert' }, ...extra),
      update: (
        op: Omit<UpdateOperation, 'op' | 'connection'>,
        ...extra: unknown[]
      ) => call({ ...op, op: 'update' }, ...extra),
      delete: (
        op: Omit<DeleteOperation, 'op' | 'connection'>,
        ...extra: unknown[]
      ) => call({ ...op, op: 'delete' }, ...extra),
    });
    state!.active = true;
    try {
      syncValue(db.exec(`BEGIN ${mode.toUpperCase()}`));
      begun = true;
      check();
      value = scopes.run({ db }, () => syncValue(run(tx)));
      check();
      if (failed) {
        throw sqliteError('SQLITE_TRANSACTION_ROLLBACK_ONLY');
      }
      committing = true;
      syncValue(db.exec('COMMIT'));
      finished = true;
    } catch (error) {
      if (nativeActive()) {
        begun = true;
      }
      hasFailure = true;
      failure = committing ? sqliteError('SQLITE_COMMIT_FAILED', error) : error;
    } finally {
      finished = true;
      if (begun && hasFailure) {
        try {
          syncValue(db.exec('ROLLBACK'));
        } catch (error) {
          state!.broken = true;
          failure = new AggregateError(
            [failure, error],
            'SQLite rollback failed'
          );
        }
      }
      state!.active = false;
    }
    if (hasFailure) {
      throw failure;
    }
    return value as T;
  };
}
