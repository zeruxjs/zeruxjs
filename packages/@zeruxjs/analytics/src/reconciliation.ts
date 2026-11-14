import type { AnalyticsConnection, AnalyticsRow } from './types.js';
import { createHash } from 'node:crypto';

/** Derive a stable fact identifier independent of configured field order.
 * @param {string} eventId - Persisted source event identifier.
 * @param {string} field - Configured numeric property name.
 * @returns {string} Event ID with a truncated SHA-256 field suffix; this is identity, not authorization.
 */
export const numericFactId = (eventId: string, field: string): string =>
  `${eventId}_h${createHash('sha256').update(field).digest('hex').slice(0, 24)}`;

/** One bounded, resumable keyset page. Run from a trusted administrative process, never a public route. */
export interface NumericReconciliationQuery {
  /** An explicit closed historical UTC millisecond range. */
  since: number;
  /** Inclusive last historical UTC millisecond. */
  until: number;
  /** Optional tenant boundary. */
  site?: string;
  /** The last scanned event's ID, returned as nextCursor by the previous page. */
  cursor?: string;
  /** Maximum scanned source events, 1..200. Defaults to 100. */
  batchSize?: number;
}
/** Counters for one source page; callers own durable cursor checkpointing. */
export interface NumericReconciliationResult {
  /** Source events examined in this page. */
  scanned: number;
  /** Finite configured numeric facts derived from valid source rows. */
  expectedFacts: number;
  /** Facts confirmed inserted by this page. */
  created: number;
  /** Equivalent projections confirmed already present. */
  existing: number;
  /** Malformed historical rows skipped without writing projections. */
  invalidRows: number;
  /** null means the bounded source window was exhausted at the time of this read. */
  nextCursor: string | null;
  /** Whether a lookahead event requires another page. */
  hasMore: boolean;
  /** Only a source-scan completion indicator, NOT a transactional completeness guarantee. */
  windowExhausted: boolean;
}
/** Internal structured keyset predicates; never raw SQL. */
type Predicate = {
  /** Validated storage column used by a structured predicate. */
  field: string;
  /** Equality or inclusive/exclusive comparison operator. */
  operator: 'eq' | 'gte' | 'lte' | 'gt';
  /** Bound scalar predicate value. */
  value: string | number;
};
/** Immutable numeric projection copied from a validated historical row. */
type NumericFact = {
  /** Stable fact ID; compatible existing legacy IDs remain accepted. */
  id: string;
  /** Immutable source event reference. */
  event_id: string;
  /** Configured numeric property name. */
  property_name: string;
  /** Finite projected number. */
  numeric_value: number;
  /** Source event name preserved for filtering. */
  event_name: string;
  /** Source collection channel. */
  source: string;
  /** Source site boundary copied without inference. */
  site: string;
  /** Source path dimension. */
  pathname: string;
  /** Source event UTC millisecond timestamp. */
  occurred_at: number;
};
/** Compare stored fact values while preserving numeric signed-zero semantics.
 * @param {unknown} left - Value returned by storage.
 * @param {unknown} right - Expected projected value.
 * @returns {boolean} Whether the values match without coercion. */
const valuesEqual = (left: unknown, right: unknown): boolean =>
  typeof left === 'number' && typeof right === 'number'
    ? Object.is(left, right)
    : left === right;
/** Read a bounded structured query through a borrowed connection.
 * @param {AnalyticsConnection} connection - Host-owned connection; never closed here.
 * @param {Parameters<AnalyticsConnection['select']>[0]} operation - Structured source or fact lookup.
 * @returns {Promise<Record<string, unknown>[]>} Database rows; unavailable or malformed responses reject.
 */
async function checkedSelect(
  connection: AnalyticsConnection,
  operation: Parameters<AnalyticsConnection['select']>[0]
): Promise<Record<string, unknown>[]> {
  /** Settled database response; failed reads must never be interpreted as missing facts. */
  const response = await connection.select(operation);
  if (!response?.ok || !Array.isArray(response.rows)) {
    throw new Error('Numeric reconciliation read failed');
  }
  return response.rows as Record<string, unknown>[];
}
/** Project finite numeric facts without applying current ingestion-age restrictions.
 * @param {AnalyticsRow} row - Historical persisted event, treated as untrusted data.
 * @param {readonly string[]} fields - Host-validated configured numeric property names.
 * @returns {NumericFact[]|null} Finite projections, an empty list for absent numeric fields, or null for an invalid row.
 */
