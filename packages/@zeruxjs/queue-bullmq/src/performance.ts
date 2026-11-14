/** Exact, database-native campaign state totals and authenticated provider outcome ledger.
 * No recipients, payloads or SMTP credentials are stored here or emitted by reports.
 */
import { createHash } from 'node:crypto';
import type { DeliveryDatabase } from './reporting.js';
import type { EmailDeliveryState } from './delivery.js';

/** Finite durable SMTP state vocabulary; no invented state groups. */
export const deliveryStates = [
  'pending',
  'claimed',
  'sending',
  'sent',
  'suppressed',
  'uncertain',
  'rejected',
] as const;
/** Finite authenticated provider-notification vocabulary, not unique recipients. */
export const providerOutcomes = [
  'delivered',
  'deferred',
  'hard-bounce',
  'soft-bounce',
  'complaint',
] as const;
export type ProviderOutcome = (typeof providerOutcomes)[number];
/** Conservative opaque campaign grammar; authorization remains host-owned. */
const campaignId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Conservative opaque durable message grammar, not a recipient address. */
const messageId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Conservative trusted provider label grammar. */
const providerId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
/** Validate fixed host table names before structured connector queries.
 * @param {string} name - Explicit trusted ledger/report value; private source data is never logged.
 * @returns {boolean} Validated native/ledger result or explicit failure; no automatic external work is started.
 */
const validTable = (name: string) => /^[a-z][a-z0-9_]{0,62}$/.test(name);
/** Validate safe epoch-millisecond notification timestamps.
 * @param {unknown} v - Explicit trusted ledger/report value; private source data is never logged.
 * @returns {boolean} Validated native/ledger result or explicit failure; no automatic external work is started.
 */
const validTime = (v: unknown) =>
  Number.isSafeInteger(v) &&
  Number(v) >= 0 &&
  Number(v) <= 8_640_000_000_000_000;
/** Require explicit durable create/read/insert primitives before lazy ledger use.
 * @param {DeliveryDatabase} db - Borrowed durable connector facade; host owns scope/authorization/lifecycle.
 * @returns {void} Validated native/ledger result or explicit failure; no automatic external work is started.
 */
const validateDb = (db: DeliveryDatabase) => {
  if (
    !db ||
    typeof db.createTable !== 'function' ||
    typeof db.select !== 'function' ||
    typeof db.insert !== 'function'
  ) {
    throw new TypeError('Durable database required');
  }
};
/** Fixed structured COUNT(id) expression, never concatenated SQL. */
const countExpr = {
  expr: {
    kind: 'function' as const,
    name: 'COUNT' as const,
    args: [{ kind: 'column' as const, name: 'id' }],
  },
  as: 'event_count',
};
/** Validate safe integer grouped counts without silently losing native precision.
 * @param {unknown} value - Untrusted connector count scalar.
 * @returns {number} Validated native/ledger result or explicit failure; no automatic external work is started.
 */
