/** Durable campaign reporting and private document persistence. Aggregate reports omit recipients and message IDs; store methods return private records and require host authorization. */
import type {
  DurableEmailDeliveryRecord,
  DurableEmailDeliveryStore,
  EmailDeliveryState,
} from './delivery.js';

/** Conservative campaign scope syntax; host permissions remain required. */
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Conservative opaque delivery reference/continuation syntax. */
const messagePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Fixed durable SMTP state vocabulary, distinct from mailbox delivery feedback. */
const states: readonly EmailDeliveryState[] = [
  'pending',
  'claimed',
  'sending',
  'sent',
  'suppressed',
  'uncertain',
  'rejected',
];
/** Require supported safe epoch milliseconds before date grouping.
 * @param {unknown} value - Private durable record/reference or internal validation value.
 * @returns {boolean} Validated record/result; private content must remain inside authorized host code.
 */
const validTime = (value: unknown) =>
  Number.isSafeInteger(value) &&
  Number(value) >= 0 &&
  Number(value) <= 8_640_000_000_000_000;
/** Validate portable durable identity/revision/state/time fields before serialization.
 * @param {DurableEmailDeliveryRecord} record - Private durable record/reference or internal validation value.
 * @returns {boolean} Validated record/result; private content must remain inside authorized host code.
 */
const validRecord = (record: DurableEmailDeliveryRecord) =>
  record &&
  messagePattern.test(record.id) &&
  Number.isSafeInteger(record.version) &&
  record.version >= 1 &&
  states.includes(record.state) &&
  ['marketing', 'transactional'].includes(record.purpose) &&
  validTime(record.updatedAt) &&
  (record.campaignId === undefined ||
    campaignPattern.test(record.campaignId)) &&
  (record.attemptedAt === undefined || validTime(record.attemptedAt)) &&
  (record.completedAt === undefined || validTime(record.completedAt));

export interface CampaignDeliveryRow {
  /** Internal cursor and optional activity lookup key. NEVER return from HTTP dashboards. */
  id: string;
  /** Opaque campaign scope requiring host authorization before reporting. */
  campaignId: string;
  /** Optional observed delivery revision; history audits require versioned sources. */
  version?: number;
  /** Known current durable SMTP state; not provider inbox placement. */
  state: EmailDeliveryState;
  /** Validated durable state update epoch milliseconds. */
  updatedAt: number;
  /** Optional validated send-attempt epoch milliseconds. */
  attemptedAt?: number;
  /** Optional validated completion timestamp used for daily grouping. */
  completedAt?: number;
}
export interface CampaignDeliverySource {
  /** Read a bounded campaign/ID page for trusted operational consumers. Returned internal IDs must not be forwarded to public dashboards; the host independently authorizes the campaign.
   * @param {string} campaignId - Opaque campaign scope authorized by the host before this call.
   * @param {string|null} cursor - Exclusive ordered message reference, null for the first page.
   * @param {number} limit - Finite requested page size, 1–500; no unbounded scan.
   * @returns {Promise<CampaignDeliveryRow[]>} Explicit connector/report result or failure; authorization remains host-owned.
   */
  pageCampaign(
    campaignId: string,
    cursor: string | null,
    limit: number
  ): Promise<CampaignDeliveryRow[]>;
}
export interface DeliveryDatabase {
  /** Borrow the connector structured schema primitive; failure is explicit and does not establish transactional DDL support.
   * @param {any} input - Fixed structured connector operation; no raw caller SQL.
   * @returns {Promise<{ok:boolean}>|{ok:boolean}} Explicit connector/report result or failure; authorization remains host-owned.
   */
  createTable(input: any):
    | Promise<{
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
      }>
    | {
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
      };
  /** Borrow the connector unique-insert primitive; persistence and error semantics remain driver-owned.
   * @param {any} input - Fixed structured connector operation; no raw caller SQL.
   * @returns {Promise<{ok:boolean}>|{ok:boolean}} Explicit connector/report result or failure; authorization remains host-owned.
   */
  insert(input: any):
    | Promise<{
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
      }>
    | {
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
      };
  /** Borrow bounded structured reads/aggregates; unsupported plans must fail in the connector.
   * @param {any} input - Fixed structured connector operation; no raw caller SQL.
   * @returns {Promise<object>|object} Explicit connector/report result or failure; authorization remains host-owned.
   */
  select(input: any):
    | Promise<{
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
        /** Bounded driver result rows, private until validated/projected. */
        rows?: unknown[];
      }>
    | {
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
        /** Bounded driver result rows, private until validated/projected. */
        rows?: unknown[];
      };
  /** Borrow optimistic updates; callers require safe affectedCount/rowCount to distinguish commit from conflict.
   * @param {any} input - Fixed structured connector operation; no raw caller SQL.
   * @returns {Promise<object>|object} Explicit connector/report result or failure; authorization remains host-owned.
   */
  update(input: any):
    | Promise<{
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
        /** Required safe 0/1 CAS result when available; never guessed from truthiness. */
        affectedCount?: number;
        /** Alternate safe affected-row count accepted for compatible connectors. */
        rowCount?: number;
      }>
    | {
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
        /** Required safe 0/1 CAS result when available; never guessed from truthiness. */
        affectedCount?: number;
        /** Alternate safe affected-row count accepted for compatible connectors. */
        rowCount?: number;
      };
  /** Optionally create a structured performance index; journal correctness does not depend on this primitive.
   * @param {any} input - Fixed structured connector operation; no raw caller SQL.
   * @returns {Promise<{ok:boolean}>|{ok:boolean}} Explicit connector/report result or failure; authorization remains host-owned.
   */
  createIndex?(input: any):
    | Promise<{
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
      }>
    | {
        /** Connector success receipt; false is not empty successful data. */
        ok: boolean;
      };
}

