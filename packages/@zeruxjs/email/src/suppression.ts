import { createHash } from 'node:crypto';
import { validateEmailAddress, addressString } from './validation.js';
import type { CampaignDatabaseConnection } from './campaign-storage.js';

export type MarketingFeedbackKind =
  | 'hard-bounce'
  | 'soft-bounce'
  | 'complaint'
  | 'manual';
export interface MarketingSuppressionRecord {
  /** SHA-256 of normalized address, used as stable internal key. */
  id: string;
  /** Private canonical mailbox stored in this legacy suppression document. */
  email: string;
  /** Positive monotonically incremented local record revision for CAS. */
  version: number;
  /** Sticky admission denial; this API never automatically clears it. */
  blocked: boolean;
  /** Recorded hard/soft-bounce, complaint or explicit manual suppression reason. */
  reason: MarketingFeedbackKind;
  /** Count of retained distinct accepted soft-bounce updates, not distinct messages globally. */
  softBounces: number;
  /** Validated feedback epoch time; supplied authenticated feedback owns its timestamp. */
  lastAt: number;
  /** Bounded most-recent 128 event IDs; this is not an indefinite replay ledger. */
  eventIds: string[];
}
export interface MarketingSuppressionStore {
  /** Read one private suppression record by canonical derived identity.
   * @param {string} id - Derived private canonical-mailbox identity; hashing is not anonymization.
   * @returns {Promise<MarketingSuppressionRecord | null>} Stored private record or null; outages propagate rather than silently allowing marketing.
   */
  load(id: string): Promise<MarketingSuppressionRecord | null>;
  /** Reserve a new suppression identity atomically in this supplied store.
   * @param {MarketingSuppressionRecord} record - Private complete record including plaintext mailbox and next version.
   * @returns {Promise<boolean>} True only for a new record; duplicate identity returns false.
   */
  create(record: MarketingSuppressionRecord): Promise<boolean>;
  /** Update only the expected revision and require a single affected record.
   * @param {MarketingSuppressionRecord} record - Private complete record including plaintext mailbox and next version.
   * @param {number} expectedVersion - Exact prior committed revision required by this store contract.
   * @returns {Promise<boolean>} True only for one committed CAS update; conflict returns false.
   */
  save(
    record: MarketingSuppressionRecord,
    expectedVersion: number
  ): Promise<boolean>;
}
export interface MarketingFeedback {
  /** Private canonical mailbox stored in this legacy suppression document. */
  email: string;
  /** Provider/operator feedback identity, validated but not authenticated by this schema. */
  eventId: string;
  /** Explicit allowed suppression event discriminator. */
  kind: MarketingFeedbackKind;
  /** Source must be authenticated by provider webhook caller, outside this service. */
  at?: number;
}
/** Derive a stable legacy suppression key; hashing is pseudonymous linkage, not anonymization.
 * @param {string} email - Already canonical private mailbox.
 * @returns {string} SHA-256 lookup identity; record still contains its private mailbox. */
const keyFor = (email: string) =>
  createHash('sha256').update(email).digest('hex');
/** Validate and lowercase a private mailbox without authenticating its owner.
 * @param {string} email - Private literal mailbox.
 * @returns {string} Canonical mailbox for this legacy ledger. */
const canonical = (email: string) =>
  addressString(validateEmailAddress(email)).trim().toLowerCase();
/** Validate bounded feedback identity syntax without authenticating provider authorship.
 * @param {unknown} id - Candidate provider/operator event identity.
 * @returns {boolean} True only for the supported static identity syntax. */
const validEvent = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9:_./-]{1,160}$/.test(id);
/** Create a local cloned-record CAS fixture; no restart/multi-worker durability is implied.
 * @returns {MarketingSuppressionStore} Process-local reference store; production host supplies durable unique insert/CAS.
 */
export function createMemoryMarketingSuppressionStore(): MarketingSuppressionStore {
  /** Process-local cloned suppression documents; no durability or cross-worker coordination. */
  const map = new Map<string, MarketingSuppressionRecord>();
  return {
    /** Read one private suppression record by canonical derived identity.
     * @param {string} id - Derived private canonical-mailbox identity; hashing is not anonymization.
     * @returns {Promise<MarketingSuppressionRecord | null>} Stored private record or null; outages propagate rather than silently allowing marketing.
     */
    async load(id) {
      /** Private current record or native write outcome according to this store operation. */
      const result = map.get(id);
      return result ? structuredClone(result) : null;
    },
    /** Reserve a new suppression identity atomically in this supplied store.
     * @param {MarketingSuppressionRecord} r - Private complete record including plaintext mailbox and next version.
     * @returns {Promise<boolean>} True only for a new record; duplicate identity returns false.
     */
    async create(r) {
      if (map.has(r.id)) {
        return false;
      }
      map.set(r.id, structuredClone(r));
      return true;
    },
    /** Update only the expected revision and require a single affected record.
     * @param {MarketingSuppressionRecord} r - Private complete record including plaintext mailbox and next version.
     * @param {number} expected - Exact prior committed revision required for CAS.
     * @returns {Promise<boolean>} True only for one committed CAS update; conflict returns false.
     */
    async save(r, expected) {
      /** Current committed private revision; conflicts require reloading before recomputing. */
      const old = map.get(r.id);
      if (!old || old.version !== expected || r.version !== expected + 1) {
        return false;
      }
      map.set(r.id, structuredClone(r));
      return true;
    },
  };
}
/** Adapt a borrowed structured database with lazy schema initialization and exact create/CAS outcomes.
 * @param {CampaignDatabaseConnection} db - Borrowed structured database; host scopes tenant/table access and native lifecycle.
 * @param {string} table - Validated host table identifier; default zerux_marketing_suppressions.
 * @returns {MarketingSuppressionStore} Private document store; host qualifies durable unique inserts/committed reads and closes the database.
 */
