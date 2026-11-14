import {
  DB_DEMO_CONNECTION_SLUG,
  ensureDbDemoTable,
  getDbDemoConnection,
  getDbDemoTableName,
  listDbDemoSubmissions,
  normalizeDbDemoInput,
} from '../../../lib/db-demo.js';

/** Read the explicitly enabled legacy teaching table, initializing it on the configured provider.
 * @returns {Promise<object>} Actual bounded rows/connection metadata; this is separate from private workspace authorization.
 */
export const GET = async () => {
  /** Borrowed explicitly enabled legacy connection; disabled use rejects before native access. */
  const db = getDbDemoConnection();
  await ensureDbDemoTable();
  /** Actual bounded select result, never invented connectivity success. */
  const result = await listDbDemoSubmissions(20);

  return {
    ok: true,
    connection: {
      slug: DB_DEMO_CONNECTION_SLUG,
      name: db.name,
      connector: db.connector,
    },
    table: getDbDemoTableName(),
    rows: result.rows ?? [],
    rowCount: result.rowCount ?? 0,
  };
};

/** Normalize a legacy teaching submission, persist it and return the refreshed bounded list.
 * @param {object} context - Borrowed framework request projection.
 * @param {unknown} context.body - Parsed request body, normalized before structured database insertion.
 * @returns {Promise<object>} Existing ok/error teaching payload; UI visibility is not authentication or authorization.
 */
export const POST = async ({ body }: { body: unknown }) => {
  /** Borrowed explicitly enabled legacy connection; disabled use rejects before native access. */
  const db = getDbDemoConnection();
  let submission: { name: string; email: string; message: string };
  try {
    submission = normalizeDbDemoInput(body);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid payload',
    };
  }

  await ensureDbDemoTable();

  /** Actual insert receipt; refreshed list retrieval is a separate operation, not a transaction. */
  const insertResult = await db.insert({
    table: getDbDemoTableName(),
    values: submission,
  });

  /** Latest bounded rows after insertion; a later read failure does not undo the committed write. */
  const listResult = await listDbDemoSubmissions(20);

  return {
    ok: true,
    connection: {
      slug: DB_DEMO_CONNECTION_SLUG,
      name: db.name,
      connector: db.connector,
    },
    insertedIds: insertResult.insertedIds ?? [],
    affectedCount: insertResult.affectedCount ?? 0,
    rows: listResult.rows ?? [],
  };
};

/** Explicit teaching-route middleware chain; private workspace policies remain a separate boundary. */
export const middleware = ['request-context', 'trace-runtime'];
