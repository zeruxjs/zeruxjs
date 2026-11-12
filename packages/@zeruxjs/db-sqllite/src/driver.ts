import { createDatabaseError } from '@zeruxjs/db';
/** Minimal synchronous driver contract. Optional integer controls are driver-specific. */
export type SqliteStatement = {
  /** Read the prepared statement synchronously with separate bound values.
   * @param {unknown[]} params - Private bound parameter values; never interpolated into SQL.
   * @returns {unknown[]} Private native rows; driver integer mode determines precision.
   */
  all(...params: unknown[]): unknown[];
  /** Run the prepared write synchronously with separate bound values.
   * @param {unknown[]} params - Private bound parameter values; never interpolated into SQL.
   * @returns {{changes: number | bigint, lastInsertRowid?: bigint | number}} Native affected count and optional insertion identity.
   */
  run(...params: unknown[]): {
    /** Native number/bigint affected count, including a valid zero. */
    changes: number | bigint;
    /** Optional native insertion identity; large integers must retain precision. */
    lastInsertRowid?: bigint | number;
  };
  /** Configure Node integer-safe output before execution.
   * @param {boolean} enabled - Explicit requested native integer-read mode.
   * @returns {void} Native precision mode changed for this statement.
   */
  setReadBigInts?(enabled: boolean): void;
  /** Configure optional better-sqlite3 integer-safe output.
   * @param {boolean} enabled - Explicit requested native integer-read mode.
   * @returns {unknown} Driver-specific return value, observed only for synchronous completion.
   */
  safeIntegers?(enabled: boolean): unknown;
  /** Optional native reader metadata, preferred over keyword heuristics. */
  readonly reader?: boolean;
  /** Read native prepared-column metadata without guessing from quoted SQL text.
   * @returns {readonly unknown[]} Native columns; nonempty means rows are returned.
   */
  columns?(): readonly unknown[];
};
export type SqliteDatabase = {
  /** Prepare trusted compiler SQL on this synchronous native handle.
   * @param {string} statement - Trusted host/compiler SQL; not an authorization boundary.
   * @returns {SqliteStatement} Borrowed native prepared statement.
   */
  prepare(statement: string): SqliteStatement;
  /** Execute trusted native transaction/PRAGMA control synchronously.
   * @param {string} statement - Trusted host/compiler SQL; not an authorization boundary.
   * @returns {void} Native operation completed or threw.
   */
  exec(statement: string): void;
  /** Close this native database; only its owner may invoke cleanup.
   * @returns {void} Handle released; injected handle ownership stays with the host.
   */
  close(): void;
  /** Node native transaction-active signal used for nesting guards. */
  readonly isTransaction?: boolean;
  /** Optional better-sqlite3 transaction-active signal used for nesting guards. */
  readonly inTransaction?: boolean;
};
export type SqliteDriver = 'auto' | 'node' | 'better-sqlite3';
export interface SqliteOptions {
  /** Trusted host filename, default in-memory when the connector opens it. */
  filename?: string;
  /** Explicit auto/node/better-sqlite3 selection; auto falls back only on import failure. */
  driver?: SqliteDriver;
  /** Borrowed synchronous handle; never closed by connector teardown. */
  databaseInstance?: SqliteDatabase;
  /** Reject structured writes; native handles remain privileged host escape hatches. */
  readonly?: boolean;
  /** Optional integer 0–60000 native busy wait; blocks the thread and is not a retry deadline. */
  busyTimeoutMs?: number;
  /** Preserve existing journal policy by default; WAL/delete must be explicitly configured. */
  journalMode?: 'preserve' | 'wal' | 'delete';
  /** Default preserves safe numbers and emits unsafe 64-bit integers as strings. */
  readBigInts?: boolean;
}

/** Create a stable SQLite error code while retaining an optional private cause.
 * @param {string} code - Fixed package failure code.
 * @param {unknown} cause - Optional native error; never expose directly to public telemetry.
 * @returns {ReturnType<typeof createDatabaseError>} Structured database error with private cause. */
export const sqliteError = (code: string, cause?: unknown) =>
  createDatabaseError({
    code,
    message: code.toLowerCase().replaceAll('_', ' '),
    ...(cause !== undefined ? { cause } : {}),
  });
/** Reject thenables without allowing rejected asynchronous tails to become unhandled.
 * @param {T} value - Candidate synchronous return value; thenables reject.
 * @returns {T} Original synchronous result; this does not interrupt escaped work.
 */
export function syncValue<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as any).then === 'function'
  ) {
    void Promise.resolve(value).catch(() => {});
    throw sqliteError('SQLITE_ASYNC_RESULT');
  }
  return value;
}
/** Validate native option combinations before opening resources or applying policies.
 * @param {SqliteOptions} options - Validated host-owned database/precision/policy configuration.
 * @returns {void} Throws a stable package error on incompatible or malformed input.
 */
