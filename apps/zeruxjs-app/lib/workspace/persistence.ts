import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthPersistence, AuthAccountState } from '@zeruxjs/auth';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';

/** Adapt one host-owned synchronous SQLite connector to durable atomic auth records.
 * @param {SqliteConnector} connection - Borrowed connector; this adapter never disconnects it.
 * @param {boolean} migrate - Explicit initialization permission; ordinary startup only checks existing schema.
 * @returns {AuthPersistence} Bounded JSON records with create/CAS revision semantics on pinned synchronous transactions.
 */
export function createAuthPersistence(
  connection: SqliteConnector,
  migrate: boolean
): AuthPersistence {
  /** Borrowed native synchronous handle; all SQL is fixed and parameterized. */
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_auth_v1 (key TEXT PRIMARY KEY, revision TEXT NOT NULL, document TEXT NOT NULL, expires INTEGER NOT NULL)'
    );
  }
  db.prepare(
    'SELECT key, revision, document, expires FROM workspace_auth_v1 LIMIT 0'
  ).all();
  return {
    capability: 'auth-cas-v1',
    /** Read a live bounded account record without refreshing expiry.
     * @param {string} key - Auth package-owned opaque storage identity.
     * @returns {Promise<object | null>} Stored revision/value, or null for absence/expiry; malformed storage rejects.
     */
    async read(key) {
      /** Current stored record; expired or absent data is not an authenticated identity. */
      const row = db
        .prepare(
          'SELECT revision, document, expires FROM workspace_auth_v1 WHERE key = ?'
        )
        .get(key);
      if (!row || Number(row.expires) <= Date.now()) {
        return null;
      }
      if (
        typeof row.document !== 'string' ||
        Buffer.byteLength(row.document) > 131072 ||
        typeof row.revision !== 'string'
      ) {
        throw new Error('AUTH_STORE_INVALID');
      }
      return {
        revision: row.revision,
        value: JSON.parse(row.document) as AuthAccountState,
      };
    },
    /** Atomically reserve or update one record; failed comparisons never overwrite another writer.
     * @param {string} key - Validated opaque account-record key.
     * @param {string | null} revision - Expected revision; null requests create-only insertion.
     * @param {AuthAccountState} value - Auth-owned account state serialized under the byte budget.
     * @param {number} expiresAt - Future integer expiry timestamp in milliseconds.
     * @returns {Promise<boolean>} Whether exactly one row was committed under the expected revision.
     */
    async compareAndSwap(key, revision, value, expiresAt) {
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(key) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        throw new Error('AUTH_STORE_INVALID');
      }
      /** Bounded serialized account state; binary payloads and access URLs are not logged. */
      const document = JSON.stringify(value);
      if (Buffer.byteLength(document) > 131072) {
        throw new Error('AUTH_STORE_INVALID');
      }
      return connection.transactionSync(() => {
        db.prepare(
          'DELETE FROM workspace_auth_v1 WHERE key = ? AND expires <= ?'
        ).run(key, Date.now());
        /** Fresh opaque revision token generated only inside the compare-and-swap transaction. */
        const next = randomBytes(24).toString('base64url');
        /** Native affected-row count distinguishes a successful claim/update from a revision conflict. */
        const result =
          revision === null
            ? db
                .prepare(
                  'INSERT INTO workspace_auth_v1 VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING'
                )
                .run(key, next, document, expiresAt)
            : db
                .prepare(
                  'UPDATE workspace_auth_v1 SET revision = ?, document = ?, expires = ? WHERE key = ? AND revision = ?'
                )
                .run(next, document, expiresAt, key, revision);
        return result.changes === 1;
      });
    },
  };
}

/** Persist fixed-account login admission across workers/restarts without trusting caller identity headers.
 * @param {SqliteConnector} connection - Borrowed durable synchronous connector.
 * @param {boolean} migrate - Explicit operator schema permission, never inferred from an HTTP request.
 * @param {string} scope - Host-derived account/tenant/site namespace, not a browser-supplied principal.
 * @returns {(action: 'login') => boolean} Atomic ten-attempt fixed-window admission callback.
 */
export function createAdmission(
  connection: SqliteConnector,
  migrate: boolean,
  scope: string
) {
  /** Borrowed native synchronous handle; all SQL is fixed and parameterized. */
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_admission_v1 (action TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)'
    );
  }
  db.prepare(
    'SELECT action, start, count FROM workspace_admission_v1 LIMIT 0'
  ).all();
  return (action: 'login') =>
    connection.transactionSync(() => {
      /** One wall-clock observation anchors this atomic fixed admission window. */
      const now = Date.now(),
        period = 600_000,
        key = scope + ':' + action;
      /** Current stored record; expired or absent data is not an authenticated identity. */
      const row = db
        .prepare(
          'SELECT start, count FROM workspace_admission_v1 WHERE action = ?'
        )
        .get(key);
      if (!row || now - Number(row.start) >= period) {
        db.prepare(
          'INSERT INTO workspace_admission_v1 VALUES (?, ?, 1) ON CONFLICT(action) DO UPDATE SET start = excluded.start, count = 1'
        ).run(key, now);
        return true;
      }
      if (Number(row.count) >= 10) {
        return false;
      }
      db.prepare(
        'UPDATE workspace_admission_v1 SET count = count + 1 WHERE action = ?'
      ).run(key);
      return true;
    });
}
