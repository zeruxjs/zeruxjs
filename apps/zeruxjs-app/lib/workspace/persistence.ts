import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthPersistence, AuthAccountState } from '@zeruxjs/auth';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';

/** Application-owned durable auth CAS. The connector remains owned by the caller. */
export function createAuthPersistence(connection: SqliteConnector, migrate: boolean): AuthPersistence {
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate) db.exec('CREATE TABLE IF NOT EXISTS workspace_auth_v1 (key TEXT PRIMARY KEY, revision TEXT NOT NULL, document TEXT NOT NULL, expires INTEGER NOT NULL)');
  db.prepare('SELECT key, revision, document, expires FROM workspace_auth_v1 LIMIT 0').all();
  return {
    capability: 'auth-cas-v1',
    async read(key) {
      const row = db.prepare('SELECT revision, document, expires FROM workspace_auth_v1 WHERE key = ?').get(key);
      if (!row || Number(row.expires) <= Date.now()) return null;
      if (typeof row.document !== 'string' || Buffer.byteLength(row.document) > 131072 || typeof row.revision !== 'string') throw new Error('AUTH_STORE_INVALID');
      return { revision: row.revision, value: JSON.parse(row.document) as AuthAccountState };
    },
    async compareAndSwap(key, revision, value, expiresAt) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('AUTH_STORE_INVALID');
      const document = JSON.stringify(value);
      if (Buffer.byteLength(document) > 131072) throw new Error('AUTH_STORE_INVALID');
      return connection.transactionSync(() => {
        db.prepare('DELETE FROM workspace_auth_v1 WHERE key = ? AND expires <= ?').run(key, Date.now());
        const next = randomBytes(24).toString('base64url');
        const result = revision === null
          ? db.prepare('INSERT INTO workspace_auth_v1 VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING').run(key, next, document, expiresAt)
          : db.prepare('UPDATE workspace_auth_v1 SET revision = ?, document = ?, expires = ? WHERE key = ? AND revision = ?').run(next, document, expiresAt, key, revision);
        return result.changes === 1;
      });
    },
  };
}

/** Fixed per-account admission persists across workers/restarts; no caller IP/header identity. */
export function createAdmission(connection: SqliteConnector, migrate: boolean, scope: string) {
  const db = connection.getNativeConnection() as DatabaseSync;
  if (migrate) db.exec('CREATE TABLE IF NOT EXISTS workspace_admission_v1 (action TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL)');
  db.prepare('SELECT action, start, count FROM workspace_admission_v1 LIMIT 0').all();
  return (action: 'login') => connection.transactionSync(() => {
    const now = Date.now(), period = 600_000, key = scope + ':' + action;
    const row = db.prepare('SELECT start, count FROM workspace_admission_v1 WHERE action = ?').get(key);
    if (!row || now - Number(row.start) >= period) {
      db.prepare('INSERT INTO workspace_admission_v1 VALUES (?, ?, 1) ON CONFLICT(action) DO UPDATE SET start = excluded.start, count = 1').run(key, now);
      return true;
    }
    if (Number(row.count) >= 10) return false;
    db.prepare('UPDATE workspace_admission_v1 SET count = count + 1 WHERE action = ?').run(key);
    return true;
  });
}
