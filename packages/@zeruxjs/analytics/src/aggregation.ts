import type {
  AnalyticsConnection,
  AnalyticsAggregateQuery,
  AnalyticsAggregateResult,
} from './types.js';

/** Allowlisted public dimensions mapped to storage columns; caller text never becomes a column expression. */
const dimensions = {
  event: 'event_name',
  source: 'source',
  site: 'site',
  pathname: 'pathname',
} as const;
/** Internal scalar predicates supported by the portable database query contract. */
type Clause = {
  /** Validated storage column, never raw caller SQL. */
  field: string;
  /** Equality or inclusive range comparison. */
  operator: 'eq' | 'gte' | 'lte';
  /** Bound scalar value passed separately from the query structure. */
  value: string | number;
};
/** Expected UTC bucket label shape after ISO serialization. */
const utcDate = /^\d{4}-\d\d-\d\d$/;
/** Read a native count without accepting negative, fractional or unsafe values.
 * @param {unknown} value - Driver count, optionally represented as decimal digits.
 * @returns {number} A safe nonnegative integer; malformed driver results throw. */
const readCount = (value: unknown): number => {
  /** Driver count normalized only when a string contains decimal digits. */
  const number =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw new Error('Invalid analytics count returned by database');
  }
  return number;
};
/** Construct a structured predicate without interpolating SQL.
 * @param {Clause[]} conditions - Already validated predicates for the selected table.
 * @returns {Clause | {and: Clause[]}} The single predicate or an explicit conjunction. */
const where = (conditions: Clause[]) =>
  conditions.length === 1 ? conditions[0] : { and: conditions };
/** Native COUNT(id) expression reused by total and bucket queries. */
const countExpr = {
  expr: {
    kind: 'function' as const,
    name: 'COUNT' as const,
    args: [{ kind: 'column' as const, name: 'id' }],
  },
  as: 'event_count',
};
/** Read aggregate rows through the borrowed connection.
 * @param {AnalyticsConnection} connection - Host-owned connector; this function never closes it.
 * @param {Parameters<AnalyticsConnection['select']>[0]} operation - Structured aggregate query.
 * @returns {Promise<Record<string, unknown>[]>} Driver rows; unavailable or malformed responses reject. */
const getRows = async (
  connection: AnalyticsConnection,
  operation: Parameters<AnalyticsConnection['select']>[0]
) => {
  /** Settled connector response; failed queries must not masquerade as empty data. */
  const response = await connection.select(operation);
  if (!response?.ok || !Array.isArray(response.rows)) {
    throw new Error('Analytics aggregate storage unavailable');
  }
  return response.rows as Record<string, unknown>[];
};
/** Validate shared grouping, filter and millisecond bounds before report execution.
 * @param {AnalyticsAggregateQuery} query - Public structured query; group limit defaults at execution.
 * @returns {void} Returns normally when valid; unsupported dimensions or invalid bounds throw.
 */
export function validateAggregateQuery(query: AnalyticsAggregateQuery) {
  if (!['event', 'source', 'site', 'pathname', 'day'].includes(query.groupBy)) {
    throw new TypeError('Unsupported analytics aggregate dimension');
  }
  if (
    query.limit !== undefined &&
    (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 500)
  ) {
    throw new RangeError('Invalid aggregate group limit');
  }
  // Validate each optional bound before any query uses it.
  for (const value of [query.since, query.until]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
    ) {
      throw new RangeError('Invalid analytics query time');
    }
  }
  if (
    query.since !== undefined &&
    query.until !== undefined &&
    query.since > query.until
  ) {
    throw new RangeError('Reversed analytics time range');
  }
  if (
    query.name !== undefined &&
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(query.name)
  ) {
    throw new TypeError('Invalid event name');
  }
  if (
    query.source !== undefined &&
    !['web', 'email', 'server', 'system'].includes(query.source)
  ) {
    throw new TypeError('Invalid event source');
  }
  if (
    query.site !== undefined &&
    (typeof query.site !== 'string' ||
      query.site.length > 200 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in a site label.
      /[\x00-\x1f]/.test(query.site))
  ) {
    throw new TypeError('Invalid site');
  }
}
/** Count persisted events using native structured database queries.
 * Totals and buckets are separate reads, not a transactionally pinned reporting snapshot.
 * UTC days use inclusive millisecond bounds clipped to the requested interval.
 * @param {AnalyticsConnection} connection - Borrowed connector with native aggregate support.
 * @param {string} table - Host-validated event table identifier.
 * @param {AnalyticsAggregateQuery} query - Filters and grouping; daily queries require at most 366 days.
 * @returns {Promise<AnalyticsAggregateResult>} Exact persisted counts at each read with explicit group truncation; storage errors reject.
 */
