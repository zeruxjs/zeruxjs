/** Database-native, bounded UTC-day campaign trends.
 * Counts refer to the current delivery state indexed by its last update day, NOT
 * immutable delivery transitions. Provider counts are authenticated notifications,
 * not unique recipients or inbox-placement guarantees.
 */
import type { DeliveryDatabase } from './reporting.js';
import { deliveryStates, providerOutcomes } from './performance.js';
import type { EmailDeliveryState } from './delivery.js';
import type { ProviderOutcome } from './performance.js';

/** UTC fixed day duration; no local timezone arithmetic. */
const DAY_MS = 86_400_000;
/** Conservative opaque campaign scope grammar. */
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Conservative host-selected table grammar; structured queries never embed caller SQL. */
const tablePattern = /^[a-z][a-z0-9_]{0,62}$/;
/** Canonical UTC day syntax checked against real calendar parsing. */
const utcDay = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
/** Fixed structured COUNT(id) expression, never concatenated SQL. */
const countExpr = {
  expr: {
    kind: 'function' as const,
    name: 'COUNT' as const,
    args: [{ kind: 'column' as const, name: 'id' }],
  },
  as: 'event_count',
};
/** Validate a real canonical UTC calendar day, not only its textual shape.
 * @param {string} day - Canonical UTC YYYY-MM-DD day.
 * @returns {number} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
function dayTime(day: string) {
  if (typeof day !== 'string' || !utcDay.test(day)) {
    throw new TypeError('Invalid UTC date');
  }
  /** Canonical calendar day epoch milliseconds after real-date validation. */
  const milliseconds = Date.parse(`${day}T00:00:00.000Z`);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== day
  ) {
    throw new TypeError('Invalid calendar date');
  }
  return milliseconds;
}
/** Accept only safe native grouped integer counts; preserve decimal strings until validation.
 * @param {unknown} value - Untrusted connector count scalar.
 * @returns {number} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
function count(value: unknown) {
  /** Validated safe grouped integer count. */
  const n =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) {
    throw new Error('Invalid database trend count');
  }
  return n;
}
/** Execute one finite campaign/day grouped query without fetching recipient IDs or private documents.
 * @param {DeliveryDatabase} db - Borrowed durable connector facade; host owns scope/authorization/lifecycle.
 * @param {string} table - Validated host-selected source table, never a caller SQL expression.
 * @param {string} campaignId - Validated host-authorized campaign scope.
 * @param {string} column - Fixed internal grouping column, never arbitrary user SQL.
 * @param {string} timeColumn - Fixed internal indexed time column.
 * @param {number} start - Inclusive canonical UTC day epoch milliseconds.
 * @param {number} end - Exclusive canonical UTC next-day epoch milliseconds.
 * @param {readonly T[]} labels - Finite known category vocabulary bounding returned groups.
 * @returns {Promise<Record<T,number>>} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
async function grouped<T extends string>(
  db: DeliveryDatabase,
  table: string,
  campaignId: string,
  column: string,
  timeColumn: string,
  start: number,
  end: number,
  labels: readonly T[]
): Promise<Record<T, number>> {
  /** Finite native grouped query outcome; dependency failure is not empty data. */
  const result = await db.select({
    table,
    columns: [
      { expr: { kind: 'column', name: column }, as: 'category' },
      countExpr,
    ],
    where: {
      and: [
        { field: 'campaign_id', operator: 'eq', value: campaignId },
        { field: timeColumn, operator: 'gte', value: start },
        { field: timeColumn, operator: 'lt', value: end },
      ],
    },
    groupBy: [column],
    orderBy: [{ by: column, direction: 'asc' }],
    limit: labels.length + 1,
  });
  if (
    !result?.ok ||
    !Array.isArray(result.rows) ||
    result.rows.length > labels.length
  ) {
    throw new Error('Campaign trend database aggregation unavailable');
  }
  /** Known-category count projection initialized only after successful native query. */
  const totals = Object.fromEntries(
    labels.map((label) => [label, 0])
  ) as Record<T, number>;
  /** Per-query finite group set rejecting duplicate native rows. */
  const seen = new Set<string>();
  // Process only known categories/index definitions or the explicitly bounded UTC day window.
  for (const raw of result.rows) {
    /** Native grouped/normalized notification facts, excluding recipients and payloads. */
    const row = raw as Record<string, unknown>;
    if (
      !row ||
      typeof row.category !== 'string' ||
      !labels.includes(row.category as T) ||
      seen.has(row.category)
    ) {
      throw new Error('Invalid campaign trend category');
    }
    totals[row.category as T] = count(row.event_count);
    seen.add(row.category);
  }
  return totals;
}
/** Reject unsafe aggregate addition instead of rounding counts.
 * @param {number[]} values - Explicit trusted ledger/report value; private source data is never logged.
 * @returns {number} Validated native/ledger result or explicit failure; no automatic external work is started.
 */
