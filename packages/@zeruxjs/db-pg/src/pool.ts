import { createDatabaseError } from '@zeruxjs/db';
export interface PgPoolClientLike {
  /** Execute prepared SQL/parameters using the actual native receiver.
   * @param {string} statement - Prepared SQL or fixed transaction/settings control SQL.
   * @param {unknown[]} params - Separate native parameter values; never interpolated into SQL.
   * @returns {Promise<unknown>} Private native outcome, normalized by SQL core.
   */
  query(statement: string, params?: unknown[]): Promise<unknown>;
  /** End this native pool/client only when its owner requests cleanup.
   * @returns {Promise<void>} Native close receipt.
   */
  end(): Promise<void>;
  /** Release healthy state or discard a destroyed leased client exactly once.
   * @param {boolean} destroy - True means discard rather than healthy native reuse.
   * @returns {void} Native pool ownership action.
   */
  release(destroy?: boolean): void;
  /** Register an exact native lifecycle error listener.
   * @param {'error'} event - Explicit error event name.
   * @param {(error: unknown) => void} listener - Exact callback retained/removed by its owner.
   * @returns {unknown} Driver-defined result.
   */
  on?(event: 'error', listener: (error: unknown) => void): unknown;
  /** Remove the exact registered native listener.
   * @param {'error'} event - Explicit error event name.
   * @param {(error: unknown) => void} listener - Exact callback retained/removed by its owner.
   * @returns {unknown} Driver-defined result.
   */
  off?(event: 'error', listener: (error: unknown) => void): unknown;
}
export interface PgPoolLike {
  /** Execute prepared SQL/parameters using the actual native receiver.
   * @param {string} statement - Prepared SQL or fixed transaction/settings control SQL.
   * @param {unknown[]} params - Separate native parameter values; never interpolated into SQL.
   * @returns {Promise<unknown>} Private native outcome, normalized by SQL core.
   */
  query(statement: string, params?: unknown[]): Promise<unknown>;
  /** Acquire a native-compatible client from this explicit pool.
   * @returns {Promise<PgPoolClientLike>} Client must expose query, end and release.
   */
  connect?(): Promise<PgPoolClientLike>;
  /** Register an exact native lifecycle error listener.
   * @param {'error'} event - Explicit error event name.
   * @param {(error: unknown) => void} listener - Exact callback retained/removed by its owner.
   * @returns {unknown} Driver-defined result.
   */
  on?(event: 'error', listener: (error: unknown) => void): unknown;
  /** Remove the exact registered native listener.
   * @param {'error'} event - Explicit error event name.
   * @param {(error: unknown) => void} listener - Exact callback retained/removed by its owner.
   * @returns {unknown} Driver-defined result.
   */
  off?(event: 'error', listener: (error: unknown) => void): unknown;
  /** End this native pool/client only when its owner requests cleanup.
   * @returns {Promise<void>} Native close receipt.
   */
  end?(): Promise<void>;
  /** Optional native pool total count; status validates safe range. */
  readonly totalCount?: number;
  /** Optional native pool idle count; not a distributed utilization guarantee. */
  readonly idleCount?: number;
  /** Optional native queued-acquisition count; status validates safe range. */
  readonly waitingCount?: number;
}
export interface PgConnectorOptions extends Record<string, unknown> {
  /** Borrowed query-only native transport; no native pin/cancellation guarantee. */
  client?: {
    query?: (statement: string, params?: unknown[]) => Promise<unknown>;
    execute?: (statement: string, params?: unknown[]) => Promise<unknown>;
  };
  /** Borrowed explicit pool; standard connect enables native pins. */
  pool?: PgPoolLike;
  /** Trusted native endpoint host. */
  host?: string;
  /** Compatible host alias. */
  hostname?: string;
  /** Compatible native user alias; private configuration. */
  username?: string;
  /** Private native account name. */
  user?: string;
  /** Private native credential; never public configuration. */
  password?: string;
  /** Explicit trusted database selection. */
  database?: string;
  /** Default 5432; integer 1–65535. */
  port?: number;
  /** Explicit native pg TLS policy; host owns deployment trust/verification. */
  ssl?: unknown;
  /** Owned pool default 10; integer 1–1024. */
  max?: number;
  /** Private native connection URI; never metric labels. */
  connectionString?: string;
  /** Trusted query-only execution function; no native session inferred. */
  executor?: (
    statement: string,
    params: unknown[]
  ) => Promise<unknown> | unknown;
  /** Default 5000ms; integer 1–60000, separate from execution. */
  acquireTimeoutMs?: number;
  /** Default 10000ms; integer 1–600000 server statement limit. */
  statementTimeoutMs?: number;
  /** Default 15000ms; integer 1–600000 client watchdog/operation phase. */
  queryTimeoutMs?: number;
  /** Default 5000ms; integer 0–600000; zero disables only this lock-specific limit. */
  lockTimeoutMs?: number;
  /** Default 32; integer 1–1024 through actual acquisition/lease settlement. */
  maxPendingAcquires?: number;
  /** Default 5000ms; integer 1–60000 observation budget, not forced JavaScript cancellation. */
  shutdownTimeoutMs?: number;
}
/** Create fixed code-derived diagnostics while retaining native failures privately.
 * @param {string} code - Stable internal classification.
 * @param {unknown} cause - Optional private original cause.
 * @returns {Error & {details: import("@zeruxjs/db").DatabaseErrorShape}} Abstraction error without connection values in the fixed message. */