export function createDatabaseMarketingSuppressionStore(
  db: CampaignDatabaseConnection,
  table = 'zerux_marketing_suppressions'
): MarketingSuppressionStore {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
    throw new TypeError('Invalid suppression table');
  }
  let ready: Promise<void> | undefined;
  /** Coalesce lazy schema initialization and permit a later attempt after initialization failure.

 * @returns {Promise<void>} Borrowed database schema accepted; no native connection is acquired. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Private structured database result checked before interpreting rows or affected count. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 64,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Suppression table unavailable');
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  /** Serialize a private complete suppression document for its explicitly trusted store.
   * @param {MarketingSuppressionRecord} r - Private mailbox/revision/event data.
   * @returns {string} Private JSON payload; this is not a public-safe projection. */
  const encode = (r: MarketingSuppressionRecord) => JSON.stringify(r);
  /** Read and check document identity/revision against the row columns.
   * @param {string} id - Derived private suppression identity.
   * @returns {Promise<MarketingSuppressionRecord | null>} Private committed document or null; corruption/outage rejects. */
  const load = async (id: string) => {
    await ensure();
    /** Private structured database result checked before interpreting rows or affected count. */
    const r = await db.select({
      table,
      columns: ['id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: id },
      limit: 1,
    });
    if (!r?.ok) {
      throw new Error('Suppression read failed');
    }
    /** Single private persisted document row; malformed payload metadata rejects. */
    const row = r.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    if (typeof row.payload_json !== 'string') {
      throw new Error('Corrupt suppression row');
    }
    /** Parsed private record cross-checked against its stored identity and revision. */
    const value = JSON.parse(row.payload_json) as MarketingSuppressionRecord;
    if (value.id !== id || value.version !== Number(row.version)) {
      throw new Error('Suppression version mismatch');
    }
    return value;
  };
  return {
    load,
    /** Reserve a new suppression identity atomically in this supplied store.
     * @param {MarketingSuppressionRecord} record - Private complete record including plaintext mailbox and next version.
     * @returns {Promise<boolean>} True only for a new record; duplicate identity returns false.
     */
    async create(record) {
      await ensure();
      try {
        /** Private current record or native write outcome according to this store operation. */
        const result = await db.insert({
          table,
          values: {
            id: record.id,
            version: record.version,
            payload_json: encode(record),
          },
        });
        if (result?.ok) {
          return true;
        }
      } catch (e) {
        if (await load(record.id)) {
          return false;
        }
        throw e;
      }
      if (await load(record.id)) {
        return false;
      }
      throw new Error('Suppression insertion failed');
    },
    /** Update only the expected revision and require a single affected record.
     * @param {MarketingSuppressionRecord} record - Private complete record including plaintext mailbox and next version.
     * @param {number} expected - Exact prior committed revision required for CAS.
     * @returns {Promise<boolean>} True only for one committed CAS update; conflict returns false.
     */
    async save(record, expected) {
      if (record.version !== expected + 1) {
        return false;
      }
      await ensure();
      /** Private structured database result checked before interpreting rows or affected count. */
      const r = await db.update({
        table,
        values: { version: record.version, payload_json: encode(record) },
        where: {
          and: [
            { field: 'id', operator: 'eq', value: record.id },
            { field: 'version', operator: 'eq', value: expected },
          ],
        },
      });
      if (!r?.ok) {
        throw new Error('Suppression update failed');
      }
      /** Exact native update count required to distinguish CAS success from conflict. */
      const affected = r.affectedCount ?? r.rowCount;
      if (affected === undefined) {
        throw new Error('Suppression CAS requires affectedCount');
      }
      if (!Number.isSafeInteger(affected) || affected < 0 || affected > 1) {
        throw new Error('Invalid suppression CAS response');
      }
      return affected === 1;
    },
  };
}
/** Apply authenticated feedback through bounded CAS attempts without clearing prior suppression.
 * @param {{
  store: MarketingSuppressionStore;
  softBounceThreshold?: number;
  now?: () => number;
}} options - Explicit committed store, soft-bounce threshold and optional trusted clock.
 * @param {MarketingSuppressionStore} options.store - Explicit committed private record store.
 * @param {number} options.softBounceThreshold - Threshold 1–20, default three.
 * @param {() => number} options.now - Optional trusted epoch clock.
 * @returns {object} Status/admission/update methods; no endpoint authentication is supplied.
 */