/** Create a private durable delivery document store with immutable routing and optimistic revisions. Borrow the database; shared storage/stable IDs are host prerequisites and driver capabilities are not invented.
 * @param {DeliveryDatabase} db - Borrowed durable connector facade; host owns tenant isolation and close.
 * @param {string} table - Conservative host-selected table, default zerux_email_delivery.
 * @returns {DurableEmailDeliveryStore & CampaignDeliverySource & object} Explicit connector/report result or failure; authorization remains host-owned.
 */
export function createDatabaseEmailDeliveryStore(
  db: DeliveryDatabase,
  table = 'zerux_email_delivery'
): DurableEmailDeliveryStore &
  CampaignDeliverySource & {
    /** Insert a validated version1 private document. Existing durable identity returns false, not proof of equivalent content; database failure without an existing row rejects.
     * @param {DurableEmailDeliveryRecord} record - Private durable initial delivery record.
     * @returns {Promise<boolean>} Explicit connector/report result or failure; authorization remains host-owned.
     */
    create(record: DurableEmailDeliveryRecord): Promise<boolean>;
  } {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
    throw new TypeError('Invalid delivery table');
  }
  if (
    !db ||
    typeof db.createTable !== 'function' ||
    typeof db.select !== 'function' ||
    typeof db.update !== 'function' ||
    typeof db.insert !== 'function'
  ) {
    throw new TypeError('Invalid delivery database');
  }
  let ready: Promise<void> | undefined;
  /** Share lazy table initialization; failed setup is cleared for later explicit retry.
   * @returns {Promise<void>} Validated record/result; private content must remain inside authorized host code.
   */
  const ensure = () =>
    (ready ??= (async () => {
      /** Structured durable receipt; native failure never means zero successful results. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 128,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'campaign_id', type: 'varchar', length: 96 },
          { name: 'state', type: 'varchar', length: 32, notNull: true },
          { name: 'updated_at', type: 'bigint', notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Email delivery table unavailable');
      }
      // Optional index creation is a performance optimization, never a correctness dependency.
      if (db.createIndex) {
        // Process only fixed indexes or the validated finite page/scan budget.
        for (const [suffix, columns] of [
          ['campaign_idx', ['campaign_id', 'id']],
          ['campaign_day_idx', ['campaign_id', 'updated_at']],
        ] as const) {
          try {
            await db.createIndex({
              table,
              name: `${table.slice(0, 40)}_${suffix}`,
              columns: [...columns],
              ifNotExists: true,
            });
          } catch {
            /* optional performance indexes: correctness never depends on their creation */
          }
        }
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  /** Validate private records and enforce a60000-byte UTF-8 portable TEXT budget.
   * @param {DurableEmailDeliveryRecord} v - Private durable record/reference or internal validation value.
   * @returns {string} Validated record/result; private content must remain inside authorized host code.
   */
  const encode = (v: DurableEmailDeliveryRecord) => {
    if (!validRecord(v)) {
      throw new TypeError('Invalid durable delivery record');
    }
    /** Private serialized delivery document, never a logging label. */
    const text = JSON.stringify(v);
    if (Buffer.byteLength(text, 'utf8') > 60_000) {
      throw new RangeError('Email delivery record exceeds portable TEXT limit');
    }
    return text;
  };
  /** Parse private document and verify denormalized identity/revision/state/scope/time columns.
   * @param {unknown} row - Private durable record/reference or internal validation value.
   * @returns {DurableEmailDeliveryRecord} Validated record/result; private content must remain inside authorized host code.
   */
  const decode = (row: unknown): DurableEmailDeliveryRecord => {
    /** Private native delivery row; never return directly from public dashboards. */
    const item = row as Record<string, unknown>;
    if (!item || typeof item.payload_json !== 'string') {
      throw new Error('Corrupt delivery document');
    }
    /** Validated private delivery record retaining its immutable routing facts. */
    const v = JSON.parse(item.payload_json) as DurableEmailDeliveryRecord;
    if (
      !validRecord(v) ||
      v.id !== item.id ||
      v.version !== Number(item.version) ||
      v.state !== item.state ||
      (v.campaignId ?? null) !== (item.campaign_id ?? null) ||
      v.updatedAt !== Number(item.updated_at)
    ) {
      throw new Error('Delivery document/index mismatch');
    }
    return v;
  };
  /** Fixed private document projection, not caller-selected SQL. */
  const columns = [
    'id',
    'version',
    'campaign_id',
    'state',
    'updated_at',
    'payload_json',
  ];
  /** Read one private delivery by opaque reference after lazy schema setup.
   * @param {string} id - Private durable record/reference or internal validation value.
   * @returns {Promise<DurableEmailDeliveryRecord|null>} Validated record/result; private content must remain inside authorized host code.
   */
  const load = async (id: string) => {
    if (!messagePattern.test(id)) {
      throw new TypeError('Invalid message ID');
    }
    await ensure();
    /** Structured durable receipt; native failure never means zero successful results. */
    const r = await db.select({
      table,
      columns,
      where: { field: 'id', operator: 'eq', value: id },
      limit: 1,
    });
    if (!r?.ok || !Array.isArray(r.rows)) {
      throw new Error('Email delivery lookup failed');
    }
    return r.rows.length ? decode(r.rows[0]) : null;
  };
  return {
    load,
    /** Insert a validated version1 private document. Existing durable identity returns false, not proof of equivalent content; database failure without an existing row rejects.
     * @param {DurableEmailDeliveryRecord} v - Private initial record whose version must equal1.
     * @returns {Promise<boolean>} Explicit connector/report result or failure; authorization remains host-owned.
     */
    async create(v) {
      if (v.version !== 1) {
        throw new TypeError('New delivery records must start at version 1');
      }
      /** Validated bounded private document to persist only in the host-owned store. */
      const payload = encode(v);
      await ensure();
      try {
        /** Structured durable receipt; native failure never means zero successful results. */
        const r = await db.insert({
          table,
          values: {
            id: v.id,
            version: v.version,
            campaign_id: v.campaignId ?? null,
            state: v.state,
            updated_at: v.updatedAt,
            payload_json: payload,
          },
        });
        if (r?.ok) {
          return true;
        }
      } catch (e) {
        if (await load(v.id)) {
          return false;
        }
        throw e;
      }
      if (await load(v.id)) {
        return false;
      }
      throw new Error('Email delivery insert failed');
    },
    /** Require exact next revision and immutable recipient/purpose/campaign, then CAS-update using affected-row counts. A preliminary read is not a lock.
     * @param {string} id - Opaque private durable message reference; not recipient identity.
     * @param {DurableEmailDeliveryRecord} next - Next private record with immutable routing and exact next revision.
     * @param {number} expected - Positive optimistic current revision; stale saves return false.
     * @returns {Promise<boolean>} Explicit connector/report result or failure; authorization remains host-owned.
     */
    async save(id, next, expected) {
      if (
        !messagePattern.test(id) ||
        id !== next.id ||
        !Number.isSafeInteger(expected) ||
        expected < 1 ||
        next.version !== expected + 1
      ) {
        throw new TypeError('Invalid delivery version update');
      }
      /** Validated bounded private document to persist only in the host-owned store. */
      const payload = encode(next);
      await ensure();
      /** Current durable revision used to verify immutable routing and optimistic conflict. */
      const previous = await load(id);
      if (!previous || previous.version !== expected) {
        return false;
      }
      // Immutable routing identity: prevent malicious or accidental cross-campaign moves
      // even while CAS protects against concurrent worker races.
      if (
        previous.campaignId !== next.campaignId ||
        previous.purpose !== next.purpose ||
        previous.recipient !== next.recipient
      ) {
        throw new Error('Cannot change durable message routing identity');
      }
      /** Structured durable receipt; native failure never means zero successful results. */
      const r = await db.update({
        table,
        values: {
          version: next.version,
          campaign_id: next.campaignId ?? null,
          state: next.state,
          updated_at: next.updatedAt,
          payload_json: payload,
        },
        where: {
          and: [
            { field: 'id', operator: 'eq', value: id },
            { field: 'version', operator: 'eq', value: expected },
          ],
        },
      });
      if (!r?.ok) {
        throw new Error('Email delivery update failed');
      }
      /** Safe native 0/1 affected-row count; unknown/unsafe counts reject. */
      const affected = r.affectedCount ?? r.rowCount;
      if (
        typeof affected !== 'number' ||
        !Number.isSafeInteger(affected) ||
        affected < 0 ||
        affected > 1
      ) {
        throw new Error('Email delivery CAS requires atomic affectedCount');
      }
      return affected === 1;
    },
    /** Read a bounded campaign/ID page for trusted operational consumers. Returned internal IDs must not be forwarded to public dashboards; the host independently authorizes the campaign.
     * @param {string} campaignId - Opaque campaign scope authorized by the host before this call.
     * @param {string|null} cursor - Exclusive ordered message reference, null for the first page.
     * @param {number} limit - Finite requested page size, 1–500; no unbounded scan.
     * @returns {Promise<CampaignDeliveryRow[]>} Explicit connector/report result or failure; authorization remains host-owned.
     */
    async pageCampaign(campaignId, cursor, limit) {
      if (
        !campaignPattern.test(campaignId) ||
        (cursor !== null && !messagePattern.test(cursor)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        throw new TypeError('Invalid campaign scan');
      }
      await ensure();
      /** Mandatory campaign filter plus optional exclusive cursor. */
      const terms: any[] = [
        { field: 'campaign_id', operator: 'eq', value: campaignId },
      ];
      if (cursor !== null) {
        terms.push({ field: 'id', operator: 'gt', value: cursor });
      }
      /** Structured durable receipt; native failure never means zero successful results. */
      const r = await db.select({
        table,
        columns,
        where: { and: terms },
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit,
      });
      if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > limit) {
        throw new Error('Email delivery campaign query failed');
      }
      return r.rows.map((raw) => {
        /** Validated private delivery record retaining its immutable routing facts. */
        const v = decode(raw);
        if (
          v.campaignId !== campaignId ||
          (cursor !== null && v.id <= cursor)
        ) {
          throw new Error('Campaign query returned out-of-scope data');
        }
        return {
          id: v.id,
          campaignId,
          version: v.version,
          state: v.state,
          updatedAt: v.updatedAt,
          attemptedAt: v.attemptedAt,
          completedAt: v.completedAt,
        };
      });
    },
  };
}

