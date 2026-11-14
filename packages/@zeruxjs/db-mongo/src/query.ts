import type {
  ComparisonOperator,
  SelectOperation,
  WhereClause,
  WherePredicate,
} from '@zeruxjs/db';
import { createDatabaseError } from '@zeruxjs/db';

/** Translate only the supported column/literal DSL; aggregation literals remain data.
 * @param {unknown} value - Candidate literal or structured column/value expression.
 * @param {boolean} aggregation - Whether to wrap literals with $literal, default false.
 * @returns {unknown} Generated native operand; unknown expression kinds reject. */
export const toMongoValue = (value: unknown, aggregation = false): unknown => {
  if (value && typeof value === 'object' && 'kind' in value) {
    /** Minimal expression view checked before generating any native operand. */
    const expr = value as { kind?: unknown; name?: unknown; value?: unknown };
    if (expr.kind === 'column') {
      assertSafeField(expr.name as string);
      return `$${expr.name}`;
    }
    if (expr.kind !== 'value') {
      throw createDatabaseError({
        code: 'INVALID_QUERY',
        message: 'Unsupported Mongo expression',
      });
    }
    assertSafeDocument(expr.value);
    return aggregation ? { $literal: expr.value } : expr.value;
  }
  assertSafeDocument(value);
  return aggregation ? { $literal: value } : value;
};

/** Escape regex metacharacters before translating only SQL-like percent/underscore wildcards.
 * @param {unknown} value - Literal pattern candidate converted by the existing compatibility contract.
 * @returns {string} Escaped anchored-pattern body; no arbitrary regex input is forwarded. */
const escapeMongoLike = (value: unknown): string =>
  String(value)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');

/** Reject unsafe dotted field paths and prototype/operator segments.
 * @param {string} name - Candidate authored field path.
 * @returns {void} Validates syntax, not tenant/resource authorization. */
export const assertSafeField = (name: string): void => {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name) ||
    name
      .split('.')
      .some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))
  ) {
    throw createDatabaseError({
      code: 'INVALID_WHERE',
      message: 'Unsafe MongoDB field name',
    });
  }
};

/** Reject operator/prototype-like field names and cycles within document depth/node budgets.
 * @param {unknown} value - Candidate operand/document data; no raw native expression authorization.
 * @param {number} maxDepth - Integer depth limit, default 32 and maximum 32.
 * @returns {void} Validates the existing traversal domain; trusted host accessors are not sandboxed.
 */
export function assertSafeDocument(value: unknown, maxDepth = 32): void {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 32) {
    throw createDatabaseError({
      code: 'INVALID_WHERE',
      message: 'Invalid Mongo document depth budget',
    });
  }
  /** Ancestor set detecting cycles during bounded document traversal. */
  const seen = new WeakSet<object>();
  let nodes = 0;
  /** Traverse one candidate document node with a shared visit budget.
   * @param {unknown} input - Current document node.
   * @param {number} depth - Current root-zero traversal depth.
   * @returns {void} Rejects cycles or unsupported field names before native dispatch.
   */
  function walk(input: unknown, depth: number): void {
    if (++nodes > 100000 || depth > Math.min(maxDepth, 32)) {
      throw createDatabaseError({
        code: 'INVALID_WHERE',
        message: 'Mongo document nesting too deep',
      });
    }
    if (!input || typeof input !== 'object') {
      return;
    }
    if (seen.has(input)) {
      throw createDatabaseError({
        code: 'INVALID_WHERE',
        message: 'Cyclic Mongo document',
      });
    }
    seen.add(input);
    if (Array.isArray(input)) {
      // Traverse array values within the shared depth/node ceiling.
      for (const item of input) {
        walk(item, depth + 1);
      }
    } else {
      // Validate every document field before recursive traversal; host accessors are not sandboxed.
      for (const [key, entry] of Object.entries(input)) {
        assertSafeField(key);
        walk(entry, depth + 1);
      }
    }
    seen.delete(input);
  }
  walk(value, 0);
}
/** Map only allowlisted comparison operators to generated Mongo selectors.
 * @param {ComparisonOperator} operator - Structured comparison discriminator.
 * @param {unknown} value - Already validated literal operand.
 * @returns {unknown} Native selector data; unsupported operators reject. */