export function createMarketingSuppressionService(options: {
  /** Host-supplied committed record store; default fallback is not selected here. */
  store: MarketingSuppressionStore;
  /** Soft-bounce denial threshold 1–20, default three. */
  softBounceThreshold?: number;
  /** Optional trusted epoch-millisecond clock, default Date.now. */
  now?: () => number;
}) {
  if (
    !options?.store ||
    typeof options.store.load !== 'function' ||
    typeof options.store.create !== 'function' ||
    typeof options.store.save !== 'function'
  ) {
    throw new TypeError('Durable suppression store required');
  }
  /** Soft-bounce count needed for sticky blocking, default three, maximum twenty. */
  const threshold = options.softBounceThreshold ?? 3;
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 20) {
    throw new RangeError('Invalid soft bounce threshold');
  }
  /** Explicit trusted clock or Date.now; unsigned event timestamps are not authenticated here. */
  const now = options.now ?? Date.now;
  /** Read the current canonical mailbox suppression record without hiding store failure.
   * @param {string} email - Private validated recipient.
   * @returns {Promise<MarketingSuppressionRecord | null>} Current committed private policy record, or null. */
  const status = async (email: string) =>
    options.store.load(keyFor(canonical(email)));
  /** Read the committed local policy result; store errors must not become an unsuppressed answer.
   * @param {string} email - Validated private mailbox, never authenticated principal identity.
   * @returns {Promise<boolean>} True only for a recorded blocked state.
   */
  async function isSuppressed(email: string) {
    /** Private structured database result checked before interpreting rows or affected count. */
    const r = await status(email);
    return r?.blocked === true;
  }
  /** Record only provider-authenticated or trusted operator feedback; recent retained event IDs deduplicate updates.
   * @param {MarketingFeedback} event - Feedback whose signature/account binding was verified independently by the host.
   * @returns {Promise<{blocked: boolean, duplicate: boolean}>} Committed blocked state and recent-duplicate flag; finite retry exhaustion rejects.
   */
  async function recordFeedback(event: MarketingFeedback) {
    if (
      !event ||
      !validEvent(event.eventId) ||
      !['hard-bounce', 'soft-bounce', 'complaint', 'manual'].includes(
        event.kind
      )
    ) {
      throw new TypeError('Invalid provider feedback');
    }
    /** Canonical private recipient retained in this legacy document. */
    const email = canonical(event.email);
    /** Stable canonical-mailbox hash; host store namespace provides tenant separation. */
    const id = keyFor(email);
    /** Validated authenticated feedback time, bounded against permitted future skew. */
    const at = event.at ?? now();
    if (!Number.isSafeInteger(at) || at < 0 || at > now() + 300_000) {
      throw new TypeError('Invalid provider feedback time');
    }
    // Recompute against the committed revision on conflict; never blindly overwrite another worker.
    for (let attempt = 0; attempt < 30; attempt++) {
      /** Current committed private revision; conflicts require reloading before recomputing. */
      const old = await options.store.load(id);
      if (old?.eventIds.includes(event.eventId)) {
        return { blocked: old.blocked, duplicate: true };
      }
      /** Next count after this nonduplicate retained soft-bounce event. */
      const softBounces =
        (old?.softBounces ?? 0) + (event.kind === 'soft-bounce' ? 1 : 0);
      /** Sticky existing block or threshold/hard-event denial; never auto-cleared. */
      const blocked =
        !!old?.blocked ||
        event.kind !== 'soft-bounce' ||
        softBounces >= threshold;
      /** Candidate next revision with only the most recent 128 event identities. */
      const next: MarketingSuppressionRecord = {
        id,
        email,
        version: (old?.version ?? 0) + 1,
        blocked,
        reason: (() => {
          if (blocked) {
            if (event.kind === 'soft-bounce') {
              return 'soft-bounce';
            }
            if (old?.blocked) {
              return old.reason;
            }
            return event.kind;
          }
          return 'soft-bounce';
        })(),
        softBounces,
        lastAt: at,
        eventIds: [...(old?.eventIds ?? []).slice(-127), event.eventId],
      };
      /** Atomic create/CAS result; conflict reloads within the finite attempt budget. */
      const success = old
        ? await options.store.save(next, old.version)
        : await options.store.create(next);
      if (success) {
        return { blocked, duplicate: false };
      }
    }
    throw new Error('Concurrent suppression updates exceeded retry budget');
  }
  return { status, isSuppressed, recordFeedback };
}
