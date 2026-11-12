import type { CampaignState, CampaignStore } from './campaigns.js';

export interface CampaignDatabaseResult {
  /** Native normalized operation outcome; callers check before reading data/counts. */
  ok: boolean;
  /** Private native result rows; never public diagnostics. */
  rows?: unknown[];
  /** Exact safe native affected rows required for CAS/deletion contracts. */
  affectedCount?: number;
  /** Compatible native count fallback only when affectedCount is absent. */
  rowCount?: number;
}
/** Narrow @zeruxjs/db adapter contract; writes need atomic affectedCount. */
export interface CampaignDatabaseConnection {
  /** Apply explicit structured schema through the borrowed connector.
   * @param {any} input - Explicit trusted structural connector operation; validation belongs to the database package.
   * @returns {Promise<CampaignDatabaseResult> | CampaignDatabaseResult} Native normalized schema outcome; no fake transaction is inferred.
   */
  createTable(
    input: any
  ): Promise<CampaignDatabaseResult> | CampaignDatabaseResult;
  /** Reserve explicit structured private data through the borrowed connector.
   * @param {any} input - Explicit trusted structural connector operation; validation belongs to the database package.
   * @returns {Promise<CampaignDatabaseResult> | CampaignDatabaseResult} Unique insert outcome required for durable callers.
   */
  insert(input: any): Promise<CampaignDatabaseResult> | CampaignDatabaseResult;
  /** Read explicit structured private rows through the borrowed connector.
   * @param {any} input - Explicit trusted structural connector operation; validation belongs to the database package.
   * @returns {Promise<CampaignDatabaseResult> | CampaignDatabaseResult} Native private rows with connector-owned validation.
   */
  select(input: any): Promise<CampaignDatabaseResult> | CampaignDatabaseResult;
  /** Apply a structured revision predicate through the borrowed connector.
   * @param {any} input - Explicit trusted structural connector operation; validation belongs to the database package.
   * @returns {Promise<CampaignDatabaseResult> | CampaignDatabaseResult} Exact affectedCount required for CAS.
   */
  update(input: any): Promise<CampaignDatabaseResult> | CampaignDatabaseResult;
  /** Erase only explicit structured authorized records through the borrowed connector.
   * @param {any} input - Explicit trusted structural connector operation; validation belongs to the database package.
   * @returns {Promise<CampaignDatabaseResult> | CampaignDatabaseResult} Atomic affectedCount required where erasure contracts demand it.
   */
  delete?(input: any): Promise<CampaignDatabaseResult> | CampaignDatabaseResult;
  /** Create explicitly declared structured indexes when supported.
   * @param {any} input - Explicit trusted structural connector operation; validation belongs to the database package.
   * @returns {Promise<CampaignDatabaseResult> | CampaignDatabaseResult} Optional native schema result; no universal driver support.
   */
  createIndex?(
    input: any
  ): Promise<CampaignDatabaseResult> | CampaignDatabaseResult;
}
/** Persist bounded private campaign documents with unique insert and exact version-checked updates.
 * @param {CampaignDatabaseConnection} db - Borrowed real structured database; host owns tenant scope and close.
 * @param {string} table - Validated private table name, default zerux_email_campaigns.
 * @returns {CampaignStore} Borrowed database adapter; host supplies durable commit, tenant scope and native lifecycle.
 */