export const pgError = (code: string, cause?: unknown) =>
  createDatabaseError({
    code,
    message: code.toLowerCase().replaceAll('_', ' '),
    ...(cause !== undefined ? { cause } : {}),
  });
/** Validate distinct native phase/pool budgets before creating resources.
 * @param {PgConnectorOptions} options - Trusted host transport/connection and finite phase budgets.
 * @returns {object} Resolved finite limits; no connection is opened here.
 */
export function pgPolicy(options: PgConnectorOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw pgError('INVALID_PG_OPTIONS');
  }
  if (
    [options.pool, options.client, options.executor].filter(
      (v) => v !== undefined
    ).length > 1
  ) {
    throw pgError('AMBIGUOUS_PG_TRANSPORT');
  }
  if (
    options.pool !== undefined &&
    (!options.pool ||
      typeof options.pool.query !== 'function' ||
      (options.pool.connect !== undefined &&
        typeof options.pool.connect !== 'function'))
  ) {
    throw pgError('INVALID_PG_POOL');
  }
  if (
    options.client !== undefined &&
    (!options.client ||
      (typeof options.client.query !== 'function' &&
        typeof options.client.execute !== 'function'))
  ) {
    throw pgError('INVALID_PG_CLIENT');
  }
  if (
    options.executor !== undefined &&
    typeof options.executor !== 'function'
  ) {
    throw pgError('INVALID_PG_EXECUTOR');
  }
  /** Resolve and validate one finite integer policy budget.
   * @param {unknown} value - Configured candidate.
   * @param {number} fallback - Default when absent.
   * @param {number} min - Inclusive lower bound.
   * @param {number} max - Inclusive upper bound.
   * @returns {number} Validated integer. */
  const integer = (
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ) => {
    /** Configured integer or default before bounded range validation. */
    const result = value === undefined ? fallback : value;
    if (
      typeof result !== 'number' ||
      !Number.isSafeInteger(result) ||
      result < min ||
      result > max
    ) {
      throw pgError('INVALID_PG_LIMIT');
    }
    return result;
  };
  // Validate trusted endpoint/credential field shapes without recording their values.
  for (const key of [
    'host',
    'hostname',
    'user',
    'username',
    'password',
    'database',
    'connectionString',
  ] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'string') {
      throw pgError('INVALID_PG_OPTIONS');
    }
  }
  return {
    acquireTimeoutMs: integer(options.acquireTimeoutMs, 5000, 1, 60000),
    statementTimeoutMs: integer(options.statementTimeoutMs, 10000, 1, 600000),
    queryTimeoutMs: integer(options.queryTimeoutMs, 15000, 1, 600000),
    lockTimeoutMs: integer(options.lockTimeoutMs, 5000, 0, 600000),
    maxPendingAcquires: integer(options.maxPendingAcquires, 32, 1, 1024),
    shutdownTimeoutMs: integer(options.shutdownTimeoutMs, 5000, 1, 60000),
    max: integer(options.max, 10, 1, 1024),
    port: integer(options.port, 5432, 1, 65535),
  };
}
/** Reuse a trusted injected transport or create one explicit lazy native pool.
 * @param {PgConnectorOptions} options - Trusted host transport/connection and finite phase budgets.
 * @returns {Promise<{pool:PgPoolLike,owned:boolean}>} Transport and cleanup ownership; borrowed resources remain open.
 */
export async function createManagedPool(options: PgConnectorOptions): Promise<{
  /** Actual acquired transport; injection remains borrowed. */
  pool: PgPoolLike;
  /** True only for the lazy pool created by this helper. */
  owned: boolean;
}> {
  /** Validated queue/pool/native timeout defaults before lazy native construction. */
  const policy = pgPolicy(options);
  if (options.pool) {
    return { pool: options.pool, owned: false };
  }
  if (options.client || options.executor) {
    return {
      pool: {
        query: async (sql, params) => {
          if (options.executor) {
            return options.executor(sql, params ?? []);
          }
          if (options.client?.query) {
            return options.client.query(sql, params);
          }
          return options.client!.execute!(sql, params);
        },
      },
      owned: false,
    };
  }
  // Recheck owned-pool field shapes before passing explicit settings to the fixed native driver.
  for (const key of [
    'host',
    'hostname',
    'user',
    'username',
    'password',
    'database',
    'connectionString',
  ] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'string') {
      throw pgError('INVALID_PG_OPTIONS');
    }
  }
  /** Fixed lazy native pg module, never dynamically selected by client data. */
  const pg = await import('pg');
  /** Owned lazy native pool; query_timeout stays zero so wrapper cleanup owns watchdog semantics. */
  const pool = new pg.Pool({
    host: options.host ?? options.hostname,
    user: options.user ?? options.username,
    password: options.password,
    database: options.database,
    port: policy.port,
    ssl: options.ssl as any,
    max: policy.max,
    connectionString: options.connectionString,
    connectionTimeoutMillis: policy.acquireTimeoutMs,
    // Query watchdogs must not masquerade as server cancellation or permit early client reuse.
    query_timeout: 0,
    statement_timeout: policy.statementTimeoutMs,
    lock_timeout: policy.lockTimeoutMs,
  });
  return { pool: pool as unknown as PgPoolLike, owned: true };
}
