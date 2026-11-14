import { createHash } from 'node:crypto';
import { validateEmailAddress, addressString } from './validation.js';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
import type {
  CampaignContact,
  CampaignPrimitive,
  CampaignSource,
} from './campaigns.js';
/** Bounded list/campaign identity syntax, never executable selectors or roles. */
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Bounded scalar-trait key syntax; prototype-related names are rejected separately. */
const fieldPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export interface MailingContact extends CampaignContact {
  /** Monotonically increasing contact revision used for optimistic writes/deletes. */
  version: number;
  /** Private explicit list memberships; no subscription/analytics consent is inferred. */
  lists: string[];
  /** Trusted epoch creation timestamp retained across later updates. */
  createdAt: number;
  /** Trusted epoch last-update timestamp used by retention eligibility. */
  updatedAt: number;
}
export interface MailingContactStore {
  /** Read one private contact document from the supplied store.
   * @param {string} id - Private canonical-mailbox hash; not anonymized identity.
   * @returns {Promise<MailingContact | null>} Detached/parsed record or null; corruption/outage rejects.
   */
  load(id: string): Promise<MailingContact | null>;
  /** Reserve a new private contact identity using the store unique insertion contract.
   * @param {MailingContact} contact - Complete private contact document for unique insertion or CAS.
   * @returns {Promise<boolean>} True for a new record; duplicate identity returns false.
   */
  create(contact: MailingContact): Promise<boolean>;
  /** Write a private next contact document only against the expected prior revision.
   * @param {MailingContact} contact - Complete private contact document for unique insertion or CAS.
   * @param {number} expectedVersion - Exact expected committed revision for store CAS/deletion.
   * @returns {Promise<boolean>} Native CAS outcome; host adapter must provide exact affected rows.
   */
  save(contact: MailingContact, expectedVersion: number): Promise<boolean>;
  /** Erase one exact private contact revision without removing independent consent/suppression evidence.
   * @param {string} id - Private canonical-mailbox hash; not anonymized identity.
   * @param {number} expectedVersion - Exact expected committed revision for store CAS/deletion.
   * @returns {Promise<boolean>} True only for one matching deletion; stale/missing identity returns false.
   */
  delete?(id: string, expectedVersion: number): Promise<boolean>;
  /** Read an ordered bounded contact page or a list-filtered projection under the owning API.
   * @param {string | null} cursor - Exclusive opaque store cursor; null starts a scan.
   * @param {number} limit - Explicit page budget; list service permits 1–200, default 100.
   * @returns {Promise<object>} Store returns items/cursor/done; list service returns contacts/cursor/done with no unbounded filtered rescan.
   */
  page(
    cursor: string | null,
    limit: number
  ): Promise<{
    /** Private stored contact page; not a public summary. */
    items: MailingContact[];
    /** Exclusive continuation, or null when the store reports completion. */
    nextCursor: string | null;
    /** Explicit store scan completion; a list-filtered empty page can still have a continuation. */
    done: boolean;
  }>;
}
/** Derive the legacy private contact lookup identity from a canonical mailbox.
 * @param {string} email - Private validated mailbox.
 * @returns {string} SHA-256 identity; hashing is not anonymization. */
const keyFor = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
/** Detach private stored contact values with structured cloning.
 * @param {T} value - Private cloneable record/result.
 * @returns {T} Detached copy; unsupported values reject. */
const clone = <T>(value: T) => structuredClone(value);
/** Validate bounded scalar contact traits without accepting executable expression syntax.
 * @param {Record<string, CampaignPrimitive> | undefined} traits - At most forty explicit scalar fields.
 * @returns {Record<string, CampaignPrimitive>} Validated private trait copy; no remote upload occurs. */
const validateTraits = (
  traits: Record<string, CampaignPrimitive> | undefined
) => {
  if (traits === undefined) {
    return {};
  }
  if (
    !traits ||
    typeof traits !== 'object' ||
    Array.isArray(traits) ||
    Object.keys(traits).length > 40
  ) {
    throw new TypeError('Invalid recipient traits');
  }
  /** Validated private trait copy or checked structured database result in this operation. */
  const result: Record<string, CampaignPrimitive> = {};
  // Copy only bounded primitive traits after excluding prototype-sensitive keys.
  for (const [key, value] of Object.entries(traits)) {
    if (
      !fieldPattern.test(key) ||
      ['constructor', 'prototype', '__proto__'].includes(key) ||
      !(
        value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'string' && value.length <= 500) ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    ) {
      throw new TypeError('Invalid recipient trait');
    }
    result[key] = value;
  }
  return result;
};
/** Create a cloned-record process-local contact fixture with revision-checked updates/deletes.
 * @returns {MailingContactStore} Local reference store; no restart or multi-worker durability.
 */