const safeSum = (values: number[]) => {
  /** Safe aggregate denominator; zero yields no invented percentage. */
  const total = values.reduce((n, v) => n + v, 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error('Campaign trend total exceeds safe integer range');
  }
  return total;
};
export interface CampaignTrendDay {
  /** Canonical UTC calendar day. */
  day: string;
  /** Current durable record states, categorized by last updated UTC day. */
  counts: Record<EmailDeliveryState, number>;
  /** Safe native current-state total without a client-side record cap. */
  total: number;
  /** Only provider events actually received and persisted, including repeat notifications for one message. */
  provider: Record<ProviderOutcome, number> | null;
  /** Observed notification count or null when unavailable; not unique people. */
  providerEvents: number | null;
}
export interface CampaignTrendsReport {
  /** Opaque host-authorized campaign scope; syntax does not grant tenant access. */
  campaignId: string;
  /** Inclusive canonical UTC start day. */
  from: string;
  /** Inclusive canonical UTC end day. */
  to: string;
  /** Database-native aggregation, distinct from bounded application scans. */
  mode: 'database';
  /** True for this persisted native query scope, not a global transaction snapshot. */
  complete: true;
  /** Last-state-update-day, not immutable transition-day history. */
  deliveryCoverage: 'last-state-update-day';
  /** Reported-events-only or not-configured; never inferred mailbox placement. */
  providerCoverage: 'reported-events-only' | 'not-configured';
  /** Individual daily queries are not a transaction-wide snapshot. */
  snapshotConsistent: false;
  /** Bounded ordered UTC day projections without recipient/message IDs. */
  days: CampaignTrendDay[];
  /** Safe native current-state total without a client-side record cap. */
  total: number;
  /** Observed notification count or null when unavailable; not unique people. */
  providerEvents: number | null;
}
/** Create sequential native UTC-day reporting with default92-day and configurable1–366-day bounds. Current-state update days and received provider events are distinct coverage, not immutable transitions.
 * @param {object} options - Explicit borrowed database and bounded source/coverage settings.
 * @param {DeliveryDatabase} options.db - Borrowed authorized database.
 * @param {string} [options.deliveryTable] - Existing state table.
 * @param {string} [options.providerTable] - Optional existing notification table.
 * @param {number} [options.maxDays] - Default92, maximum366 sequential UTC days.
 * @returns {function} Explicit coverage-labelled safe result; storage failure/corruption rejects without private-value output.
 */
export function createDatabaseCampaignTrendsReporter(options: {
  /** Borrowed explicit database; never implicitly closed by inert report/ledger factories. */
  db: DeliveryDatabase;
  /** Existing host-selected delivery table, default zerux_email_delivery; not created here. */
  deliveryTable?: string;
  /** Optional existing authenticated notification table; absent coverage stays not-configured/null. */
  providerTable?: string;
  /** Default92-day window; configurable safe integer1–366, queries remain sequential. */
  maxDays?: number;
}) {
  /** Borrowed explicit database; its lifetime/tenant scope remains host-owned. */
  const db = options?.db;
  if (!db || typeof db.select !== 'function') {
    throw new TypeError('Durable trend database required');
  }
  /** Validated existing current-state source table. */
  const deliveryTable = options.deliveryTable ?? 'zerux_email_delivery';
  /** Optional validated existing notification table, with explicit missing coverage. */
  const providerTable = options.providerTable;
  if (
    !tablePattern.test(deliveryTable) ||
    (providerTable !== undefined && !tablePattern.test(providerTable))
  ) {
    throw new TypeError('Invalid campaign trend table');
  }
  /** Validated finite UTC reporting horizon, default92 and maximum366. */
  const maxDays = options.maxDays ?? 92;
  if (!Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > 366) {
    throw new RangeError('Invalid maximum campaign trend days');
  }
  return async function trends(
    campaignId: string,
    from: string,
    to: string
  ): Promise<CampaignTrendsReport> {
    if (!campaignPattern.test(campaignId)) {
      throw new TypeError('Invalid campaign ID');
    }
    /** Validated inclusive start epoch milliseconds. */
    const start = dayTime(from);
    /** Validated inclusive final UTC day epoch milliseconds. */
    const last = dayTime(to);
    if (last < start || Math.round((last - start) / DAY_MS) + 1 > maxDays) {
      throw new RangeError(
        'Campaign trend date window exceeds configured bounds'
      );
    }
    /** Operation-local bounded sequential native daily results. */
    const days: CampaignTrendDay[] = [];
    // Process only known categories/index definitions or the explicitly bounded UTC day window.
    for (let cursor = start; cursor <= last; cursor += DAY_MS) {
      /** Current canonical UTC day label; never an automatic lastmod. */
      const day = new Date(cursor).toISOString().slice(0, 10);
      // One day per iteration bounds connector pressure and prevents unbounded parallel reads.
      /** Successfully queried finite state/outcome totals. */
      const counts = await grouped(
        db,
        deliveryTable,
        campaignId,
        'state',
        'updated_at',
        cursor,
        cursor + DAY_MS,
        deliveryStates
      );
      /** Explicit optional authenticated-notification coverage, not inferred from SMTP acceptance. */
      const provider =
        providerTable === undefined
          ? null
          : await grouped(
              db,
              providerTable,
              campaignId,
              'kind',
              'occurred_at',
              cursor,
              cursor + DAY_MS,
              providerOutcomes
            );
      days.push({
        day,
        counts,
        total: safeSum(Object.values(counts)),
        provider,
        providerEvents: provider ? safeSum(Object.values(provider)) : null,
      });
    }
    return {
      campaignId,
      from,
      to,
      mode: 'database',
      complete: true,
      deliveryCoverage: 'last-state-update-day',
      providerCoverage:
        providerTable === undefined ? 'not-configured' : 'reported-events-only',
      snapshotConsistent: false,
      days,
      total: safeSum(days.map((day) => day.total)),
      providerEvents:
        providerTable === undefined
          ? null
          : safeSum(days.map((day) => day.providerEvents ?? 0)),
    };
  };
}