function buildFacts(
  row: AnalyticsRow,
  fields: readonly string[]
): NumericFact[] | null {
  if (
    !row ||
    typeof row.id !== 'string' ||
    !row.id ||
    row.id.length > 36 ||
    typeof row.properties_json !== 'string' ||
    typeof row.event_name !== 'string' ||
    typeof row.source !== 'string' ||
    typeof row.site !== 'string' ||
    typeof row.pathname !== 'string' ||
    !Number.isSafeInteger(row.occurred_at) ||
    row.occurred_at < 0
  ) {
    return null;
  }
  let properties: unknown;
  try {
    properties = JSON.parse(row.properties_json);
  } catch {
    return null;
  }
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return null;
  }
  /** Parsed historical properties used only as inert scalar data. */
  const record = properties as Record<string, unknown>;
  return fields.flatMap((field) =>
    typeof record[field] === 'number' && Number.isFinite(record[field])
      ? [
          {
            /** Stable fact ID; compatible existing legacy IDs remain accepted. */
            id: numericFactId(row.id, field),
            /** Immutable source event reference. */
            event_id: row.id,
            /** Configured numeric property name. */
            property_name: field,
            /** Finite projected number. */
            numeric_value: record[field] as number,
            /** Source event name preserved for filtering. */
            event_name: row.event_name,
            /** Source collection channel. */
            source: row.source,
            /** Source site boundary copied without inference. */
            site: row.site,
            /** Source path dimension. */
            pathname: row.pathname,
            /** Source event UTC millisecond timestamp. */
            occurred_at: row.occurred_at,
          },
        ]
      : []
  );
}
/** Insert one fact or verify an existing equivalent event/property projection.
 * A database-enforced unique event/property index is required for concurrent writers.
 * An unknown insert outcome is inspected, never automatically replayed here.
 * @param {AnalyticsConnection} connection - Borrowed host connection.
 * @param {string} table - Host-validated numeric table identifier.
 * @param {NumericFact} fact - Expected immutable projection including dimensions.
 * @returns {Promise<'created'|'existing'>} Confirmed disposition; conflicts, duplicates and unresolved failures reject.
 */
async function ensureFact(
  connection: AnalyticsConnection,
  table: string,
  fact: NumericFact
): Promise<'created' | 'existing'> {
  /** Read at most two facts for the unique event/property pair.
   * @returns {Promise<Record<string, unknown>[]>} Existing rows, including a duplicate sentinel when storage is inconsistent. */
  const lookup = () =>
    checkedSelect(connection, {
      table,
      columns: Object.keys(fact),
      where: {
        and: [
          { field: 'event_id', operator: 'eq', value: fact.event_id },
          { field: 'property_name', operator: 'eq', value: fact.property_name },
        ],
      },
      limit: 2,
    });
  let rows = await lookup();
  if (rows.length > 1) {
    throw new Error(
      'Duplicate numeric facts already exist; repair database before reconciliation'
    );
  }
  if (rows.length === 1) {
    // Legacy position-derived IDs are accepted, but values/dimensions must match.
    /** Expected fact values excluding the ID, allowing compatible legacy positional IDs. */
    const { id: _ignored, ...values } = fact;
    // Compare every dimension/value; an existing ID alone is not sufficient.
    for (const [key, value] of Object.entries(values)) {
      if (!valuesEqual(rows[0]![key], value)) {
        throw new Error('Conflicting numeric fact; manual correction required');
      }
    }
    return 'existing';
  }
  try {
    /** Insert outcome; an exception or non-ok result requires a read before deciding whether the fact exists. */
    const saved = await connection.insert({ table, values: fact });
    if (saved?.ok) {
      return 'created';
    }
  } catch {
    /* Might be a concurrent, successful insert. Check before returning an error. */
  }
  rows = await lookup();
  if (rows.length === 1) {
    /** Expected fact values excluding the ID, allowing compatible legacy positional IDs. */
    const { id: _ignored, ...values } = fact;
    // After an ambiguous insert, compare every dimension/value before accepting a matching existing fact.
    for (const [key, value] of Object.entries(values)) {
      if (!valuesEqual(rows[0]![key], value)) {
        throw new Error('Conflicting numeric fact after insert');
      }
    }
    return 'existing';
  }
  throw new Error('Numeric reconciliation insert failed');
}