export function createMemoryMailingContactStore(): MailingContactStore {
  /** Private local contact map or validated trait updates according to the enclosing operation. */
  const data = new Map<string, MailingContact>();
  return {
    /** Read one private contact document from the supplied store.
     * @param {string} id - Private canonical-mailbox hash; not anonymized identity.
     * @returns {Promise<MailingContact | null>} Detached/parsed record or null; corruption/outage rejects.
     */
    async load(id) {
      return data.has(id) ? clone(data.get(id)!) : null;
    },
    /** Reserve a new private contact identity using the store unique insertion contract.
     * @param {MailingContact} v - Complete private contact document for the next committed revision.
     * @returns {Promise<boolean>} True for a new record; duplicate identity returns false.
     */
    async create(v) {
      if (data.has(v.id)) {
        return false;
      }
      data.set(v.id, clone(v));
      return true;
    },
    /** Write a private next contact document only against the expected prior revision.
     * @param {MailingContact} v - Complete private contact document for the next committed revision.
     * @param {number} expected - Exact expected committed revision; store must distinguish zero affected rows.
     * @returns {Promise<boolean>} Native CAS outcome; host adapter must provide exact affected rows.
     */
    async save(v, expected) {
      /** Current committed private revision loaded before recomputing a CAS update. */
      const old = data.get(v.id);
      if (!old || old.version !== expected || v.version !== expected + 1) {
        return false;
      }
      data.set(v.id, clone(v));
      return true;
    },
    /** Erase one exact private contact revision without removing independent consent/suppression evidence.
     * @param {string} id - Private canonical-mailbox hash; not anonymized identity.
     * @param {number} expected - Exact expected committed revision; store must distinguish zero affected rows.
     * @returns {Promise<boolean>} True only for one matching deletion; stale/missing identity returns false.
     */
    async delete(id, expected) {
      /** Current private revision required for exact deletion; conflicts never silently delete a replacement. */
      const existing = data.get(id);
      if (!existing || existing.version !== expected) {
        return false;
      }
      return data.delete(id);
    },
    /** Read an ordered bounded contact page or a list-filtered projection under the owning API.
     * @param {string | null} cursor - Exclusive opaque store cursor; null starts a scan.
     * @param {number} limit - Explicit page budget; list service permits 1–200, default 100.
     * @returns {Promise<object>} Store returns items/cursor/done; list service returns contacts/cursor/done with no unbounded filtered rescan.
     */
    async page(cursor, limit) {
      /** Ordered bounded local page before detached result projection. */
      const rows = [...data.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((v) => cursor === null || v.id > cursor)
        .slice(0, limit);
      return {
        items: rows.map(clone),
        nextCursor: rows.length === limit ? rows.at(-1)!.id : null,
        done: rows.length < limit,
      };
    },
  };
}
/** Adapt a borrowed structured database to private contact documents, CAS and keyset scans.
 * @param {CampaignDatabaseConnection} db - Borrowed structured database; host scopes access and retains native lifecycle.
 * @param {string} table - Validated host table identity, default zerux_email_contacts.
 * @returns {MailingContactStore} Lazy schema/document facade; host owns tenant namespace, real unique commits and native close.
 */
export function createDatabaseMailingContactStore(
  db: CampaignDatabaseConnection,
  table = 'zerux_email_contacts'
): MailingContactStore {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
    throw new TypeError('Invalid contact table');
  }
  let ready: Promise<void> | undefined;
  /** Coalesce lazy contact-table creation and permit a later retry after initialization failure.

 * @returns {Promise<void>} Schema accepted by the borrowed database; native lifecycle is unchanged. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Validated private trait copy or checked structured database result in this operation. */
      const result = await db.createTable({
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
      if (!result?.ok) {
        throw new Error('Recipient table unavailable');
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  /** Serialize only a bounded private contact document for portable text storage.
   * @param {MailingContact} v - Complete private next contact revision.
   * @returns {string} Private JSON at most 16000 UTF-8 bytes. */
  const encode = (v: MailingContact) => {
    /** Private encoded contact checked against the portable document-size ceiling. */
    const json = JSON.stringify(v);
    if (Buffer.byteLength(json) > 16_000) {
      throw new RangeError('Recipient exceeds portable document size');
    }
    return json;
  };
  return {
    /** Read one private contact document from the supplied store.
     * @param {string} id - Private canonical-mailbox hash; not anonymized identity.
     * @returns {Promise<MailingContact | null>} Detached/parsed record or null; corruption/outage rejects.
     */
    async load(id) {
      await ensure();
      /** Private native result/row checked before trusting data or revision metadata. */
      const r = await db.select({
        table,
        columns: ['id', 'version', 'payload_json'],
        where: { field: 'id', operator: 'eq', value: id },
        limit: 1,
      });
      if (!r?.ok) {
        throw new Error('Recipient lookup failed');
      }
      /** One private native stored document row. */
      const row = r.rows?.[0] as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }
      if (typeof row.payload_json !== 'string') {
        throw new Error('Corrupt recipient record');
      }
      /** Parsed private contact cross-checked against native identity/revision columns. */
      const v = JSON.parse(row.payload_json) as MailingContact;
      if (v.id !== id || v.version !== Number(row.version)) {
        throw new Error('Recipient version mismatch');
      }
      return v;
    },
    /** Reserve a new private contact identity using the store unique insertion contract.
     * @param {MailingContact} v - Complete private contact document for the next committed revision.
     * @returns {Promise<boolean>} True for a new record; duplicate identity returns false.
     */
    async create(v) {
      await ensure();
      try {
        /** Private native result/row checked before trusting data or revision metadata. */
        const r = await db.insert({
          table,
          values: { id: v.id, version: v.version, payload_json: encode(v) },
        });
        if (r?.ok) {
          return true;
        }
      } catch (error) {
        /** Private native result/row checked before trusting data or revision metadata. */
        const r = await db.select({
          table,
          columns: ['id'],
          where: { field: 'id', operator: 'eq', value: v.id },
          limit: 1,
        });
        if (r?.ok && r.rows?.length) {
          return false;
        }
        throw error;
      }
      throw new Error('Recipient insertion failed');
    },
    /** Write a private next contact document only against the expected prior revision.
     * @param {MailingContact} v - Complete private contact document for the next committed revision.
     * @param {number} expected - Exact expected committed revision; store must distinguish zero affected rows.
     * @returns {Promise<boolean>} Native CAS outcome; host adapter must provide exact affected rows.
     */
    async save(v, expected) {
      await ensure();
      /** Private native result/row checked before trusting data or revision metadata. */
      const r = await db.update({
        table,
        values: { version: v.version, payload_json: encode(v) },
        where: {
          and: [
            { field: 'id', operator: 'eq', value: v.id },
            { field: 'version', operator: 'eq', value: expected },
          ],
        },
      });
      if (!r?.ok) {
        throw new Error('Recipient update failed');
      }
      /** Actual native count used to distinguish one committed CAS/deletion from conflict. */
      const affected = r.affectedCount ?? r.rowCount;
      if (affected === undefined) {
        throw new Error('Recipient CAS requires affectedCount');
      }
      return affected === 1;
    },
    /** Erase one exact private contact revision without removing independent consent/suppression evidence.
     * @param {string} id - Private canonical-mailbox hash; not anonymized identity.
     * @param {number} expected - Exact expected committed revision; store must distinguish zero affected rows.
     * @returns {Promise<boolean>} True only for one matching deletion; stale/missing identity returns false.
     */
    async delete(id, expected) {
      await ensure();
      if (!db.delete) {
        throw new Error(
          'Contact erasure requires a database connector with atomic delete support'
        );
      }
      /** Validated private trait copy or checked structured database result in this operation. */
      const result = await db.delete({
        table,
        where: {
          and: [
            { field: 'id', operator: 'eq', value: id },
            { field: 'version', operator: 'eq', value: expected },
          ],
        },
      });
      if (!result?.ok) {
        throw new Error('Contact deletion failed');
      }
      /** Actual native count used to distinguish one committed CAS/deletion from conflict. */
      const affected = result.affectedCount ?? result.rowCount;
      if (
        typeof affected !== 'number' ||
        !Number.isSafeInteger(affected) ||
        affected < 0 ||
        affected > 1
      ) {
        throw new Error('Contact erasure requires an atomic affectedCount');
      }
      return affected === 1;
    },
    /** Read an ordered bounded contact page or a list-filtered projection under the owning API.
     * @param {string | null} cursor - Exclusive opaque store cursor; null starts a scan.
     * @param {number} limit - Explicit page budget; list service permits 1–200, default 100.
     * @returns {Promise<object>} Store returns items/cursor/done; list service returns contacts/cursor/done with no unbounded filtered rescan.
     */
    async page(cursor, limit) {
      await ensure();
      /** Private native result/row checked before trusting data or revision metadata. */
      const r = await db.select({
        table,
        columns: ['id', 'version', 'payload_json'],
        ...(cursor
          ? { where: { field: 'id', operator: 'gt', value: cursor } }
          : {}),
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit,
      });
      if (!r?.ok || !Array.isArray(r.rows)) {
        throw new Error('Recipient listing failed');
      }
      /** Bounded parsed private contact page; every identity/version must match its row. */
      const items = r.rows.map((row) => {
        /** Private native result/row checked before trusting data or revision metadata. */
        const r = row as Record<string, unknown>;
        /** Parsed private contact cross-checked against native identity/revision columns. */
        const v = JSON.parse(String(r.payload_json)) as MailingContact;
        if (v.id !== r.id || v.version !== Number(r.version)) {
          throw new Error('Corrupt recipient document');
        }
        return v;
      });
      return {
        items,
        nextCursor: items.length === limit ? items.at(-1)!.id : null,
        done: items.length < limit,
      };
    },
  };
}
/** Manage explicit private memberships/traits with bounded optimistic conflict retries.
 * @param {{
  store: MailingContactStore;
  now?: () => number;
}} options - Explicit private contact store and optional trusted clock.
 * @param {MailingContactStore} options.store - Explicit private store; host owns tenant authorization and persistence.
 * @param {() => number} options.now - Optional trusted epoch clock.
 * @returns {object} Contact operations and a campaign-source view; membership is not subscription consent.
 */
export function createMailingListService(options: {
  /** Explicit host-owned private contact store; no implicit native acquisition. */
  store: MailingContactStore;
  /** Optional trusted epoch clock, default Date.now. */
  now?: () => number;
}) {
  if (!options?.store) {
    throw new TypeError('Contact store required');
  }
  /** Trusted contact creation/update clock, default Date.now. */
  const clock = options.now ?? Date.now;
  /** Instance-local contact API borrowing its host-owned store. */
  const service = {
    /** Merge validated memberships and scalar traits against the latest committed contact revision.
     * @param {string} email - Validated private mailbox; not principal authorization or subscription evidence.
     * @param {string[]} lists - At most fifty explicit memberships; new values merge with existing memberships.
     * @param {Record<string, CampaignPrimitive>} traits - At most forty bounded scalar traits; these remain private application data.
     * @returns {Promise<MailingContact>} Detached committed contact; finite CAS exhaustion rejects instead of overwriting.
     */
    async upsert(
      email: string,
      lists: string[] = [],
      traits?: Record<string, CampaignPrimitive>
    ): Promise<MailingContact> {
      /** Validated private canonical mailbox; not authenticated subject identity. */
      const canonical = addressString(validateEmailAddress(email))
        .trim()
        .toLowerCase();
      if (
        !Array.isArray(lists) ||
        lists.length > 50 ||
        lists.some((v) => typeof v !== 'string' || !idPattern.test(v))
      ) {
        throw new TypeError('Invalid recipient list memberships');
      }
      /** Unique validated requested memberships before merging with existing lists. */
      const normalized = [...new Set(lists)];
      /** Private local contact map or validated trait updates according to the enclosing operation. */
      const data = validateTraits(traits);
      /** Stable private canonical-mailbox hash within the host-scoped store namespace. */
      const id = keyFor(canonical);
      // Reload on each conflict rather than overwriting another committed contact revision.
      for (let i = 0; i < 30; i++) {
        /** Current committed private revision loaded before recomputing a CAS update. */
        const old = await options.store.load(id);
        /** Recomputed private next revision retaining unrelated contact data. */
        const next: MailingContact = old
          ? {
              ...old,
              lists: [...new Set([...old.lists, ...normalized])],
              traits: { ...old.traits, ...data },
              version: old.version + 1,
              updatedAt: clock(),
            }
          : {
              id,
              email: canonical,
              version: 1,
              lists: normalized,
              traits: data,
              createdAt: clock(),
              updatedAt: clock(),
            };
        if (
          old
            ? await options.store.save(next, old.version)
            : await options.store.create(next)
        ) {
          return clone(next);
        }
      }
      throw new Error('Concurrent contact updates exceeded retry budget');
    },
    /** Remove one explicit membership while preserving unrelated lists/traits and incrementing revision.
     * @param {string} email - Validated private mailbox; not principal authorization or subscription evidence.
     * @param {string} list - One validated explicit membership identity; not a role claim.
     * @returns {Promise<boolean>} False for missing contact/membership, true after committed CAS.
     */
    async removeFromList(email: string, list: string): Promise<boolean> {
      /** Validated private canonical mailbox; not authenticated subject identity. */
      const canonical = addressString(validateEmailAddress(email))
        .trim()
        .toLowerCase();
      if (!idPattern.test(list)) {
        throw new TypeError('Invalid list');
      }
      /** Stable private canonical-mailbox hash within the host-scoped store namespace. */
      const id = keyFor(canonical);
      // Reload on each conflict rather than overwriting another committed contact revision.
      for (let i = 0; i < 30; i++) {
        /** Current committed private revision loaded before recomputing a CAS update. */
        const old = await options.store.load(id);
        if (!old || !old.lists.includes(list)) {
          return false;
        }
        /** Recomputed private next revision retaining unrelated contact data. */
        const next = {
          ...old,
          version: old.version + 1,
          lists: old.lists.filter((v) => v !== list),
          updatedAt: clock(),
        };
        if (await options.store.save(next, old.version)) {
          return true;
        }
      }
      throw new Error('Concurrent contact updates exceeded retry budget');
    },
    /** Erase one contact and its private email/traits through version-checked store deletion.
     * @param {string} email - Validated private mailbox; not principal authorization or subscription evidence.
     * @returns {Promise<boolean>} True after committed deletion; separate consent/suppression/audit stores remain untouched.
     */
    async erase(email: string): Promise<boolean> {
      /** Validated private canonical mailbox; not authenticated subject identity. */
      const canonical = addressString(validateEmailAddress(email))
        .trim()
        .toLowerCase();
      if (!options.store.delete) {
        throw new Error('This contact store does not support atomic erasure');
      }
      /** Stable private canonical-mailbox hash within the host-scoped store namespace. */
      const id = keyFor(canonical);
      // Reload on each conflict rather than overwriting another committed contact revision.
      for (let i = 0; i < 30; i++) {
        /** Current private revision required for exact deletion; conflicts never silently delete a replacement. */
        const existing = await options.store.load(id);
        if (!existing) {
          return false;
        }
        if (await options.store.delete(id, existing.version)) {
          return true;
        }
      }
      throw new Error('Concurrent contact erasure exceeded retry budget');
    },
    /** Read an ordered bounded contact page or a list-filtered projection under the owning API.
     * @param {string} list - One validated explicit membership identity; not a role claim.
     * @param {string | null} cursor - Exclusive opaque store cursor; null starts a scan.
     * @param {number} limit - Explicit page budget; list service permits 1–200, default 100.
     * @returns {Promise<object>} Store returns items/cursor/done; list service returns contacts/cursor/done with no unbounded filtered rescan.
     */
    async page(
      list: string,
      cursor: string | null = null,
      limit = 100
    ): Promise<{
      contacts: CampaignContact[];
      /** Exclusive continuation, or null when the store reports completion. */
      nextCursor: string | null;
      /** Explicit store scan completion; a list-filtered empty page can still have a continuation. */
      done: boolean;
    }> {
      if (
        !idPattern.test(list) ||
        (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200
      ) {
        throw new TypeError('Invalid contact scan');
      }
      /** Bounded underlying store page; list filtering never silently scans an unbounded table. */
      const source = await options.store.page(cursor, limit);
      return {
        contacts: source.items
          .filter((v) => v.lists.includes(list))
          .map((v) => ({ id: v.id, email: v.email, traits: v.traits })),
        nextCursor: source.nextCursor,
        done: source.done,
      };
    },
    /** Project one list into the existing planner source contract; planner rechecks consent and suppression.
     * @param {string} list - One validated explicit membership identity; not a role claim.
     * @returns {CampaignSource} Borrowed source with stable store cursor, not an automatically scheduled campaign.
     */
    campaignSource(list: string): CampaignSource {
      if (!idPattern.test(list)) {
        throw new TypeError('Invalid list');
      }
      return { page: ({ cursor, limit }) => service.page(list, cursor, limit) };
    },
  };
  return service;
}
