import { createHash } from 'node:crypto';
import type {
  SqliteConnector,
  SqliteSyncTransaction,
} from '@zeruxjs/db-sqlite';
/** Durable secret-free setup state; claim and completion are separate from CMS content transactions. */
export interface SetupRecord {
  /** Persisted setup record format version. */
  schema: 1;
  /** SHA-256 identity of the fixed tenant/site tuple; not authorization. */
  scope: string;
  /** High-entropy claim binding retained for trusted operator recovery. */
  claim: string;
  /** Exactly one for claimed state or two for complete state. */
  revision: number;
  /** Supported one-time claim/completion state; no automatic expired-claim takeover. */
  state: 'claimed' | 'complete';
  /** Original nonnegative host timestamp retained unchanged on completion. */
  createdAt: number;
}
/** Host-qualified durable CAS journal; no default memory or implicit migration is supplied. */
export interface SetupStore {
  /** Explicit linearizable setup CAS contract identifier. */
  contract: 'zenix-setup-cas-v1';
  /** Host assertion requiring a qualified file-backed durable adapter. */
  durability: 'durable';
  /** Read one fixed scope without claiming or mutating setup.
   * @param {string} scope - Validated hashed tenant/site tuple.
   * @returns {Promise<SetupRecord | null>} Private durable record or genuine absence.
   */
  read(scope: string): Promise<SetupRecord | null>;
  /** Atomically reserve an absent scope; an existing claim never expires automatically.
   * @param {Readonly<SetupRecord>} record - Secret-free revision-one claimed state.
   * @returns {Promise<boolean>} True only for the successful unique reservation.
   */
  claim(record: Readonly<SetupRecord>): Promise<boolean>;
  /** Conditionally complete the exact original claim with revision/time binding.
   * @param {Readonly<SetupRecord>} record - Secret-free revision-two complete state.
   * @returns {Promise<boolean>} True only after persistence; a stale/mismatched claim remains false.
   */
  complete(record: Readonly<SetupRecord>): Promise<boolean>;
}
/** Fixed setup journal table; application initialization never derives SQL names from input. */
const table = 'zenix_setup_v1';
/** Validate persisted setup facts without accepting secret payloads or arbitrary states.
 * @param {SetupRecord} r - Candidate durable record read from private bounded storage or trusted caller.
 * @returns {SetupRecord} New validated record snapshot; no database write is performed.
 */
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
  ) {
    throw Error('Invalid setup record');
  }
  return {
    schema: 1 as const,
    scope: r.scope,
    claim: r.claim,
    revision: r.revision,
    state: r.state,
    createdAt: r.createdAt,
  };
}
/** Derive a deterministic tenant/site journal key without claiming identity anonymization.
 * @param {string} tenant - Fixed host-verified tenant identifier.
 * @param {string} site - Fixed host-verified site identifier.
 * @returns {string} SHA-256 JSON-tuple identity; authorization remains host-owned.
 */
export function setupScope(tenant: string, site: string) {
  return createHash('sha256')
    .update(JSON.stringify([tenant, site]))
    .digest('hex');
}
/** Borrowed real file-backed SQLite connector; host qualifies durability. No connection is closed.
 * @param {object} options - Explicit qualified private connector and schema preparation policy.
 * @param {SqliteConnector} options.connection - Borrowed synchronous file-backed connector; host retains lifetime ownership.
 * @param {boolean} options.migrate - Explicitly approve table initialization; otherwise require existing schema.
 * @returns {SetupStore} Durable CAS adapter over the borrowed connector, without a close/disconnect method.
 */
export function createSqliteSetupStore(options: {
  connection: SqliteConnector;
  migrate?: boolean;
}): SetupStore {
  if (
    !options ||
    (options.migrate !== undefined && typeof options.migrate !== 'boolean')
  ) {
    throw Error('Invalid setup storage configuration');
  }
  /** Borrowed qualified SQLite connector; this adapter never disconnects it. */
  const db = options.connection;
  if (
    db?.synchronousTransactions !== true ||
    typeof db.transactionSync !== 'function'
  ) {
    throw Error('SQLite setup transactions required');
  }
  /** Read and validate one scope-bound journal record on the current synchronous transaction.
   * @param {SqliteSyncTransaction} tx - Borrowed pinned synchronous transaction.
   * @param {string} scope - Validated hashed tenant/site key.
   * @returns {SetupRecord | null} Bounded validated persisted record or absence.
   */
  const read = (tx: SqliteSyncTransaction, scope: string) => {
    if (!/^[a-f0-9]{64}$/.test(scope)) {
      throw Error('Invalid setup scope');
    }
    /** Current pinned query result; uncertain/malformed results fail closed. */
    const result = tx.select({
      table,
      where: { field: 'scope', operator: 'eq', value: scope },
      limit: 2,
    });
    if (!result.ok || !Array.isArray(result.rows) || result.rows.length > 1) {
      throw Error('Setup storage unavailable');
    }
    if (!result.rows.length) {
      return null;
    }
    /** Single persisted bounded JSON document; duplicates reject before this read. */
    const row = result.rows[0] as { document: string };
    if (
      typeof row.document !== 'string' ||
      Buffer.byteLength(row.document) > 2048
    ) {
      throw Error('Invalid setup document');
    }
    /** Validated immutable setup fact without secret/password data. */
    const record = checked(JSON.parse(row.document));
    if (record.scope !== scope) {
      throw Error('Setup scope mismatch');
    }
    return record;
  };
  db.transactionSync((tx) => {
    if (options.migrate) {
      /** Current pinned query result; uncertain/malformed results fail closed. */
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
      if (!result.ok) {
        throw Error('Setup migration failed');
      }
    }
    /** Pinned schema/write receipt checked before reporting durable success. */
    const r = tx.select({
      table,
      columns: ['scope', 'claim', 'revision', 'document'],
      limit: 1,
    });
    if (!r.ok) {
      throw Error('Setup migration required');
    }
  });
  return {
    contract: 'zenix-setup-cas-v1',
    durability: 'durable',
    async read(scope) {
      return db.transactionSync((tx) => read(tx, scope));
    },
    async claim(input) {
      /** Validated immutable setup fact without secret/password data. */
      const record = checked(input);
      if (record.state !== 'claimed') {
        throw Error('Invalid setup claim');
      }
      return db.transactionSync((tx) => {
        if (read(tx, record.scope)) {
          return false;
        }
        /** Pinned schema/write receipt checked before reporting durable success. */
        const r = tx.insert({
          table,
          values: {
            scope: record.scope,
            claim: record.claim,
            revision: 1,
            document: JSON.stringify(record),
          },
        });
        if (!r.ok) {
          throw Error('Setup claim failed');
        }
        return (r.affectedCount ?? r.rowCount) === 1;
      });
    },
    async complete(input) {
      /** Validated immutable setup fact without secret/password data. */
      const record = checked(input);
      if (record.state !== 'complete') {
        throw Error('Invalid setup completion');
      }
      return db.transactionSync((tx) => {
        /** Existing claimed record; completion checks exact claim/time and revision before CAS. */
        const old = read(tx, record.scope);
        if (
          !old ||
          old.state !== 'claimed' ||
          old.claim !== record.claim ||
          old.createdAt !== record.createdAt
        ) {
          return false;
        }
        /** Pinned schema/write receipt checked before reporting durable success. */
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
        if (!r.ok) {
          throw Error('Setup completion failed');
        }
        return (r.affectedCount ?? r.rowCount) === 1;
      });
    },
  };
}