export async function aggregateEventCounts(
  connection: AnalyticsConnection,
  table: string,
  query: AnalyticsAggregateQuery
): Promise<AnalyticsAggregateResult> {
  validateAggregateQuery(query);
  /** Validated caller filters applied in the database, including the explicit site when supplied. */
  const conditions: Clause[] = [];
  if (query.name) {
    conditions.push({ field: 'event_name', operator: 'eq', value: query.name });
  }
  if (query.source) {
    conditions.push({ field: 'source', operator: 'eq', value: query.source });
  }
  if (query.site !== undefined) {
    conditions.push({ field: 'site', operator: 'eq', value: query.site });
  }
  if (query.since !== undefined) {
    conditions.push({
      field: 'occurred_at',
      operator: 'gte',
      value: query.since,
    });
  }
  if (query.until !== undefined) {
    conditions.push({
      field: 'occurred_at',
      operator: 'lte',
      value: query.until,
    });
  }
  /** Database-wide aggregate for the selected filters, independent of the displayed group limit. */
  const totalRows = await getRows(connection, {
    table,
    columns: [countExpr],
    ...(conditions.length ? { where: where(conditions) } : {}),
  });
  if (totalRows.length !== 1) {
    throw new Error('Invalid analytics aggregate result');
  }
  /** Validated whole-query aggregate, rather than a sum of the displayed page. */
  const total = readCount(totalRows[0]!.event_count);
  /** Maximum displayed groups; one extra grouped row detects truncation (default 100). */
  const limit = query.limit ?? 100;
  if (query.groupBy === 'day') {
    // A bounded interval is compulsory; otherwise an unbounded number of DB round-trips is possible.
    if (query.since === undefined || query.until === undefined) {
      throw new RangeError(
        'Daily aggregations require explicit since and until timestamps'
      );
    }
    /** UTC boundary input retained for the first selected day. */
    const start = Date.UTC(
      new Date(query.since).getUTCFullYear(),
      new Date(query.since).getUTCMonth(),
      new Date(query.since).getUTCDate()
    );
    /** UTC boundary input retained for the last selected day. */
    const end = Date.UTC(
      new Date(query.until).getUTCFullYear(),
      new Date(query.until).getUTCMonth(),
      new Date(query.until).getUTCDate()
    );
    /** Inclusive UTC day count, capped at 366 before bucket queries are scheduled. */
    const days = Math.floor((end - start) / 86400000) + 1;
    if (days > 366) {
      throw new RangeError('Daily query range exceeds 366 UTC days');
    }
    /** Ordered bucket records; slicing does not change the whole-query total. */
    const groups: AnalyticsAggregateResult['groups'] = [];
    // Bounded fixed concurrency for DB pools. All bounds remain inclusive at millisecond precision.
    for (let index = 0; index < days; index += 6) {
      /** At most six bucket queries admitted together; settlement precedes the next batch. */
      const batch = Array.from(
        { length: Math.min(6, days - index) },
        (_, offset) => {
          /** UTC midnight for this bucket; bounds are clipped to the requested millisecond interval. */
          const at = start + (index + offset) * 86400000;
          /** Deterministic ISO day label independent of the server local time zone. */
          const day = new Date(at).toISOString().slice(0, 10);
          if (!utcDate.test(day)) {
            throw new Error('Invalid UTC day');
          }
          /** Inclusive first millisecond counted in this UTC bucket. */
          const startAt = Math.max(at, query.since!);
          /** Inclusive last millisecond counted in this UTC bucket. */
          const endAt = Math.min(at + 86400000 - 1, query.until!);
          return getRows(connection, {
            table,
            columns: [countExpr],
            where: where([
              ...conditions.filter((c) => c.field !== 'occurred_at'),
              { field: 'occurred_at', operator: 'gte', value: startAt },
              { field: 'occurred_at', operator: 'lte', value: endAt },
            ]),
          }).then((rows) => {
            if (rows.length !== 1) {
              throw new Error('Invalid daily aggregate result');
            }
            return { category: day, value: readCount(rows[0]!.event_count) };
          });
        }
      );
      groups.push(...(await Promise.all(batch)));
    }
    return {
      groups: groups.slice(0, limit),
      total,
      truncated: groups.length > limit,
      mode: 'database',
      groupBy: 'day',
    };
  }
  /** Storage column selected solely from the fixed dimension map. */
  const column = dimensions[query.groupBy];
  /** Bounded native aggregate rows; malformed scalars reject instead of inventing totals. */
  const rows = await getRows(connection, {
    table,
    columns: [
      { expr: { kind: 'column', name: column }, as: 'category' },
      countExpr,
    ],
    ...(conditions.length ? { where: where(conditions) } : {}),
    groupBy: [column],
    orderBy: [
      { by: 'event_count', direction: 'desc' },
      { by: column, direction: 'asc' },
    ],
    limit: limit + 1,
  });
  /** Ordered bucket records; slicing does not change the whole-query total. */
  const groups = rows.slice(0, limit).map((row) => {
    if (typeof row.category !== 'string') {
      throw new Error('Invalid analytics aggregate dimension');
    }
    return {
      category: row.category.slice(0, 150),
      value: readCount(row.event_count),
    };
  });
  return {
    groups,
    total,
    truncated: rows.length > limit,
    mode: 'database',
    groupBy: query.groupBy,
  };
}