const count = (value: unknown) => {
  /** Native decimal count normalized only after strict integer syntax. */
  const parsed =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new Error('Invalid database aggregate count');
  }
  return parsed;
};
/** Push finite state/provider grouping into the connector, rejecting malformed/duplicate/unsafe grouped counts. No private payload rows are loaded.
 * @param {DeliveryDatabase} db - Borrowed durable connector facade; host owns scope/authorization/lifecycle.
 * @param {string} table - Validated host-selected source table, never a caller SQL expression.
 * @param {string} campaign - Validated explicit campaign scope; host independently authorizes tenant access.
 * @param {string} column - Fixed internal grouping column, never arbitrary user SQL.
 * @param {readonly T[]} labels - Finite known category vocabulary bounding returned groups.
 * @returns {Promise<Record<T,number>>} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
async function groupCount<T extends string>(
  db: DeliveryDatabase,
  table: string,
  campaign: string,
  column: string,
  labels: readonly T[]
): Promise<Record<T, number>> {
  /** Finite native grouped query outcome; dependency failure is not empty data. */
  const result = await db.select({
    table,
    columns: [
      { expr: { kind: 'column', name: column }, as: 'category' },
      countExpr,
    ],
    where: { field: 'campaign_id', operator: 'eq', value: campaign },
    groupBy: [column],
    orderBy: [{ by: column, direction: 'asc' }],
    limit: labels.length + 1,
  });
  if (
    !result?.ok ||
    !Array.isArray(result.rows) ||
    result.rows.length > labels.length
  ) {
    throw new Error('Campaign aggregation unavailable');
  }
  /** Known-category count projection initialized only after successful native query. */
  const totals = Object.fromEntries(
    labels.map((label) => [label, 0])
  ) as Record<T, number>;
  // Process only known categories/index definitions or the explicitly bounded UTC day window.
  for (const raw of result.rows) {
    /** Native grouped/normalized notification facts, excluding recipients and payloads. */
    const row = raw as Record<string, unknown>;
    /** Known finite native grouping label, independently validated. */
    const category = row?.category;
    if (
      typeof category !== 'string' ||
      !labels.includes(category as T) ||
      totals[category as T] !== 0
    ) {
      throw new Error('Invalid campaign aggregate category');
    }
    // Zero-count groups are never returned by a normal grouped COUNT; validate anyway.
    /** Validated safe grouped integer count. */
    const n = count(row.event_count);
    if (n === 0) {
      throw new Error('Invalid zero-sized aggregate group');
    }
    totals[category as T] = n;
  }
  return totals;
}
export interface ProviderOutcomeEvent {
  /** Trusted provider's unique event reference. Never derived from unauthenticated request fields. */
  eventId: string;
  /** Trusted provider label or explicitly available provider-count projection; not mailbox reputation. */
  provider: string;
  /** Opaque host-authorized campaign scope; syntax does not grant tenant access. */
  campaignId: string;
  /** Opaque private durable mail reference; not emitted by aggregate reports. */
  messageId: string;
  /** Fixed authenticated notification category; not inferred inbox placement. */
  kind: ProviderOutcome;
  /** Provider-reported validated epoch milliseconds; never synthesized each build. */
  occurredAt: number;
}
export interface CampaignProviderOutcomes {
  /** Counts individual authenticated provider events, NOT unique recipients or inbox placement. */
  events: number;
  /** Finite known native state/outcome totals, not arbitrary query groups. */
  counts: Record<ProviderOutcome, number>;
  /** Explicit reported-events-only provenance; unknown feedback is not zero engagement. */
  coverage: 'reported-events-only';
}
export interface ProviderOutcomeLedger {
  /** Persist only an already host-authenticated provider notification with immutable event identity; identical replay returns false and conflicting replay rejects.
   * @param {ProviderOutcomeEvent} event - Already authenticated provider notification; no recipients, tokens or signed URLs.
   * @returns {Promise<boolean>} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
   */
  record(event: ProviderOutcomeEvent): Promise<boolean>;
  /** Query explicit campaign-bound native grouped provider counts; missing storage fails rather than inventing delivery coverage.
   * @param {string} campaign - Validated explicit campaign scope; host independently authorizes tenant access.
   * @returns {Promise<CampaignProviderOutcomes>} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
   */
  summarize(campaign: string): Promise<CampaignProviderOutcomes>;
}
/** Borrow an explicit durable database for immutable provider outcomes. Host verifies provider signatures/tenant permissions before calling; this factory is not HTTP authentication.
 * @param {DeliveryDatabase} db - Borrowed durable connector facade; host owns scope/authorization/lifecycle.
 * @param {string} table - Validated host-selected source table, never a caller SQL expression.
 * @returns {ProviderOutcomeLedger} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
export function createDatabaseProviderOutcomeLedger(
  db: DeliveryDatabase,
  table = 'zerux_email_provider_outcomes'
): ProviderOutcomeLedger {
  validateDb(db);
  if (!validTable(table)) {
    throw new TypeError('Invalid provider event table');
  }
  let ready: Promise<void> | undefined;
  /** Lazily initialize only this ledger table/indexes; failed initialization is retryable.
   * @returns {Promise<void>} Validated native/ledger result or explicit failure; no automatic external work is started.
   */
  const ensure = () =>
    (ready ??= (async () => {
      /** Native structured create/insert/read receipt; false/unavailable results remain explicit. */
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
          { name: 'provider', type: 'varchar', length: 96, notNull: true },
          { name: 'campaign_id', type: 'varchar', length: 96, notNull: true },
          { name: 'message_id', type: 'varchar', length: 128, notNull: true },
          { name: 'kind', type: 'varchar', length: 32, notNull: true },
          { name: 'occurred_at', type: 'bigint', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Provider outcome table unavailable');
      }
      if (db.createIndex) {
        // Process only known categories/index definitions or the explicitly bounded UTC day window.
        for (const [suffix, columns] of [
          ['camp_kind_idx', ['campaign_id', 'kind']],
          ['camp_day_idx', ['campaign_id', 'occurred_at']],
        ] as const) {
          try {
            await db.createIndex({
              table,
              name: `${table.slice(0, 40)}_${suffix}`,
              columns: [...columns],
              ifNotExists: true,
            });
          } catch {
            /* optional performance indexes; feedback recording must not be blocked */
          }
        }
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  /** Validate and derive an immutable provider-plus-event identity without executing event content.
   * @param {ProviderOutcomeEvent} event - Explicit trusted ledger/report value; private source data is never logged.
   * @returns {{id:string;provider:string;campaign_id:string;message_id:string;kind:ProviderOutcome;occurred_at:number}} Validated native/ledger result or explicit failure; no automatic external work is started.
   */
  const normalized = (event: ProviderOutcomeEvent) => {
    if (
      !event ||
      typeof event.eventId !== 'string' ||
      !/^[-A-Za-z0-9:_./]{1,160}$/.test(event.eventId) ||
      !providerId.test(event.provider) ||
      !campaignId.test(event.campaignId) ||
      !messageId.test(event.messageId) ||
      !providerOutcomes.includes(event.kind) ||
      !validTime(event.occurredAt)
    ) {
      throw new TypeError('Invalid provider outcome');
    }
    /** SHA-256 event identity over trusted provider/event reference; integrity is not authorization. */
    const id = createHash('sha256')
      .update(JSON.stringify([event.provider, event.eventId]))
      .digest('hex');
    return {
      id,
      provider: event.provider,
      campaign_id: event.campaignId,
      message_id: event.messageId,
      kind: event.kind,
      occurred_at: event.occurredAt,
    };
  };
  return {
    /** Persist only an already host-authenticated provider notification with immutable event identity; identical replay returns false and conflicting replay rejects.
     * @param {ProviderOutcomeEvent} event - Already authenticated provider notification; no recipients, tokens or signed URLs.
     * @returns {Promise<boolean>} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
     */
    async record(event) {
      /** Native grouped/normalized notification facts, excluding recipients and payloads. */
      const row = normalized(event);
      await ensure();
      /** Read only the expected immutable notification identity for replay comparison.
       * @returns {Promise<unknown>} Validated native/ledger result or explicit failure; no automatic external work is started.
       */
      const lookup = async () => {
        /** Native structured create/insert/read receipt; false/unavailable results remain explicit. */
        const r = await db.select({
          table,
          columns: [
            'id',
            'provider',
            'campaign_id',
            'message_id',
            'kind',
            'occurred_at',
          ],
          where: { field: 'id', operator: 'eq', value: row.id },
          limit: 1,
        });
        if (!r?.ok || !Array.isArray(r.rows)) {
          throw new Error('Provider event lookup unavailable');
        }
        return r.rows[0] as Record<string, unknown> | undefined;
      };
      try {
        /** Native structured create/insert/read receipt; false/unavailable results remain explicit. */
        const r = await db.insert({ table, values: row });
        if (r?.ok) {
          return true;
        }
      } catch (error) {
        /** Existing immutable notification facts checked before classifying identical replay. */
        const old = await lookup();
        if (!old) {
          throw error;
        }
        if (
          old.provider !== row.provider ||
          old.campaign_id !== row.campaign_id ||
          old.message_id !== row.message_id ||
          old.kind !== row.kind ||
          Number(old.occurred_at) !== row.occurred_at
        ) {
          throw new Error('Conflicting provider event replay');
        }
        return false;
      }
      /** Existing immutable notification facts checked before classifying identical replay. */
      const old = await lookup();
      if (old) {
        if (
          old.provider !== row.provider ||
          old.campaign_id !== row.campaign_id ||
          old.message_id !== row.message_id ||
          old.kind !== row.kind ||
          Number(old.occurred_at) !== row.occurred_at
        ) {
          throw new Error('Conflicting provider event replay');
        }
        return false;
      }
      throw new Error('Provider event insert unavailable');
    },
    /** Query explicit campaign-bound native grouped provider counts; missing storage fails rather than inventing delivery coverage.
     * @param {string} campaign - Validated explicit campaign scope; host independently authorizes tenant access.
     * @returns {Promise<CampaignProviderOutcomes>} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
     */
    async summarize(campaign) {
      if (!campaignId.test(campaign)) {
        throw new TypeError('Invalid campaign ID');
      }
      await ensure();
      /** Successfully queried finite state/outcome totals. */
      const counts = await groupCount(
        db,
        table,
        campaign,
        'kind',
        providerOutcomes
      );
      return {
        counts,
        events: Object.values(counts).reduce((sum, n) => sum + n, 0),
        coverage: 'reported-events-only',
      };
    },
  };
}
export interface CampaignPerformanceReport {
  /** Opaque host-authorized campaign scope; syntax does not grant tenant access. */
  campaignId: string;
  /** Counted without an application-side row cap. Queries are read-committed, not snapshot-isolated. */
  mode: 'database';
  /** True for this persisted native query scope, not a global transaction snapshot. */
  complete: true;
  /** Safe native current-state total without a client-side record cap. */
  total: number;
  /** Finite known native state/outcome totals, not arbitrary query groups. */
  counts: Record<EmailDeliveryState, number>;
  /** Current durable sent-state percentage or null for zero denominator; not mailbox delivery. */
  smtpAcceptedPercent: number | null;
  /** Daily buckets and activity summaries require a separate bounded report. */
  dailyCoverage: 'not-computed';
  /** Not computed by native SMTP state counts. */
  activityCoverage: 'not-computed';
  /** Only authenticated provider feedback captured in the optional ledger. */
  provider: CampaignProviderOutcomes | null;
}
/** Create an explicit native grouped-count reporter over existing delivery storage. Never create a missing source table to fabricate zero totals.
 * @param {object} options - Explicit borrowed database and bounded source/coverage settings.
 * @param {DeliveryDatabase} options.db - Borrowed authorized database.
 * @param {string} [options.deliveryTable] - Existing delivery-state table.
 * @param {ProviderOutcomeLedger} [options.provider] - Optional authenticated notification ledger.
 * @returns {function} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
export function createDatabaseCampaignPerformanceReporter(options: {
  /** Borrowed explicit database; never implicitly closed by inert report/ledger factories. */
  db: DeliveryDatabase;
  /** Existing host-selected delivery table, default zerux_email_delivery; not created here. */
  deliveryTable?: string;
  /** Trusted provider label or explicitly available provider-count projection; not mailbox reputation. */
  provider?: ProviderOutcomeLedger;
}) {
  /** Borrowed explicit database; its lifetime/tenant scope remains host-owned. */
  const db = options?.db;
  validateDb(db);
  /** Validated existing delivery or explicit ledger table, never request SQL. */
  const table = options.deliveryTable ?? 'zerux_email_delivery';
  if (!validTable(table)) {
    throw new TypeError('Invalid delivery table');
  }
  // The delivery store owns this table's creation and migrations; initializing it here
  // would allow accidentally treating a missing store as a campaign with zero messages.
  return async (campaign: string): Promise<CampaignPerformanceReport> => {
    if (!campaignId.test(campaign)) {
      throw new TypeError('Invalid campaign ID');
    }
    /** Successfully queried finite state/outcome totals. */
    const counts = await groupCount(
      db,
      table,
      campaign,
      'state',
      deliveryStates
    );
    /** Safe aggregate denominator; zero yields no invented percentage. */
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (!Number.isSafeInteger(total)) {
      throw new Error('Campaign total exceeds safe integer range');
    }
    /** Explicit optional authenticated-notification coverage, not inferred from SMTP acceptance. */
    const provider = options.provider
      ? await options.provider.summarize(campaign)
      : null;
    return {
      campaignId: campaign,
      mode: 'database',
      complete: true,
      total,
      counts,
      smtpAcceptedPercent: total ? (100 * counts.sent) / total : null,
      dailyCoverage: 'not-computed',
      activityCoverage: 'not-computed',
      provider,
    };
  };
}