const mapOperator = (operator: ComparisonOperator, value: unknown) => {
  switch (operator) {
    case 'eq':
      return value;
    case 'ne':
      return { $ne: value };
    case 'gt':
      return { $gt: value };
    case 'gte':
      return { $gte: value };
    case 'lt':
      return { $lt: value };
    case 'lte':
      return { $lte: value };
    case 'like':
    case 'ilike':
      return {
        $regex: `^${escapeMongoLike(value)}$`,
        ...(operator === 'ilike' ? { $options: 'i' } : {}),
      };
    case 'in':
      return { $in: Array.isArray(value) ? value : [value] };
    case 'notIn':
      return { $nin: Array.isArray(value) ? value : [value] };
    case 'isNull':
      return null;
    case 'isNotNull':
      return { $ne: null };
    default:
      throw createDatabaseError({
        code: 'INVALID_WHERE',
        message: 'Unsupported Mongo comparison operator',
      });
  }
};

/** Compile a selector with one shared logical-node budget.
 * @param {WhereClause} where - Structured caller filter; tenant predicates belong outside it.
 * @param {number} depth - Initial depth, default zero and maximum 32.
 * @returns {Record<string,unknown>} Generated native filter with no raw operator passthrough. */
export const buildWhere = (
  where: WhereClause,
  depth = 0
): Record<string, unknown> => compileWhere(where, depth, { nodes: 0 });
/** Validate own predicate shape and recurse within shared depth/node/branch ceilings.
 * @param {WhereClause} where - Current structured predicate.
 * @param {number} depth - Current logical depth.
 * @param {{nodes:number}} budget - Shared mutable node counter, maximum 10000.
 * @param {number} budget.nodes - Shared logical node count, capped at 10000.
 * @returns {Record<string,unknown>} Generated native predicate only. */
