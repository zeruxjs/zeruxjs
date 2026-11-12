import type { JsonPrimitive, SelectOperation, WhereClause } from './types.js';
import { assertJsonSerializable, createDatabaseError } from './utils.js';
export interface KeysetOrder {
  /** Flat validated ordering column; values must be non-null scalars. */
  column: string;
  /** Explicit ascending/descending comparison direction. */
  direction: 'asc' | 'desc';
}
export interface KeysetContinuation {
  /** Current continuation format; only version 1 is accepted. */
  version: 1;
  /** Exact validated table identity; host allowlists remain authoritative. */
  table: string;
  /** One to four unique keys, ending in the declared unique tie-breaker. */
  order: KeysetOrder[];
  /** One validated scalar per ordering key; no null/missing values. */
  values: Exclude<JsonPrimitive, null>[];
}
export interface KeysetPageOptions {
  /** Exact validated table identity; host allowlists remain authoritative. */
  table: string;
  /** One to four unique keys, ending in the declared unique tie-breaker. */
  order: KeysetOrder[];
  /** Final ordering column whose uniqueness/non-null behavior is guaranteed by the host. */
  uniqueKey: string;
  /** Integer page cap, 1–1000; offsets are not accepted. */
  limit: number;
  /** Optional continuation matching this exact table/order. */
  after?: KeysetContinuation;
  /** Optional host-bound filter combined with the generated seek predicate. */
  where?: WhereClause;
}
/** Reject malformed keyset contracts without echoing cursor values.

 * @returns {never} Always throws INVALID_CONTINUATION. */
const fail = (): never => {
  throw createDatabaseError({
    code: 'INVALID_CONTINUATION',
    message: 'Invalid keyset pagination contract',
  });
};
/** Build bounded lexicographic paging over explicit non-null scalar order keys.
 * @param {KeysetPageOptions} options - Explicit table/order/unique tie-breaker and limit, with optional bound continuation.
 * @returns {{operation:SelectOperation,continuation(row:Record<string,unknown>):KeysetContinuation}} Page predicate and source-row continuation builder; host supplies uniqueness/collation.
 */
export function createKeysetPage(options: KeysetPageOptions): {
  operation: SelectOperation;
  /** Validate own source-row keys and build a detached versioned continuation.
   * @param {Record<string,unknown>} row - Returned row containing every selected stable ordering key.
   * @returns {KeysetContinuation} Inert cursor bound to table/order, never an authorization credential.
   */
  continuation(row: Record<string, unknown>): KeysetContinuation;
} {
  assertJsonSerializable(options, 'Keyset options');
  if (
    Object.keys(options).some(
      (k) =>
        !['table', 'uniqueKey', 'limit', 'order', 'where', 'after'].includes(k)
    )
  ) {
    fail();
  }
  /** Validated page identity and cap; host still guarantees unique non-null tie-breakers. */
  const { table, uniqueKey, limit } = options;
  /** Detached ordered keys retained for this page/continuation pair. */
  const order = structuredClone(options.order);
  if (
    typeof table !== 'string' ||
    typeof uniqueKey !== 'string' ||
    !/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(table) ||
    !Array.isArray(order) ||
    !order.length ||
    order.length > 4 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    order.at(-1)?.column !== uniqueKey ||
    new Set(order.map((k) => k?.column)).size !== order.length
  ) {
    fail();
  }
  // Validate every ordering key before interpreting a continuation.
  for (const key of order) {
    if (
      !key ||
      typeof key.column !== 'string' ||
      !/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key.column) ||
      !['asc', 'desc'].includes(key.direction)
    ) {
      fail();
    }
  }
  /** Accept only bounded non-null scalar cursor values.
   * @param {unknown} value - Candidate field value from a continuation or returned row.
   * @returns {boolean} Whether the value can participate in this keyset contract. */
  const scalar = (value: unknown): value is Exclude<JsonPrimitive, null> =>
    (typeof value === 'string' && value.length <= 4096) ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean';
  let where = options.where ? structuredClone(options.where) : undefined;
  if (options.after !== undefined) {
    /** Candidate continuation bound to the exact table and ordering. */
    const after = options.after;
    if (
      !after ||
      typeof after !== 'object' ||
      Object.keys(after).some(
        (k) => !['version', 'table', 'order', 'values'].includes(k)
      )
    ) {
      fail();
    }
    if (
      after.version !== 1 ||
      after.table !== table ||
      !Array.isArray(after.order) ||
      after.order.length !== order.length ||
      after.order.some(
        (k, i) =>
          !k ||
          k.column !== order[i].column ||
          k.direction !== order[i].direction
      ) ||
      !Array.isArray(after.values) ||
      after.values.length !== order.length ||
      !after.values.every(scalar)
    ) {
      fail();
    }
    /** Lexicographic disjunction preserving equal prefixes before each strict comparison. */
    const seek: WhereClause = {
      or: order.map((key, index) => ({
        and: [
          ...order.slice(0, index).map((prefix, i) => ({
            field: prefix.column,
            operator: 'eq' as const,
            value: after.values[i],
          })),
          {
            field: key.column,
            operator:
              key.direction === 'asc' ? ('gt' as const) : ('lt' as const),
            value: after.values[index],
          },
        ],
      })),
    };
    where = where ? { and: [where, seek] } : seek;
  }
  return {
    operation: {
      op: 'select',
      table,
      orderBy: order.map((k) => ({ by: k.column, direction: k.direction })),
      limit,
      ...(where ? { where } : {}),
    },
    /** Validate own source-row keys and build a detached versioned continuation.
     * @param {Record<string,unknown>} row - Returned row containing every selected stable ordering key.
     * @returns {KeysetContinuation} Inert cursor bound to table/order, never an authorization credential.
     */
    continuation(row) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        fail();
      }
      /** Ordered own row fields validated before continuation construction. */
      const values = order.map((key) => {
        if (!Object.hasOwn(row, key.column) || !scalar(row[key.column])) {
          fail();
        }
        return row[key.column] as Exclude<JsonPrimitive, null>;
      });
      return { version: 1, table, order: structuredClone(order), values };
    },
  };
}
