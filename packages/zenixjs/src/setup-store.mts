import { createHash } from 'node:crypto';
import type {
  SqliteConnector,
  SqliteSyncTransaction,
} from '@zeruxjs/db-sqlite';
export interface SetupRecord {
  schema: 1;
  scope: string;
  claim: string;
  revision: number;
  state: 'claimed' | 'complete';
  createdAt: number;
}
export interface SetupStore {
  contract: 'zenix-setup-cas-v1';
  durability: 'durable';
  read(scope: string): Promise<SetupRecord | null>;
  claim(record: Readonly<SetupRecord>): Promise<boolean>;
  complete(record: Readonly<SetupRecord>): Promise<boolean>;
}
const table = 'zenix_setup_v1';
function checked(r: SetupRecord) {
  if (
    !r ||
    r.schema !== 1 ||
    !/^[a-f0-9]{64}$/.test(r.scope) ||
    !/^[a-f0-9]{64}$/.test(r.claim) ||
    ![1, 2].includes(r.revision) ||
    r.state !== (r.revision === 1 ? 'claimed' : 'complete') ||
    !Number.isSafeInteger(r.createdAt) ||
    r.createdAt < 0
  )
    throw Error('Invalid setup record');
  return {
    schema: 1 as const,
    scope: r.scope,
    claim: r.claim,
    revision: r.revision,
    state: r.state,
    createdAt: r.createdAt,
  };
}
export function setupScope(tenant: string, site: string) {
  return createHash('sha256')
    .update(JSON.stringify([tenant, site]))
    .digest('hex');
}
/** Borrowed real file-backed SQLite connector; host qualifies durability. No connection is closed. */
export function createSqliteSetupStore(options: {
  connection: SqliteConnector;
  migrate?: boolean;
}): SetupStore {
  if (
    !options ||
    (options.migrate !== undefined && typeof options.migrate !== 'boolean')
  )
    throw Error('Invalid setup storage configuration');
  const db = options.connection;
  if (
    db?.synchronousTransactions !== true ||
    typeof db.transactionSync !== 'function'
  )
    throw Error('SQLite setup transactions required');
  const read = (tx: SqliteSyncTransaction, scope: string) => {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw Error('Invalid setup scope');
    const result = tx.select({
      table,
      where: { field: 'scope', operator: 'eq', value: scope },
      limit: 2,
    });
    if (!result.ok || !Array.isArray(result.rows) || result.rows.length > 1)
      throw Error('Setup storage unavailable');
    if (!result.rows.length) return null;
    const row = result.rows[0] as { document: string };
    if (
      typeof row.document !== 'string' ||
      Buffer.byteLength(row.document) > 2048
    )
      throw Error('Invalid setup document');
    const record = checked(JSON.parse(row.document));
    if (record.scope !== scope) throw Error('Setup scope mismatch');
    return record;
  };
  db.transactionSync((tx) => {
    if (options.migrate) {
      const result = tx.execute({
        op: 'createTable',
        table,
        ifNotExists: true,
        columns: [
          { name: 'scope', type: 'text', primary: true },
          { name: 'claim', type: 'text', notNull: true },
          { name: 'revision', type: 'integer', notNull: true },
          { name: 'document', type: 'text', notNull: true },
        ],
      });
      if (!result.ok) throw Error('Setup migration failed');
    }
    const r = tx.select({
      table,
      columns: ['scope', 'claim', 'revision', 'document'],
      limit: 1,
    });
    if (!r.ok) throw Error('Setup migration required');
  });
  return {
    contract: 'zenix-setup-cas-v1',
    durability: 'durable',
    async read(scope) {
      return db.transactionSync((tx) => read(tx, scope));
    },
    async claim(input) {
      const record = checked(input);
      if (record.state !== 'claimed') throw Error('Invalid setup claim');
      return db.transactionSync((tx) => {
        if (read(tx, record.scope)) return false;
        const r = tx.insert({
          table,
          values: {
            scope: record.scope,
            claim: record.claim,
            revision: 1,
            document: JSON.stringify(record),
          },
        });
        if (!r.ok) throw Error('Setup claim failed');
        return (r.affectedCount ?? r.rowCount) === 1;
      });
    },
    async complete(input) {
      const record = checked(input);
      if (record.state !== 'complete') throw Error('Invalid setup completion');
      return db.transactionSync((tx) => {
        const old = read(tx, record.scope);
        if (
          !old ||
          old.state !== 'claimed' ||
          old.claim !== record.claim ||
          old.createdAt !== record.createdAt
        )
          return false;
        const r = tx.update({
          table,
          values: { revision: 2, document: JSON.stringify(record) },
          where: {
            and: [
              { field: 'scope', operator: 'eq', value: record.scope },
              { field: 'claim', operator: 'eq', value: record.claim },
              { field: 'revision', operator: 'eq', value: 1 },
            ],
          },
        });
        if (!r.ok) throw Error('Setup completion failed');
        return (r.affectedCount ?? r.rowCount) === 1;
      });
    },
  };
}