const compileWhere = (
  where: WhereClause,
  depth: number,
  budget: { nodes: number }
): Record<string, unknown> => {
  if (
    !Number.isSafeInteger(depth) ||
    depth < 0 ||
    ++budget.nodes > 10000 ||
    !where ||
    typeof where !== 'object' ||
    Array.isArray(where) ||
    depth > 32
  ) {
    throw createDatabaseError({
      code: 'INVALID_WHERE',
      message: 'Invalid or deeply nested Mongo where clause',
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(where))) {
    throw createDatabaseError({
      code: 'INVALID_WHERE',
      message: 'Mongo predicates require own fields',
    });
  }
  /** Own predicate fields checked against exactly one logical form or named scalar fields. */
  const keys = Object.keys(where);
  /** Recognized Boolean keys; mixing them with scalar predicate fields rejects. */
  const logical = keys.filter((k) => ['and', 'or', 'not'].includes(k));
  if (
    (logical.length && keys.length !== 1) ||
    (!logical.length &&
      keys.some(
        (k) =>
          !['field', 'operator', 'value', 'values', 'from', 'to'].includes(k)
      ))
  ) {
    throw createDatabaseError({
      code: 'INVALID_WHERE',
      message: 'Invalid Mongo predicate keys',
    });
  }
  if ('and' in where) {
    if (
      !Array.isArray(where.and) ||
      !where.and.length ||
      where.and.length > 1000
    ) {
      throw createDatabaseError({
        code: 'INVALID_WHERE',
        message: 'Empty Mongo AND clauses are not allowed',
      });
    }
    return {
      $and: where.and.map((entry) => compileWhere(entry, depth + 1, budget)),
    };
  }

  if ('or' in where) {
    if (
      !Array.isArray(where.or) ||
      !where.or.length ||
      where.or.length > 1000
    ) {
      throw createDatabaseError({
        code: 'INVALID_WHERE',
        message: 'Empty Mongo OR clauses are not allowed',
      });
    }
    return {
      $or: where.or.map((entry) => compileWhere(entry, depth + 1, budget)),
    };
  }

  if ('not' in where) {
    return { $nor: [compileWhere(where.not, depth + 1, budget)] };
  }

  return buildPredicate(where);
};

/** Compile one validated named-field predicate and literal operands.
 * @param {WherePredicate} predicate - Structured comparison without arbitrary native selectors.
 * @returns {Record<string,unknown>} Generated named-field native filter. */
const buildPredicate = (predicate: WherePredicate): Record<string, unknown> => {
  if (!predicate.field || typeof predicate.field !== 'string') {
    throw createDatabaseError({
      code: 'INVALID_WHERE',
      message: 'Mongo where predicates require string field names',
    });
  }

  assertSafeField(predicate.field);

  if (predicate.operator === 'between') {
    assertSafeDocument(predicate.from);
    assertSafeDocument(predicate.to);
    return {
      [predicate.field]: {
        $gte: toMongoValue(predicate.from),
        $lte: toMongoValue(predicate.to),
      },
    };
  }

  if (predicate.operator === 'exists' || predicate.operator === 'notExists') {
    return {
      [predicate.field]: {
        $exists: predicate.operator === 'exists',
      },
    };
  }

  /** Existing values-over-value compatibility precedence before literal validation. */
  const sourceValue = predicate.values ?? predicate.value;
  assertSafeDocument(sourceValue);
  return {
    [predicate.field]: mapOperator(
      predicate.operator,
      toMongoValue(sourceValue)
    ),
  };
};

/** Compile validated named columns/aliases or explicit literal projection values.
 * @param {SelectOperation} operation - Structured selected columns.
 * @returns {Record<string,unknown>|undefined} Native projection or absence; literal strings cannot become operators. */
export const buildProjection = (
  operation: SelectOperation
): Record<string, unknown> | undefined => {
  if (!operation.columns || operation.columns.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    operation.columns.map((column) => {
      if (typeof column === 'string') {
        assertSafeField(column);
      } else {
        if (column.as !== undefined) {
          assertSafeField(column.as);
        }
        if (typeof column.expr === 'string') {
          assertSafeField(column.expr);
        }
      }
      if (typeof column === 'string') {
        return [column, 1];
      }

      if (typeof column.expr === 'string') {
        return [column.as ?? column.expr, `$${column.expr}`];
      }

      return [column.as ?? 'value', toMongoValue(column.expr, true)];
    })
  );
};

/** Validate named fields and explicit native ascending/descending order.
 * @param {SelectOperation} operation - Structured order specification.
 * @returns {Record<string,1|-1>|undefined} Native sort map or absence; unsupported expressions/directions reject. */
export const buildSort = (
  operation: SelectOperation
): Record<string, 1 | -1> | undefined => {
  if (!operation.orderBy || operation.orderBy.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    operation.orderBy.map((entry) => {
      // Resolve only the existing named-field forms; expressions still reject below.
      let field = 'value';
      if (typeof entry === 'string') {
        field = entry;
      } else if (typeof entry.by === 'string') {
        field = entry.by;
      }
      assertSafeField(field);
      if (typeof entry === 'string') {
        return [entry, 1];
      }

      if (
        entry.direction !== undefined &&
        !['asc', 'desc'].includes(entry.direction)
      ) {
        throw createDatabaseError({
          code: 'INVALID_QUERY',
          message: 'Invalid Mongo sort direction',
        });
      }
      if (typeof entry.by !== 'string') {
        throw createDatabaseError({
          code: 'INVALID_QUERY',
          message: 'Mongo sorting requires a named field',
        });
      }
      return [
        typeof entry.by === 'string' ? entry.by : 'value',
        entry.direction === 'desc' ? -1 : 1,
      ];
    })
  );
};
