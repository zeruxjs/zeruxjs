import type {
  AnalyticsConnection,
  AnalyticsNumericAggregateQuery,
  AnalyticsNumericAggregateResult,
} from './types.js';
import { validateAggregateQuery } from './aggregation.js';

/** Allowlisted public dimensions mapped to storage columns; caller text never becomes a column expression. */
const dimensions = {
  event: 'event_name',
  source: 'source',
  site: 'site',
  pathname: 'pathname',
} as const;
/** Bounded property-name grammar shared by numeric metric validation. */
const fields = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
/** Internal scalar predicates supported by the portable database query contract. */
type Clause = {
  /** Validated storage column, never raw caller SQL. */
  field: string;
  /** Equality or inclusive range comparison. */
  operator: 'eq' | 'gte' | 'lte';
  /** Bound scalar value passed separately from the query structure. */
  value: string | number;
};
/** Construct a structured predicate without interpolating SQL.
 * @param {Clause[]} items - Already validated predicates for the selected table.
 * @returns {Clause | {and: Clause[]}} The single predicate or an explicit conjunction. */
const where = (items: Clause[]) =>
  items.length === 1 ? items[0] : { and: items };
/** Build an inert database column descriptor.
 * @param {string} name - Internal allowlisted storage column.
 * @returns {{kind: 'column', name: string}} Structured column expression. */
const col = (name: string) => ({ kind: 'column' as const, name });
/** Build an allowlisted native aggregate expression.
 * @param {'COUNT'|'SUM'|'AVG'|'MIN'|'MAX'} name - Supported database aggregate function.
 * @param {string} field - Internal storage column to aggregate.
 * @param {string} as - Internal result alias.
 * @returns {{expr: {kind: 'function', name: 'COUNT'|'SUM'|'AVG'|'MIN'|'MAX', args: ReturnType<typeof col>[]}, as: string}} Structured expression with no raw SQL. */
const func = (
  name: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
  field: string,
  as: string
) => ({ expr: { kind: 'function' as const, name, args: [col(field)] }, as });
/** Public metric names mapped to the only permitted native aggregate functions. */
const metricName = {
  sum: 'SUM',
  average: 'AVG',
  min: 'MIN',
  max: 'MAX',
} as const;
/** Count of committed numeric facts, separate from the event count. */
const countColumn = func('COUNT', 'event_id', 'numeric_count');
/** Read a native count without accepting negative, fractional or unsafe values.
 * @param {unknown} n - Driver count, optionally represented as decimal digits.
 * @returns {number} A safe nonnegative integer; malformed driver results throw. */
const readCount = (n: unknown): number => {
  /** Driver scalar converted to a number only under the surrounding explicit string policy. */
  const value = typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid numeric fact count');
  }
  return value;
};
/** Decode a native numeric result without treating missing nonempty data as zero.
 * @param {unknown} n - Driver aggregate value, including numeric strings.
 * @param {number} count - Validated number of matching numeric facts.
 * @returns {number} Finite aggregate, or zero only for an empty null/undefined aggregate. */
const readMetric = (n: unknown, count: number): number => {
  if (count === 0 && (n === null || n === undefined)) {
    return 0;
  }
  /** Driver scalar converted to a number only under the surrounding explicit string policy. */
  const value = typeof n === 'string' && n.trim() !== '' ? Number(n) : n;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid numeric aggregate returned by database');
  }
  return value;
};
/** Execute a numeric aggregate without owning the connector lifecycle.
 * @param {AnalyticsConnection} connection - Borrowed host connection.
 * @param {Parameters<AnalyticsConnection['select']>[0]} operation - Structured native aggregate query.
 * @returns {Promise<Record<string, unknown>[]>} Settled rows; malformed or unavailable storage rejects.
 */
async function select(
  connection: AnalyticsConnection,
  operation: Parameters<AnalyticsConnection['select']>[0]
) {
  /** Settled connector response; failed queries must not masquerade as empty data. */
  const response = await connection.select(operation);
  if (!response?.ok || !Array.isArray(response.rows)) {
    throw new Error('Numeric analytics storage unavailable');
  }
  return response.rows as Record<string, unknown>[];
}
/** Aggregate committed numeric facts using native database functions.
 * Coverage stays indexed-only even when every returned bucket is complete at its read.
 * Totals and groups are separate reads and can observe concurrent writes differently.
 * @param {AnalyticsConnection} connection - Borrowed connector with native numeric aggregates.
 * @param {string} table - Host-validated numeric fact table identifier.
 * @param {AnalyticsNumericAggregateQuery} query - Configured property, metric, grouping and bounded filters.
 * @returns {Promise<AnalyticsNumericAggregateResult>} Materialized metrics and fact counts; invalid input or storage errors reject.
 */
