import { createDatabaseError } from '@zeruxjs/db';
import type { QueryOperation } from '@zeruxjs/db';
/** Reject unsupported SQL contracts with fixed module-supplied diagnostics.
 * @param {string} code - Stable internal classification.
 * @param {string} message - Fixed diagnostic, default Invalid structured SQL input.
 * @returns {never} Always throws; never retries with an unguarded statement. */
export const refuseSql = (
  code: string,
  message = 'Invalid structured SQL input'
): never => {
  throw createDatabaseError({ code, message });
};
/** Copy only bounded own JSON data without invoking getters or arbitrary serialization hooks.
 * @param {unknown} input - Candidate direct/facade operation; no executable object shape is accepted.
 * @returns {QueryOperation} Detached null-prototype operation tree; shape validation follows.
 */
export function snapshotSqlOperation(input: unknown): QueryOperation {
  let nodes = 0;
  /** Ancestor identities rejecting cycles without invoking accessors. */
  const seen = new WeakSet<object>();
  /** Snapshot only bounded own JSON data, rejecting executable/accessor/prototype shapes.
   * @param {unknown} value - Candidate data node.
   * @param {number} depth - Root-zero depth, maximum 32.
   * @returns {unknown} Detached own-data node or a fixed validation error. */
  const copy = (value: any, depth: number): any => {
    if (++nodes > 20000 || depth > 32) {
      refuseSql('SQL_INPUT_LIMIT');
    }
    if (value === null || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        refuseSql('INVALID_SQL_VALUE');
      }
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 8 * 1024 * 1024) {
        refuseSql('SQL_INPUT_LIMIT');
      }
      return value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    ) {
      refuseSql('INVALID_SQL_VALUE');
    }
    if (seen.has(value)) {
      refuseSql('SQL_INPUT_LIMIT');
    }
    seen.add(value);
    /** Detached own-data candidate measured before exposing it to compiler traversal. */
    const result: any = Array.isArray(value) ? [] : Object.create(null);
    if (Array.isArray(value)) {
      if (value.length > 10000) {
        refuseSql('SQL_INPUT_LIMIT');
      }
      // Require every dense array slot; sparse holes cannot silently disappear.
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) {
          refuseSql('INVALID_SQL_VALUE');
        }
      }
      if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key))) {
        refuseSql('INVALID_SQL_VALUE');
      }
    }
    // Copy only own data descriptors, rejecting unsafe keys without invoking getters.
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        refuseSql('INVALID_SQL_VALUE');
      }
      /** Own data descriptor; getters cannot run during the snapshot. */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) {
        refuseSql('INVALID_SQL_VALUE');
      }
      result[key] = copy(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return result;
  };
  /** Detached own-data candidate measured before exposing it to compiler traversal. */
  const result = copy(input, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024) {
    refuseSql('SQL_INPUT_LIMIT');
  }
  return result;
}
/** Reject unknown object fields in the snapshotted structured grammar.
 * @param {unknown} value - Candidate snapshotted object/list node.
 * @param {readonly string[]} allowed - Exact permitted own grammar keys.
 * @returns {void} Narrows the accepted own-data record or throws.
 */
export function sqlObject(
  value: unknown,
  allowed: readonly string[]
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    refuseSql('INVALID_SQL_SHAPE');
  }
}
/** Require a bounded list without silently dropping entries.
 * @param {unknown} value - Candidate snapshotted object/list node.
 * @param {number} max - Explicit list ceiling, default 256.
 * @returns {void} Narrows to the existing bounded array contract or throws.
 */
export function sqlList(value: unknown, max = 256): asserts value is any[] {
  if (!Array.isArray(value) || value.length > max) {
    refuseSql('INVALID_SQL_SHAPE');
  }
}
/** Shared operation metadata keys; no SQL clause is inferred from unknown fields. */
const base = ['op', 'connection', 'dependsOn', 'use'];
/** Exact operation-specific clause allowlist; unsupported clauses cannot silently disappear. */
const keys: Record<string, string[]> = {
  createDb: ['name', 'ifNotExists'],
  dropDb: ['name', 'ifExists', 'force'],
  switchDB: ['name'],
  createTable: ['table', 'ifNotExists', 'columns', 'indexes'],
  dropTable: ['table', 'ifExists', 'cascade'],
  alterTable: ['table', 'actions'],
  turcunateTable: ['table', 'restartIdentity', 'cascade'],
  createIndex: ['table', 'name', 'columns', 'unique', 'ifNotExists', 'using'],
  dropIndex: ['table', 'name', 'ifExists'],
  insert: ['table', 'into', 'values', 'returning'],
  select: [
    'table',
    'as',
    'into',
    'distinct',
    'columns',
    'joins',
    'where',
    'groupBy',
    'having',
    'orderBy',
    'limit',
    'offset',
    'top',
    'fetch',
    'union',
    'unionAll',
  ],
  update: ['table', 'values', 'where', 'returning'],
  delete: ['table', 'where', 'returning'],
};
/** Validate operation-specific keys, flags and list clauses before compiling any native statement.
 * @param {QueryOperation} operation - Snapshotted single structured operation.
 * @returns {void} Unsupported upsert/conflict/raw clauses reject before dispatch.
 */
export function validateSqlOperation(operation: QueryOperation): void {
  if (
    !operation ||
    typeof operation.op !== 'string' ||
    !Object.hasOwn(keys, operation.op)
  ) {
    refuseSql('UNSUPPORTED_OPERATION');
  }
  if (
    operation.op === 'insert' &&
    [
      'upsert',
      'onConflict',
      'onDuplicateKey',
      'onDuplicateKeyUpdate',
      'ignore',
      'replace',
    ].some((k) => Object.hasOwn(operation, k))
  ) {
    refuseSql(
      'UNSUPPORTED_UPSERT',
      'SQL upsert/conflict clauses are unavailable'
    );
  }
  /** Operation-specific validation keys selected from the fixed SQL operation map. */
  const operationKeys = keys[operation.op];
  if (!operationKeys) {
    refuseSql('INVALID_OPERATION');
    throw new TypeError('SQL operation keys are missing');
  }
  sqlObject(operation, [...base, ...operationKeys]);
  /** Validated operation viewed only for fixed generic flag/list checks. */
  const data = operation as unknown as Record<string, unknown>;
  // Require Boolean operation flags rather than truthy coercion.
  for (const flag of [
    'ifExists',
    'ifNotExists',
    'force',
    'cascade',
    'restartIdentity',
    'distinct',
    'unique',
  ]) {
    if (data[flag] !== undefined && typeof data[flag] !== 'boolean') {
      refuseSql('INVALID_SQL_SHAPE');
    }
  }
  if ('returning' in operation && operation.returning !== undefined) {
    sqlList(operation.returning);
    if (operation.returning.some((v) => typeof v !== 'string')) {
      refuseSql('INVALID_SQL_SHAPE');
    }
  }
  // Bound every declared list clause before grammar-specific compilation.
  for (const key of [
    'columns',
    'indexes',
    'actions',
    'joins',
    'groupBy',
    'orderBy',
    'union',
    'unionAll',
  ]) {
    if (data[key] !== undefined) {
      sqlList(data[key]);
    }
  }
}