export function validateSqliteOptions(options: SqliteOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw sqliteError('INVALID_SQLITE_OPTIONS');
  }
  if (
    options.driver !== undefined &&
    !['auto', 'node', 'better-sqlite3'].includes(options.driver)
  ) {
    throw sqliteError('UNKNOWN_SQLITE_DRIVER');
  }
  if (
    options.filename !== undefined &&
    (typeof options.filename !== 'string' ||
      !options.filename ||
      options.filename.length > 4096 ||
      options.filename.includes('\0'))
  ) {
    throw sqliteError('INVALID_SQLITE_FILENAME');
  }
  // Require actual booleans rather than coercing host precision/readonly options.
  for (const flag of ['readonly', 'readBigInts'] as const) {
    if (options[flag] !== undefined && typeof options[flag] !== 'boolean') {
      throw sqliteError('INVALID_SQLITE_OPTIONS');
    }
  }
  if (
    options.busyTimeoutMs !== undefined &&
    (!Number.isSafeInteger(options.busyTimeoutMs) ||
      options.busyTimeoutMs < 0 ||
      options.busyTimeoutMs > 60000)
  ) {
    throw sqliteError('INVALID_SQLITE_BUSY_TIMEOUT');
  }
  if (
    options.journalMode !== undefined &&
    !['preserve', 'wal', 'delete'].includes(options.journalMode)
  ) {
    throw sqliteError('INVALID_SQLITE_JOURNAL_MODE');
  }
  if (
    options.readonly &&
    options.journalMode !== undefined &&
    options.journalMode !== 'preserve'
  ) {
    throw sqliteError('SQLITE_READONLY_JOURNAL_POLICY');
  }
  if (
    options.databaseInstance !== undefined &&
    (!options.databaseInstance || typeof options.databaseInstance !== 'object')
  ) {
    throw sqliteError('INVALID_SYNC_SQLITE_DATABASE');
  }
  if (options.databaseInstance) {
    // Verify all borrowed native operations are synchronous before accepting the handle.
    for (const name of ['prepare', 'exec', 'close'] as const) {
      if (
        typeof options.databaseInstance[name] !== 'function' ||
        options.databaseInstance[name].constructor.name === 'AsyncFunction'
      ) {
        throw sqliteError('INVALID_SYNC_SQLITE_DATABASE');
      }
    }
  }
}

/** Open only the selected driver; auto falls back solely when Node SQLite cannot import.
 * @param {string} filename - Trusted host filename or explicit in-memory marker.
 * @param {SqliteDriver} driver - Explicit native driver selection; default auto.
 * @param {boolean} readOnly - Open read-only when true; default false.
 * @returns {Promise<SqliteDatabase>} New owned handle; caller must close it. */
export const openSqlite = async (
  filename: string,
  driver: SqliteDriver = 'auto',
  readOnly = false
): Promise<SqliteDatabase> => {
  validateSqliteOptions({ filename, driver, readonly: readOnly });
  if (driver !== 'better-sqlite3') {
    let module: typeof import('node:sqlite') | undefined;
    try {
      module = await import('node:sqlite');
    } catch (error) {
      if (driver === 'node') {
        throw error;
      }
    }
    if (module) {
      return new module.DatabaseSync(filename, {
        readOnly,
      }) as unknown as SqliteDatabase;
    }
  }

  /** Lazily imported optional driver; no fallback masks an opening/configuration error. */
  const sqliteModule = await import('better-sqlite3');

  /** Reviewed optional native constructor, not a dynamically selected application module. */
  const Database = sqliteModule.default as unknown as new (
    name: string,
    opts: {
      /** Reject structured writes; native handles remain privileged host escape hatches. */
      readonly: boolean;
    }
  ) => SqliteDatabase;
  return new Database(filename, { readonly: readOnly });
};
/** Apply only explicitly requested native policies and verify journal-mode acceptance.
 * @param {SqliteDatabase} db - Borrowed synchronous native database.
 * @param {SqliteOptions} options - Validated host-owned database/precision/policy configuration.
 * @returns {void} Borrowed-handle policy changes remain host-owned and are not reverted.
 */
export function configureSqlite(
  db: SqliteDatabase,
  options: SqliteOptions
): void {
  if (options.busyTimeoutMs !== undefined) {
    syncValue(db.exec(`PRAGMA busy_timeout=${options.busyTimeoutMs}`));
  }
  if (options.journalMode && options.journalMode !== 'preserve') {
    /** Validated explicit journal mode converted to its native fixed keyword. */
    const requested = options.journalMode.toUpperCase();

    /** Native PRAGMA result used to verify the requested mode was actually applied. */
    const rows = syncValue(
      db.prepare(`PRAGMA journal_mode=${requested}`).all()
    ) as Array<{ journal_mode?: string }>;
    if (rows[0]?.journal_mode?.toUpperCase() !== requested) {
      throw sqliteError('SQLITE_JOURNAL_MODE_UNAVAILABLE');
    }
  }
}