export function createDatabaseCampaignStore(
  db: CampaignDatabaseConnection,
  table = 'zerux_email_campaigns'
): CampaignStore {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
    throw new TypeError('Invalid campaign table name');
  }
  let initializing: Promise<void> | undefined;
  /** Coalesce lazy schema initialization and release a failed initialization promise for later attempts.

 * @returns {Promise<void>} Borrowed database schema accepted; no connection is opened here. */
  const ensure = () =>
    (initializing ??= (async () => {
      /** Private structured native outcome checked before interpreting rows or affected counts. */
      const result = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 96,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!result?.ok) {
        throw new Error('Campaign table initialization failed');
      }
    })().catch((e) => {
      initializing = undefined;
      throw e;
    }));
  /** Serialize a checkpoint within the conservative portable TEXT ceiling.
   * @param {CampaignState} state - Complete private campaign checkpoint.
   * @returns {string} At most 60000 UTF-8 bytes; reduce batch size if it overflows. */
  const encoded = (state: CampaignState) => {
    /** Private checkpoint JSON whose encoded UTF-8 size is checked before insertion/update. */
    const json = JSON.stringify(state);
    // Portable SQL TEXT (including MySQL's 64 KiB TEXT) requires a conservative bound.
    if (Buffer.byteLength(json) > 60_000) {
      throw new RangeError(
        'Campaign checkpoint exceeds portable TEXT limit; lower batchSize'
      );
    }
    return json;
  };
  /** Read one private document and check its identity/revision against row metadata.
   * @param {string} id - Exact private campaign document identity.
   * @returns {Promise<CampaignState | null>} Parsed state or null; this is not full untrusted-snapshot schema validation.
   */
  async function load(id: string): Promise<CampaignState | null> {
    await ensure();
    /** Private structured native outcome checked before interpreting rows or affected counts. */
    const result = await db.select({
      table,
      columns: ['id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: id },
      limit: 1,
    });
    if (!result?.ok) {
      throw new Error('Campaign read failed');
    }
    /** One private native document row, never a public report payload. */
    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    if (typeof row.payload_json !== 'string') {
      throw new Error('Corrupt campaign document');
    }
    /** Parsed private state with exact id/revision cross-check; not a complete snapshot schema migration. */
    const parsed = JSON.parse(row.payload_json) as CampaignState;
    if (
      parsed?.id !== id ||
      !Number.isSafeInteger(parsed.version) ||
      parsed.version !== Number(row.version)
    ) {
      throw new Error('Campaign document version mismatch');
    }
    return parsed;
  }
  return {
    /** Read one private document and check its identity/revision against row metadata.
     * @param {string} id - Exact private campaign document identity.
     * @returns {Promise<CampaignState | null>} Parsed state or null; this is not full untrusted-snapshot schema validation.
     */
    async load(id) {
      return load(id);
    },
    /** Reserve a new campaign state without overwriting an existing identity.
     * @param {CampaignState} state - Complete private campaign checkpoint; bounded portable JSON storage applies.
     * @returns {Promise<boolean>} True only for insertion; existing identity returns false, other failures reject.
     */
    async create(state) {
      await ensure();
      try {
        /** Private structured native outcome checked before interpreting rows or affected counts. */
        const result = await db.insert({
          table,
          values: {
            id: state.id,
            version: state.version,
            payload_json: encoded(state),
          },
        });
        if (result?.ok) {
          return true;
        }
      } catch (e) {
        if (await load(state.id)) {
          return false;
        }
        throw e;
      }
      if (await load(state.id)) {
        return false;
      }
      throw new Error('Campaign creation failed');
    },
    /** Write one next revision only against an exact expected version.
     * @param {CampaignState} state - Complete private campaign checkpoint; bounded portable JSON storage applies.
     * @param {number} expected - Positive exact prior revision; next state must increment by one.
     * @returns {Promise<boolean>} True for one actual affected row; unknown counts reject and conflicts return false.
     */
    async save(state, expected) {
      if (
        !Number.isSafeInteger(expected) ||
        expected < 1 ||
        state.version !== expected + 1
      ) {
        return false;
      }
      await ensure();
      /** Private structured native outcome checked before interpreting rows or affected counts. */
      const result = await db.update({
        table,
        values: { version: state.version, payload_json: encoded(state) },
        where: {
          and: [
            { field: 'id', operator: 'eq', value: state.id },
            { field: 'version', operator: 'eq', value: expected },
          ],
        },
      });
      if (!result?.ok) {
        throw new Error('Campaign checkpoint write failed');
      }
      /** Actual safe single-row CAS count; unknown or out-of-range counts reject. */
      const affected = result.affectedCount ?? result.rowCount;
      if (affected === undefined) {
        throw new Error('Campaign store connector missing affectedCount');
      }
      if (!Number.isSafeInteger(affected) || affected < 0 || affected > 1) {
        throw new Error('Invalid campaign CAS result');
      }
      return affected === 1;
    },
  };
}
