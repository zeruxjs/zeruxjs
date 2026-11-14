/** PII-free, append-only campaign operator audit log; writes are never part of SMTP
 * transaction. Wire record as createMarketingCampaignService({onAudit: log.record}). */
import { randomBytes } from 'node:crypto';
import type { CampaignDatabaseConnection } from './campaign-storage.js';

export type MarketingAuditAction =
  | 'create'
  | 'append'
  | 'enqueue'
  | 'schedule'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'redrive'
  | 'archive'
  | 'export'
  | 'retention'
  | 'finalize';
export interface MarketingAuditRecord {
  /** Private time/random audit reference; not evidence of authorship or permission. */
  id: string;
  /** Opaque campaign reference; host must not encode recipient identity or secrets. */
  code: string;
  /** One of the fixed operator action labels. */
  action: MarketingAuditAction;
  /** Safe nonnegative epoch metadata timestamp from the trusted host. */
  at: number;
  /** Optional safe nonnegative operational count; never recipient payload. */
  count?: number;
}
/** Bounded opaque campaign-reference syntax; hosts must still exclude personal data. */
const codePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Allowlisted native table-identifier syntax; never raw SQL. */
const tablePattern = /^[a-z][a-z0-9_]{0,62}$/;
/** Fixed operational action labels; arbitrary message/content events are not accepted. */
const actions = new Set<MarketingAuditAction>([
  'create',
  'append',
  'enqueue',
  'schedule',
  'pause',
  'resume',
  'cancel',
  'redrive',
  'archive',
  'export',
  'retention',
  'finalize',
]);
/** Persist explicit append-only operational metadata through a borrowed database; no SMTP/store distributed transaction is implied.
 * @param {CampaignDatabaseConnection} db - Borrowed structured database with real insert/committed-read behavior.
 * @param {string} table - Validated host table identifier, default zerux_marketing_audit.
 * @returns {object} Record/page callbacks; host owns tenant authorization, durable commits and database close.
 */
export function createDatabaseMarketingAuditLog(
  db: CampaignDatabaseConnection,
  table = 'zerux_marketing_audit'
) {
  if (
    !db ||
    typeof db.createTable !== 'function' ||
    typeof db.insert !== 'function' ||
    typeof db.select !== 'function' ||
    !tablePattern.test(table)
  ) {
    throw new TypeError('Invalid marketing audit store');
  }
  let ready: Promise<void> | undefined;
  /** Coalesce lazy audit schema creation and tolerate only the optional index failure.

 * @returns {Promise<void>} Schema accepted by the borrowed database; native lifecycle stays external. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Checked private structured native schema/write/page outcome. */
      const result = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 48,
            primary: true,
            notNull: true,
          },
          { name: 'campaign_id', type: 'varchar', length: 96, notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!result?.ok) {
        throw new Error('Marketing audit table unavailable');
      }
      if (db.createIndex) {
        try {
          await db.createIndex({
            table,
            name: `${table.slice(0, 40)}_campaign_idx`,
            columns: ['campaign_id', 'id'],
            ifNotExists: true,
          });
        } catch {
          /* Index optional. */
        }
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  /** Append only validated fixed metadata fields without retaining recipient/body/credential values.
   * @param {{code: string, action: MarketingAuditAction, at: number, count?: number}} entry - Host-authorized operational audit metadata.
   * @param {string} entry.code - Opaque campaign identity; no PII or secrets.
   * @param {MarketingAuditAction} entry.action - Fixed allowed operator action.
   * @param {number} entry.at - Safe nonnegative trusted epoch time.
   * @param {number} entry.count - Optional safe nonnegative count.
   * @returns {Promise<MarketingAuditRecord>} Detached committed audit item; storage failure rejects. */
  const record = async (entry: {
    /** Opaque campaign reference; host must not encode recipient identity or secrets. */
    code: string;
    /** One of the fixed operator action labels. */
    action: MarketingAuditAction;
    /** Safe nonnegative epoch metadata timestamp from the trusted host. */
    at: number;
    /** Optional safe nonnegative operational count; never recipient payload. */
    count?: number;
  }) => {
    if (
      !entry ||
      !codePattern.test(entry.code) ||
      !actions.has(entry.action) ||
      !Number.isSafeInteger(entry.at) ||
      entry.at < 0 ||
      (entry.count !== undefined &&
        (!Number.isSafeInteger(entry.count) || entry.count < 0))
    ) {
      throw new TypeError('Invalid PII-free marketing audit metadata');
    }
    /** Private parsed/created minimal audit record; no SMTP payload or signed URL is copied. */
    const item: MarketingAuditRecord = {
      id: `${String(entry.at).padStart(15, '0')}_${randomBytes(12).toString('hex')}`,
      code: entry.code,
      action: entry.action,
      at: entry.at,
      ...(entry.count === undefined ? {} : { count: entry.count }),
    };
    await ensure();
    /** Checked private structured native schema/write/page outcome. */
    const result = await db.insert({
      table,
      values: {
        id: item.id,
        campaign_id: item.code,
        payload_json: JSON.stringify(item),
      },
    });
    if (!result?.ok) {
      throw new Error('Marketing audit write failed');
    }
    return structuredClone(item);
  };
  /** Read one bounded campaign-specific keyset page with an extra-row continuation probe.
   * @param {string} code - Host-authorized opaque campaign reference.
   * @param {{cursor?: string | null, limit?: number}} options - Explicit private cursor and page size.
   * @param {string | null} options.cursor - Exclusive time/random audit identity, default null.
   * @param {number} options.limit - Integer page size 1–200, default 100.
   * @returns {Promise<{items: MarketingAuditRecord[], nextCursor: string | null, done: boolean}>} Private metadata page; no snapshot isolation across concurrent inserts. */
  const page = async (
    code: string,
    {
      cursor = null,
      limit = 100,
    }: { cursor?: string | null; limit?: number } = {}
  ) => {
    if (
      !codePattern.test(code) ||
      (cursor !== null && !/^\d{15}_[a-f0-9]{24}$/.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new TypeError('Invalid marketing audit page');
    }
    await ensure();
    /** Fixed campaign predicate plus optional exclusive audit-ID continuation. */
    const clauses: any[] = [
      { field: 'campaign_id', operator: 'eq', value: code },
    ];
    if (cursor) {
      clauses.push({ field: 'id', operator: 'gt', value: cursor });
    }
    /** Checked private structured native schema/write/page outcome. */
    const result = await db.select({
      table,
      columns: ['id', 'campaign_id', 'payload_json'],
      where: { and: clauses },
      orderBy: [{ by: 'id', direction: 'asc' }],
      limit: limit + 1,
    });
    if (
      !result?.ok ||
      !Array.isArray(result.rows) ||
      result.rows.length > limit + 1
    ) {
      throw new Error('Marketing audit page unavailable');
    }
    /** Bounded private metadata rows checked against their stored identity/campaign/action. */
    const items = result.rows.slice(0, limit).map((raw) => {
      /** Private raw database row, parsed as data only. */
      const r = raw as Record<string, unknown>;
      /** Private parsed/created minimal audit record; no SMTP payload or signed URL is copied. */
      const item = JSON.parse(String(r.payload_json)) as MarketingAuditRecord;
      if (item.id !== r.id || item.code !== code || !actions.has(item.action)) {
        throw new Error('Corrupt marketing audit row');
      }
      return item;
    });
    /** One extra native row proves a further page exists; no invented completeness. */
    const hasMore = result.rows.length > limit;
    return {
      items,
      nextCursor: hasMore ? items.at(-1)!.id : null,
      done: !hasMore,
    };
  };
  return { record, page };
}