/** Borrow a synchronous handle and prepare each statement with precision-preserving integer conversion.
 * @param {SqliteDatabase} db - Host-owned synchronous database; this function never closes it.
 * @param {Pick<SqliteOptions, 'readBigInts'>} options - Optional bigint row policy; default safe numbers/decimal strings.
 * @returns {(sql: string, args?: unknown[]) => unknown} Synchronous prepared executor, not an authorization boundary. */
export const createSqliteExecutor = (
  db: SqliteDatabase,
  options: Pick<SqliteOptions, 'readBigInts'> = {}
) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw sqliteError('INVALID_SQLITE_OPTIONS');
  }
  validateSqliteOptions({ ...options, databaseInstance: db });
  return (sql: string, args: unknown[] = []) => {
    if (
      typeof sql !== 'string' ||
      !sql.trim() ||
      sql.length > 8 * 1024 * 1024 ||
      sql.includes('\0') ||
      !Array.isArray(args)
    ) {
      throw sqliteError('INVALID_SQLITE_STATEMENT');
    }
    let statement = sql.trim();
    if (/^TRUNCATE\s+TABLE\s+/i.test(statement)) {
      /** Validated quoted identifier from legacy TRUNCATE compatibility; never arbitrary SQL. */
      const table = statement.replace(/^TRUNCATE\s+TABLE\s+/i, '');
      if (
        !/^"[A-Za-z_][A-Za-z0-9_]*"(?:\."[A-Za-z_][A-Za-z0-9_]*")*$/.test(table)
      ) {
        throw sqliteError('INVALID_SQLITE_TRUNCATE');
      }
      statement = `DELETE FROM ${table}`;
    }
    if (/^(?:CREATE|DROP)\s+DATABASE\b|^USE\b/i.test(statement)) {
      throw sqliteError('SQLITE_UNSUPPORTED_DATABASE_OPERATION');
    }

    /** One native prepared statement; integer mode is set before running it. */
    const prepared = syncValue(db.prepare(statement));

    /** Enable native integer-safe reads when supported; reject an explicit unavailable bigint policy.

 * @returns {void} Statement precision configured before execution. */
    const precise = () => {
      if (prepared.setReadBigInts) {
        syncValue(prepared.setReadBigInts(true));
      } else if (prepared.safeIntegers) {
        syncValue(prepared.safeIntegers(true));
      } else if (options.readBigInts) {
        throw sqliteError('SQLITE_BIGINT_MODE_UNAVAILABLE');
      }
    };
    precise();

    /** Preserve bigint rows explicitly or convert only safely representable values to numbers.
     * @param {unknown} value - One private native row value.
     * @returns {unknown} Original scalar, safe number, or exact decimal string. */
    const scalar = (value: unknown): unknown =>
      (() => {
        if (typeof value === 'bigint' && !options.readBigInts) {
          if (
            value >= BigInt(Number.MIN_SAFE_INTEGER) &&
            value <= BigInt(Number.MAX_SAFE_INTEGER)
          ) {
            return Number(value);
          }
          return value.toString();
        }
        return value;
      })();

    /** SQL with quoted text/comments removed solely for legacy reader classification, not general parsing. */
    const tokens = statement.replace(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,
      ' '
    );
    if (
      typeof prepared.reader !== 'boolean' &&
      !prepared.columns &&
      /^WITH\b/i.test(tokens)
    ) {
      throw sqliteError('SQLITE_STATEMENT_METADATA_UNAVAILABLE');
    }

    /** Native reader metadata takes precedence over the limited legacy keyword heuristic. */
    const returnsRows = (() => {
      if (typeof prepared.reader === 'boolean') {
        return prepared.reader;
      }
      if (prepared.columns) {
        return syncValue(prepared.columns()).length > 0;
      }
      return (
        /^(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(tokens) ||
        /^(?:INSERT|UPDATE|DELETE)\b[\s\S]*\bRETURNING\b/i.test(tokens)
      );
    })();
    if (returnsRows) {
      /** Native PRAGMA result used to verify the requested mode was actually applied. */
      const rows = syncValue(prepared.all(...args));
      return rows.map((row) =>
        row && typeof row === 'object'
          ? Object.fromEntries(
              Object.entries(row).map(([key, value]) => [key, scalar(value)])
            )
          : row
      );
    }

    /** Native run result; change counts are validated without losing a successful zero. */
    const result = syncValue(prepared.run(...args));

    /** Safe nonnegative native change count; unsafe bigint conversion rejects. */
    const changes =
      typeof result.changes === 'bigint'
        ? Number(result.changes)
        : result.changes;
    if (!Number.isSafeInteger(changes) || changes < 0) {
      throw sqliteError('SQLITE_UNSAFE_CHANGE_COUNT');
    }

    /** Native insertion identity preserved as bigint when outside safe numeric range. */
    const rowId = result.lastInsertRowid;
    return {
      ...result,
      changes,
      lastInsertRowid:
        typeof rowId === 'bigint' &&
        rowId >= BigInt(Number.MIN_SAFE_INTEGER) &&
        rowId <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(rowId)
          : rowId,
    };
  };
};