export interface CampaignDeliveryReport {
  /** Opaque campaign scope requiring host authorization before reporting. */
  campaignId: string;
  /** Complete only if the scan reached the end. Partial results are not exact totals. */
  complete: boolean;
  /** Actual bounded persisted row count included in this report. */
  scanned: number;
  /** Finite known current-state totals over scanned rows. */
  counts: Record<EmailDeliveryState, number>;
  /** UTC-day grouping uses completedAt (or updatedAt for unfinished jobs). */
  days: {
    /** Canonical UTC day derived from persisted completion/update time. */
    day: string;
    /** Durable sent-state count, not mailbox delivery confirmation. */
    sent: number;
    /** Suppressed durable state count. */
    suppressed: number;
    /** Unknown SMTP acceptance state count; never automatically retried. */
    uncertain: number;
    /** Other known durable state counts for the day. */
    other: number;
  }[];
  /** Rates reflect durable SMTP state, NOT mailbox delivery or inbox placement. */
  sentPercent: number | null;
  /** Never contains recipients or message IDs. */
  activity: null | {
    /** Number of rows with an actual optional activity summary. */
    summariesAvailable: number;
    /** Observed summary opens; privacy tools may distort tracking. */
    opens: number;
    /** Scanned messages with at least one recorded open; not unique people. */
    uniqueOpens: number;
    /** Observed recorded link clicks, not proof of human intent. */
    clicks: number;
    /** Scanned messages with a recorded click; not unique people. */
    uniqueClicks: number;
    /** Observed download-link click count from available summaries. */
    downloadClicks: number;
    /** Observed completed downloads from available summaries. */
    downloads: number;
    /** Available-summary byte total; not inferred from delivery. */
    downloadedBytes: number;
    /** Available-summaries-only; unknown tracking coverage is not filled with zero facts. */
    coverage: 'available-summaries-only';
  };
}
export interface CampaignActivityRead {
  /** Borrow consent-aware optional activity summaries by private message reference. A missing summary is unknown coverage, not zero engagement.
   * @param {string} id - Opaque private durable message reference; not recipient identity.
   * @returns {Promise<object|null>} Explicit connector/report result or failure; authorization remains host-owned.
   */
  get(id: string): Promise<{
    /** Observed summary opens; privacy tools may distort tracking. */
    opens: number;
    /** Observed recorded link clicks, not proof of human intent. */
    clicks: number;
    /** Observed download-link click count from available summaries. */
    downloadClicks: number;
    /** Observed completed downloads from available summaries. */
    downloads: number;
    /** Available-summary byte total; not inferred from delivery. */
    downloadedBytes: number;
  } | null>;
}