/** Repair a bounded page of missing numeric facts from persisted source events.
 * The host owns authorization, validated tables/fields and the verified unique index.
 * Partial writes remain committed on failure; replay verifies each fact before inserting.
 * @param {AnalyticsConnection} connection - Borrowed connector supporting select and insert.
 * @param {string} eventTable - Host-validated source table.
 * @param {string} factTable - Host-validated numeric sidecar table.
 * @param {readonly string[]} fields - Configured numeric properties; no arbitrary field discovery.
 * @param {NumericReconciliationQuery} query - Closed time window, optional site and bounded continuation.
 * @returns {Promise<NumericReconciliationResult>} Page counters and continuation, not a transactional completeness guarantee.
 */
export async function reconcileNumericFacts(
  connection: AnalyticsConnection,
  eventTable: string,
  factTable: string,
  fields: readonly string[],
  query: NumericReconciliationQuery
): Promise<NumericReconciliationResult> {
  if (
    !query ||
    !Number.isSafeInteger(query.since) ||
    !Number.isSafeInteger(query.until) ||
    query.since < 0 ||
    query.until < query.since
  ) {
    throw new RangeError(
      'Numeric reconciliation requires a valid closed time window'
    );
  }
  if (
    query.site !== undefined &&
    (typeof query.site !== 'string' ||
      query.site.length > 200 ||
      // eslint-disable-next-line no-control-regex -- Reject controls in administrative query values.
      /[\x00-\x1f]/.test(query.site))
  ) {
    throw new TypeError('Invalid reconciliation site');
  }
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== 'string' ||
      query.cursor.length > 36 ||
      // eslint-disable-next-line no-control-regex -- Reject controls and whitespace in keyset cursors.
      /[\x00-\x20\x7f]/.test(query.cursor))
  ) {
    throw new TypeError('Invalid reconciliation cursor');
  }
  /** Maximum source events scanned in this page, default 100 with a hard ceiling of 200. */
  const batchSize = query.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new RangeError('Invalid reconciliation batch size');
  }
  /** Closed historical window plus explicit site and exclusive ID continuation constraints. */
  const where: Predicate[] = [
    { field: 'occurred_at', operator: 'gte', value: query.since },
    { field: 'occurred_at', operator: 'lte', value: query.until },
  ];
  if (query.site !== undefined) {
    where.push({ field: 'site', operator: 'eq', value: query.site });
  }
  if (query.cursor) {
    where.push({ field: 'id', operator: 'gt', value: query.cursor });
  }
  /** Source page with one lookahead row to determine whether a continuation is needed. */
  const rows = await checkedSelect(connection, {
    table: eventTable,
    columns: [
      'id',
      'event_name',
      'source',
      'site',
      'pathname',
      'occurred_at',
      'properties_json',
    ],
    where: { and: where },
    orderBy: [{ by: 'id', direction: 'asc' }],
    limit: batchSize + 1,
  });
  /** Whether the source read found an event beyond the requested page size. */
  const hasMore = rows.length > batchSize;
  /** Only this page is projected; the lookahead remains for the next call. */
  const scannedRows = rows.slice(0, batchSize) as unknown as AnalyticsRow[];
  let expectedFacts = 0;
  let created = 0;
  let existing = 0;
  let invalidRows = 0;
  // Process only the bounded source page; writes are verified sequentially.
  for (const row of scannedRows) {
    /** Validated finite numeric projections, or null for a malformed historical row. */
    const facts = buildFacts(row, fields);
    if (facts === null) {
      invalidRows++;
      continue;
    }
    expectedFacts += facts.length;
    // Finish each fact disposition before counting it or admitting the next write.
    for (const fact of facts) {
      /** Confirmed insert or existing matching fact; conflicting or unavailable storage rejects. */
      const status = await ensureFact(connection, factTable, fact);
      if (status === 'created') {
        created++;
      } else {
        existing++;
      }
    }
  }
  /** Last scanned event ID only when another source page was observed. */
  const nextCursor = hasMore ? scannedRows.at(-1)?.id : null;
  if (hasMore && !nextCursor) {
    throw new Error('Invalid persisted event ID; cannot resume reconciliation');
  }
  return {
    scanned: scannedRows.length,
    expectedFacts,
    created,
    existing,
    invalidRows,
    nextCursor: nextCursor ?? null,
    hasMore,
    windowExhausted: !hasMore,
  };
}
