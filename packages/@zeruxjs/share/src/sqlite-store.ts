import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import {
  ShortLinkError,
  type ShortLinkStore,
  type ShortLinkRecord,
} from './server.js';
/** Wrap a borrowed host-qualified persistent native SQLite connector using its real synchronous transaction pin. No connection starts/closes and no independent transaction engine is implemented.
 * @param {{
  database: SqliteConnector;
  persistent: true;
  table?: string;
  initialize?: boolean;
}} options - Explicit borrowed database, durable-file qualification, fixed table and opt-in schema initialization.
 * @param {SqliteConnector} options.database - Borrowed native synchronous connector on a host-qualified persistent file.
 * @param {true} options.persistent - Explicit host durability qualification, never inference.
 * @param {string} options.table - Optional fixed validated table name.
 * @param {boolean} options.initialize - Explicit opt-in schema initialization.
 * @returns {ShortLinkStore} Trusted low-level reservation/CAS adapter; service authorization and complete record validation remain separate.
 */
export function createSqliteShortLinkStore(options: {
  /** Borrowed native synchronous SQLite connector; host closes it after all services drain. */
  database: SqliteConnector;
  /** Explicit true qualifies host-managed persistent-file storage; never use it to bless :memory:. */
  persistent: true;
  /** Optional validated host-owned table, default share_short_links. */
  table?: string;
  /** Create the schema only with explicit true; migrations remain trusted host operations. */
  initialize?: boolean;
}): ShortLinkStore {
  if (
    !options ||
    typeof options !== 'object' ||
    Object.keys(options).some(
      (k) => !['database', 'persistent', 'table', 'initialize'].includes(k)
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(options)).some(
      (d) => !('value' in d)
    )
  ) {
    throw new ShortLinkError('INVALID');
  }
  /** Borrowed host-qualified native synchronous connector; this adapter never opens or closes it. */
  const db = options.database;
  /** Validated fixed host-owned table name, default share_short_links; schema/migrations remain host-owned. */
  const table = options.table ?? 'share_short_links';
  if (
    options.persistent !== true ||
    db?.synchronousTransactions !== true ||
    typeof db.transactionSync !== 'function' ||
    typeof table !== 'string' ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(table) ||
    (options.initialize !== undefined &&
      typeof options.initialize !== 'boolean')
  ) {
    throw new ShortLinkError('INVALID');
  }
  /** Construct a typed literal equality predicate; no raw SQL or shell interpolation is accepted.
   * @param {string} field - Fixed key/revision column selected by this adapter.
   * @param {string} value - Literal opaque key or expected revision value.
   * @returns {object} Typed database equality predicate, not raw SQL.
   */
  const eq = (field: string, value: string) => ({
    field,
    operator: 'eq' as const,
    value,
  });
  /** Check explicit cooperative cancellation before entering native synchronous work; a timer cannot preempt a blocking SQLite call.
   * @param {AbortSignal} value - Borrowed initiating signal from the service.
   * @returns {void} Completes only for an un-aborted native AbortSignal.
   */
  function signal(value: AbortSignal) {
    if (!(value instanceof AbortSignal)) {
      throw new ShortLinkError('INVALID');
    }
    value.throwIfAborted();
  }
  /** Require the service’s opaque fixed-length reservation key before database work.
   * @param {string} value - Hex SHA-256 namespace/slug key, not a raw user identity.
   * @returns {void} Completes only for a supported opaque key.
   */
  function key(value: string) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      throw new ShortLinkError('INVALID');
    }
  }
  /** Serialize a bounded own-data scalar record for trusted low-level persistence. Does not authorize tenants, encrypt payloads or replace service record-policy validation.
   * @param {Readonly<ShortLinkRecord>} value - Trusted service-owned immutable record; nested/accessor/nonplain values reject.
   * @returns {string} At-most16-KiB JSON record; malformed input fails before any transaction write.
   */
  function encoded(value: Readonly<ShortLinkRecord>) {
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length > 32 ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(
        (d) =>
          !('value' in d) ||
          (d.value !== null &&
            !['string', 'number', 'boolean'].includes(typeof d.value))
      )
    ) {
      throw new ShortLinkError('INVALID');
    }
    /** Bounded scalar JSON row payload; this storage encoding is not encryption. */
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 16384) {
      throw new ShortLinkError('LIMIT');
    }
    return text;
  }
  try {
    if (options.initialize) {
      db.transactionSync((tx) => {
        /** Native pinned operation result checked before accepting its affected-row count. */
        const result = tx.execute({
          op: 'createTable',
          table,
          ifNotExists: true,
          columns: [
            { name: 'key', type: 'text', primary: true, notNull: true },
            { name: 'revision', type: 'text', notNull: true },
            { name: 'payload', type: 'text', notNull: true },
          ],
        });
        if (!result.ok) {
          throw new Error('Short-link table initialization failed');
        }
      });
    }
  } catch (cause) {
    throw new ShortLinkError('UNAVAILABLE', 'unknown', cause);
  }
  return {
    capability: 'short-links-cas-v1',
    durable: true,
    /** Use one real synchronous pin to read-before-insert a create-only reservation. Existing rows/tombstones are never removed or reused.
     * @param {string} id - Opaque service namespace/slug key.
     * @param {Readonly<ShortLinkRecord>} value - Complete authorized service record; payload encoded before the pin.
     * @param {AbortSignal} abort - Borrowed cooperative signal checked before native work.
     * @returns {Promise<boolean>} True only for one committed new row; false for an existing permanent reservation.
     */
    async reserve(id, value, abort) {
      signal(abort);
      key(id);
      /** Complete bounded encoded record prepared before transactional persistence. */
      const payload = encoded(value);
      return db.transactionSync(
        (tx) => {
          /** Pinned existing reservation lookup; absence alone permits a create-only insert on the same pin. */
          const found = tx.select({ table, where: eq('key', id), limit: 1 });
          if (!found.ok) {
            throw new ShortLinkError('UNAVAILABLE');
          }
          if (found.rows?.length) {
            return false;
          }
          /** Native pinned operation result checked before accepting its affected-row count. */
          const result = tx.insert({
            table,
            values: { key: id, revision: value.revision, payload },
          });
          if (!result.ok || result.affectedCount !== 1) {
            throw new ShortLinkError('UNAVAILABLE');
          }
          return true;
        },
        { signal: abort }
      );
    },
    /** Read one bounded row under the native pin and parse its own payload; full tenant/record/destination policy belongs to the borrowing service.
     * @param {string} id - Opaque namespace/slug key.
     * @param {AbortSignal} abort - Borrowed cooperative native-work signal.
     * @returns {Promise<ShortLinkRecord | null>} Parsed row or null for absence; malformed/duplicate rows fail explicitly.
     */
    async read(id, abort) {
      signal(abort);
      key(id);
      return db.transactionSync(
        (tx) => {
          /** Native pinned operation result checked before accepting its affected-row count. */
          const result = tx.select({
            table,
            where: eq('key', id),
            limit: 2,
          });
          if (!result.ok || (result.rows?.length ?? 0) > 1) {
            throw new ShortLinkError('UNAVAILABLE');
          }
          /** Single selected stored row; duplicates or malformed values fail rather than guessing. */
          const row = result.rows?.[0];
          if (row === undefined) {
            return null;
          }
          if (!row || typeof row !== 'object') {
            throw new ShortLinkError('UNAVAILABLE');
          }
          /** Own payload data descriptor checked before reading/parsing stored JSON. */
          const field = Object.getOwnPropertyDescriptor(row, 'payload');
          if (
            !field ||
            !('value' in field) ||
            typeof field.value !== 'string' ||
            Buffer.byteLength(field.value) > 16384
          ) {
            throw new ShortLinkError('UNAVAILABLE');
          }
          return JSON.parse(field.value) as ShortLinkRecord;
        },
        { signal: abort }
      );
    },
    /** Atomically update exactly one matching key/revision under the existing synchronous pin. No silent last-writer-wins or physical deletion is provided.
     * @param {string} id - Opaque fixed namespace/slug key.
     * @param {string} revision - Expected current revision from the authorized service read.
     * @param {Readonly<ShortLinkRecord>} value - Complete replacement record with a new service-owned revision.
     * @param {AbortSignal} abort - Borrowed cooperative signal; native cancellation cannot be forced.
     * @returns {Promise<boolean>} True for one committed replacement, false for stale/missing revision; malformed native results throw/rollback.
     */
    async compareAndSwap(id, revision, value, abort) {
      signal(abort);
      key(id);
      if (typeof revision !== 'string' || revision.length > 64) {
        throw new ShortLinkError('INVALID');
      }
      /** Complete bounded encoded record prepared before transactional persistence. */
      const payload = encoded(value);
      return db.transactionSync(
        (tx) => {
          /** Native pinned operation result checked before accepting its affected-row count. */
          const result = tx.update({
            table,
            where: { and: [eq('key', id), eq('revision', revision)] },
            values: { revision: value.revision, payload },
          });
          if (
            !result.ok ||
            (result.affectedCount !== 0 && result.affectedCount !== 1)
          ) {
            throw new ShortLinkError('UNAVAILABLE');
          }
          return result.affectedCount === 1;
        },
        { signal: abort }
      );
    },
  };
}