/** Build a bounded sequential private delivery scan with PII-free aggregate output. Exactness requires complete=true; no snapshot transaction or mailbox delivery guarantee is implied.
 * @param {object} options - Borrowed authorized source/activity and explicit finite report budgets.
 * @param {CampaignDeliverySource} options.source - Borrowed scoped ordered source.
 * @param {CampaignActivityRead} [options.activity] - Optional consent-aware summaries.
 * @param {number} [options.maxRecords] - Default 10000; maximum 100000.
 * @param {number} [options.pageSize] - Default 200; maximum 500.
 * @returns {function} Explicit connector/report result or failure; authorization remains host-owned.
 */
export function createCampaignDeliveryReporter(options: {
  /** Borrowed campaign-scoped ordered durable pager. */
  source: CampaignDeliverySource;
  /** Optional borrowed consent-aware summary lookup; no identity is exposed in aggregates. */
  activity?: CampaignActivityRead;
  /** Default10000, validated1–100000 records; completeness marks truncation. */
  maxRecords?: number;
  /** Default200, validated1–500 records per sequential query. */
  pageSize?: number;
}) {
  if (!options?.source || typeof options.source.pageCampaign !== 'function') {
    throw new TypeError('Delivery report source required');
  }
  /** Validated total scan ceiling, default10000 and maximum100000. */
  const max = options.maxRecords ?? 10_000;
  /** Validated sequential page bound, default200 and maximum500. */
  const pageSize = options.pageSize ?? 200;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 100_000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 500
  ) {
    throw new RangeError('Invalid campaign report bounds');
  }
  return async function report(
    campaignId: string
  ): Promise<CampaignDeliveryReport> {
    if (!campaignPattern.test(campaignId)) {
      throw new TypeError('Invalid campaign ID');
    }
    /** Finite known current-state counts over actually scanned records. */
    const counts = Object.fromEntries(
      states.map((state) => [state, 0])
    ) as Record<EmailDeliveryState, number>;
    /** Bounded UTC daily aggregate map; no message bodies or recipients. */
    const days = new Map<
      string,
      {
        /** Canonical UTC day derived from persisted completion/update time. */
        day: string;
        /** Durable sent-state count, not mailbox delivery confirmation. */
        sent: number;
        /** Suppressed durable state count. */
        suppressed: number;
        /** Unknown SMTP acceptance state count; never automatically retried. */
        uncertain: number;
        /** Other known durable state counts for the day. */
        other: number;
      }
    >();
    /** Optional aggregate tracking coverage; null means not configured. */
    const activity: CampaignDeliveryReport['activity'] = options.activity
      ? {
          summariesAvailable: 0,
          opens: 0,
          uniqueOpens: 0,
          clicks: 0,
          uniqueClicks: 0,
          downloadClicks: 0,
          downloads: 0,
          downloadedBytes: 0,
          coverage: 'available-summaries-only',
        }
      : null;
    let cursor: string | null = null,
      scanned = 0,
      complete = false;
    // Process only fixed indexes or the validated finite page/scan budget.
    while (scanned < max) {
      /** Remaining bounded page size, never more than the configured scan budget. */
      const limit = Math.min(pageSize, max - scanned);
      /** Finite ordered campaign rows whose scope/state/time are checked before counting. */
      const page = await options.source.pageCampaign(campaignId, cursor, limit);
      if (!Array.isArray(page) || page.length > limit) {
        throw new Error('Invalid campaign report page');
      }
      if (!page.length) {
        complete = true;
        break;
      }
      // Process only fixed indexes or the validated finite page/scan budget.
      for (const row of page) {
        if (
          !row ||
          !messagePattern.test(row.id) ||
          row.campaignId !== campaignId ||
          (cursor !== null && row.id <= cursor) ||
          !states.includes(row.state) ||
          !validTime(row.updatedAt) ||
          (row.completedAt !== undefined && !validTime(row.completedAt))
        ) {
          throw new Error('Invalid or unordered campaign report row');
        }
        cursor = row.id;
        counts[row.state]++;
        scanned++;
        /** UTC day from real completion time or unfinished update time, not current build time. */
        const day = new Date(row.completedAt ?? row.updatedAt)
          .toISOString()
          .slice(0, 10);
        let group = days.get(day);
        if (!group) {
          group = { day, sent: 0, suppressed: 0, uncertain: 0, other: 0 };
          days.set(day, group);
        }
        /** Known public daily state bucket; other combines remaining durable states. */
        const category =
          row.state === 'sent' ||
          row.state === 'suppressed' ||
          row.state === 'uncertain'
            ? row.state
            : 'other';
        group[category]++;
        if (activity) {
          /** Private optional activity summary; only validated nonnegative totals reach aggregate output. */
          const a = await options.activity!.get(row.id);
          if (a !== null) {
            if (
              !a ||
              ![
                a.opens,
                a.clicks,
                a.downloadClicks,
                a.downloads,
                a.downloadedBytes,
              ].every((n) => Number.isSafeInteger(n) && n >= 0)
            ) {
              throw new Error('Invalid activity summary');
            }
            activity.summariesAvailable++;
            activity.opens += a.opens;
            activity.clicks += a.clicks;
            activity.uniqueOpens += Number(a.opens > 0);
            activity.uniqueClicks += Number(a.clicks > 0);
            activity.downloadClicks += a.downloadClicks;
            activity.downloads += a.downloads;
            activity.downloadedBytes += a.downloadedBytes;
          }
        }
      }
      if (page.length < limit) {
        complete = true;
        break;
      }
    }
    // Exactly maxRecords may also be the exact end. Probe one extra row rather than
    // labelling a complete report as truncated or implying incomplete data are exact.
    if (!complete && scanned === max) {
      /** One final lookahead distinguishes an exact cap from actual truncation. */
      const extra = await options.source.pageCampaign(campaignId, cursor, 1);
      if (
        !Array.isArray(extra) ||
        extra.length > 1 ||
        extra.some(
          (r) =>
            !r ||
            r.campaignId !== campaignId ||
            !messagePattern.test(r.id) ||
            r.id <= cursor!
        )
      ) {
        throw new Error('Invalid campaign report continuation');
      }
      complete = extra.length === 0;
    }
    return {
      campaignId,
      complete,
      scanned,
      counts,
      days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
      sentPercent:
        complete && scanned > 0 ? (100 * counts.sent) / scanned : null,
      activity,
    };
  };
}
