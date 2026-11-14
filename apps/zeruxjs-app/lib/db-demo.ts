import { getActiveDatabaseManager } from '@zeruxjs/db';
import { HttpError } from 'zeruxjs';

/** Resolve the explicitly enabled legacy MySQL example through the current host manager.
 * @returns {object} Borrowed named connection facade; disabled use throws before requesting a connection.
 */
export const getDbDemoConnection = () => {
  if (process.env.ENABLE_MYSQL_DEMO !== 'true') {
    throw new HttpError(503, 'Optional MySQL demo is disabled');
  }
  return getActiveDatabaseManager().getConnectionFacade('something');
};

/** Fixed example table suffix, separate from the authenticated local workspace schema. */
const DB_DEMO_TABLE_FALLBACK = 'contact_submissions';
/** Explicit legacy configuration slug; it is not selected from request input. */
export const DB_DEMO_CONNECTION_SLUG = 'something';
/** Normalize configured prefix characters before constructing an SQL identifier. */
const IDENTIFIER_CHAR_PATTERN = /[^A-Za-z0-9_]/g;

/** Recognize legacy duplicate-index failures by known code/text without masking other errors.
 * @param {unknown} error - Private connector failure, never returned verbatim to an anonymous response.
 * @returns {boolean} Whether the existing compatibility heuristic identifies an already-created index.
 */
const isIgnorableIndexError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  /** Optional private structured driver metadata; no arbitrary error payload is executed. */
  const details =
    'details' in error &&
    typeof error.details === 'object' &&
    error.details !== null
      ? (error.details as Record<string, unknown>)
      : null;
  /** Known driver code when available; legacy message matching remains a compatibility fallback. */
  const code = typeof details?.code === 'string' ? details.code : '';
  /** Normalized diagnostic text used only for duplicate-index recognition. */
  const message = error.message.toLowerCase();

  return (
    code === 'ER_DUP_KEYNAME' ||
    message.includes('duplicate key name') ||
    message.includes('already exists')
  );
};

/** Resolve a safe legacy table identifier from explicit host configuration.
 * @returns {string} Fixed table suffix optionally prefixed with normalized configured identifier text.
 */
export const getDbDemoTableName = (): string => {
  /** Borrowed enabled connection facade; the application manager retains lifecycle ownership. */
  const db = getDbDemoConnection();
  /** Configured connection prefix, never a query/form-controlled table name. */
  const rawPrefix =
    typeof db.options.prefix === 'string' ? db.options.prefix : '';
  /** Identifier-safe prefix preserves the existing demo table naming contract. */
  const safePrefix = rawPrefix
    .replace(IDENTIFIER_CHAR_PATTERN, '_')
    .replace(/^_+|_+$/g, '');

  return safePrefix
    ? `${safePrefix}_${DB_DEMO_TABLE_FALLBACK}`
    : DB_DEMO_TABLE_FALLBACK;
};

/** Explicitly initialize the enabled legacy table and then its optional email index.
 * @returns {Promise<object>} Actual table result; nonduplicate index failures reject and no transaction is invented.
 */
export const ensureDbDemoTable = async () => {
  /** Borrowed enabled connection facade; the application manager retains lifecycle ownership. */
  const db = getDbDemoConnection();
  /** Fixed suffix plus validated configured prefix, passed through structured database operations. */
  const table = getDbDemoTableName();

  /** Actual connector DDL result; index creation is attempted separately and is not a cross-operation transaction. */
  const createTableResult = await db.createTable({
    table,
    ifNotExists: true,
    columns: [
      {
        name: 'id',
        type: 'integer',
        primary: true,
        autoIncrement: true,
      },
      {
        name: 'name',
        type: 'varchar',
        length: 120,
        notNull: true,
      },
      {
        name: 'email',
        type: 'varchar',
        length: 190,
        notNull: true,
      },
      {
        name: 'message',
        type: 'text',
        notNull: true,
      },
      {
        name: 'created_at',
        type: 'datetime',
        notNull: true,
        default: {
          kind: 'function',
          name: 'CURRENT_TIMESTAMP',
        },
      },
    ],
  });

  try {
    await db.createIndex({
      table,
      name: `${table}_email_idx`,
      columns: ['email'],
    });
  } catch (error) {
    if (!isIgnorableIndexError(error)) {
      throw error;
    }
  }

  return createTableResult;
};

/** Coerce/validate the teaching form fields and project bounded scalar storage values.
 * @param {unknown} input - Candidate parsed request body; not an authorization decision or arbitrary executable schema.
 * @returns {{ name: string; email: string; message: string }} Trimmed name/email/message with existing 120/190/2000-code-unit limits.
 */
export const normalizeDbDemoInput = (
  input: unknown
): { name: string; email: string; message: string } => {
  /** Candidate record projection; this teaching normalizer is not the validator package’s schema contract. */
  const body =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {};
  /** Trimmed display name, bounded again in the returned projection. */
  const name = String(body.name ?? '').trim();
  /** Trimmed/lowercased address still subject to the explicit demo syntax check. */
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  /** Normalized diagnostic text used only for duplicate-index recognition. */
  const message = String(body.message ?? '').trim();

  if (name.length < 2) {
    throw new Error('Name must be at least 2 characters long');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email must be a valid email address');
  }

  if (message.length < 5) {
    throw new Error('Message must be at least 5 characters long');
  }

  return {
    name: name.slice(0, 120),
    email: email.slice(0, 190),
    message: message.slice(0, 2000),
  };
};

/** Read recent rows only from the explicitly enabled configured legacy connection.
 * @param {number} limit - Requested result bound, default 20, validated by the database operation owner.
 * @returns {Promise<object>} Actual select result; unavailable/unsupported provider outcomes reject.
 */
export const listDbDemoSubmissions = async (limit = 20) =>
  getDbDemoConnection().select({
    table: getDbDemoTableName(),
    columns: ['id', 'name', 'email', 'message', 'created_at'],
    orderBy: [
      {
        by: 'id',
        direction: 'desc',
      },
    ],
    limit,
  });