export async function aggregateNumericFacts(
  connection: AnalyticsConnection,
  table: string,
  query: AnalyticsNumericAggregateQuery
): Promise<AnalyticsNumericAggregateResult> {
  validateAggregateQuery(query);
  if (
    !Object.hasOwn(metricName, query.metric) ||
    !fields.test(query.valueField) ||
    ['constructor', 'prototype', '__proto__'].includes(query.valueField)
  ) {
    throw new TypeError('Invalid numeric metric or property');
  }
  /** Numeric-property predicate plus validated event/site/time constraints applied before aggregation. */
  const filters: Clause[] = [
    { field: 'property_name', operator: 'eq', value: query.valueField },
  ];
  if (query.name) {
    filters.push({ field: 'event_name', operator: 'eq', value: query.name });
  }
  if (query.source) {
    filters.push({ field: 'source', operator: 'eq', value: query.source });
  }
  if (query.site !== undefined) {
    filters.push({ field: 'site', operator: 'eq', value: query.site });
  }
  if (query.since !== undefined) {
    filters.push({ field: 'occurred_at', operator: 'gte', value: query.since });
  }
  if (query.until !== undefined) {
    filters.push({ field: 'occurred_at', operator: 'lte', value: query.until });
  }
  /** Validated metric expression over committed numeric_value records. */
  const valueColumn = func(
    metricName[query.metric],
    'numeric_value',
    'metric_value'
  );
  /** Native value and fact-count expressions used for both totals and groups. */
  const columns = [valueColumn, countColumn];
  /** Database-wide aggregate for the selected filters, independent of the displayed group limit. */
  const totalRows = await select(connection, {
    table,
    columns,
    where: where(filters),
  });
  if (totalRows.length !== 1) {
    throw new Error('Invalid numeric aggregate result');
  }
  /** Validated count of materialized facts; this is not a historical-event completeness assertion. */
  const matchedFacts = readCount(totalRows[0]!.numeric_count);
  /** Validated whole-query aggregate, rather than a sum of the displayed page. */
  const total = readMetric(totalRows[0]!.metric_value, matchedFacts);
  /** Maximum displayed groups; one extra grouped row detects truncation (default 100). */
  const limit = query.limit ?? 100;
  /** Displayed groups collected from native rows or bounded UTC bucket reads. */
  let groups: AnalyticsNumericAggregateResult['groups'] = [];
  /** Whether additional groups were omitted from the returned page. */
  let truncated = false;
  if (query.groupBy === 'day') {
    if (query.since === undefined || query.until === undefined) {
      throw new RangeError('Daily numeric aggregation requires explicit range');
    }
    /** UTC boundary input retained for the first selected day. */
    const start = new Date(query.since);
    /** UTC boundary input retained for the last selected day. */
    const end = new Date(query.until);
    /** UTC midnight of the first selected day. */
    const first = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate()
    );
    /** UTC midnight of the last selected day. */
    const last = Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate()
    );
    /** Inclusive UTC day count, capped at 366 before bucket queries are scheduled. */
    const days = Math.floor((last - first) / 86400000) + 1;
    if (days > 366) {
      throw new RangeError('Daily numeric range exceeds 366 UTC days');
    }
    // Await batches of at most six native reads before admitting the next UTC days.
    for (let index = 0; index < days; index += 6) {
      /** At most six bucket queries admitted together; settlement precedes the next batch. */
      const batch = Array.from(
        { length: Math.min(6, days - index) },
        async (_, offset) => {
          /** UTC midnight for this bucket; bounds are clipped to the requested millisecond interval. */
          const at = first + (index + offset) * 86400000;
          /** Existing nontime filters with clipped inclusive bounds for this UTC day. */
          const ranges: Clause[] = [
            ...filters.filter((f) => f.field !== 'occurred_at'),
            {
              field: 'occurred_at',
              operator: 'gte',
              value: Math.max(at, query.since!),
            },
            {
              field: 'occurred_at',
              operator: 'lte',
              value: Math.min(at + 86400000 - 1, query.until!),
            },
          ];
          /** Bounded native aggregate rows; malformed scalars reject instead of inventing totals. */
          const rows = await select(connection, {
            table,
            columns,
            where: where(ranges),
          });
          if (rows.length !== 1) {
            throw new Error('Invalid daily numeric aggregate result');
          }
          return {
            category: new Date(at).toISOString().slice(0, 10),
            value: readMetric(
              rows[0]!.metric_value,
              readCount(rows[0]!.numeric_count)
            ),
          };
        }
      );
      groups.push(...(await Promise.all(batch)));
    }
    truncated = groups.length > limit;
    groups = groups.slice(0, limit);
  } else {
    /** Storage column selected solely from the fixed dimension map. */
    const column = dimensions[query.groupBy];
    /** Bounded native aggregate rows; malformed scalars reject instead of inventing totals. */
    const rows = await select(connection, {
      table,
      columns: [{ expr: col(column), as: 'category' }, ...columns],
      where: where(filters),
      groupBy: [column],
      orderBy: [
        { by: 'metric_value', direction: 'desc' },
        { by: column, direction: 'asc' },
      ],
      limit: limit + 1,
    });
    truncated = rows.length > limit;
    groups = rows.slice(0, limit).map((row) => {
      if (typeof row.category !== 'string') {
        throw new Error('Invalid numeric group label');
      }
      return {
        category: row.category.slice(0, 150),
        value: readMetric(row.metric_value, readCount(row.numeric_count)),
      };
    });
  }
  return {
    groups,
    total,
    matchedFacts,
    truncated,
    mode: 'materialized',
    coverage: 'indexed-only',
    groupBy: query.groupBy,
    metric: query.metric,
    valueField: query.valueField,
  };
}
