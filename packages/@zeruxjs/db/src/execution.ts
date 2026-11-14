import type {
  DatabaseCapabilities,
  DatabaseExecutionPolicy,
  DatabaseQueryOptions,
  QueryOperation,
} from './types.js';
import { createDatabaseError } from './utils.js';
/** Known structured-connector guarantees; absent declarations remain unknown. */
export const capabilityNames = [
  'returning',
  'transactions',
  'cancellation',
  'schema',
  'indexes',
  'nativeAggregation',
] as const;
/** Create fixed execution diagnostics without query bodies or native causes.
 * @param {string} code - Stable internal execution classification.
 * @returns {Error & {details: import('./types.js').DatabaseErrorShape}} Fixed-message abstraction error. */
export const executionError = (code: string) =>
  createDatabaseError({
    code,
    message:
      (
        {
          QUERY_CANCELLED: 'Database query cancelled',
          QUERY_DEADLINE: 'Database query deadline exceeded',
          QUERY_LIMIT: 'Database pending query limit exceeded',
          BATCH_LIMIT: 'Database batch limit exceeded',
          UNSUPPORTED_CAPABILITY: 'Database capability is unavailable',
          INVALID_EXECUTION_OPTIONS: 'Invalid database execution options',
        } as Record<string, string>
      )[code] ?? 'Database execution failed',
  });
/** Normalize only known structured API guarantees; missing metadata stays unknown.
 * @param {Partial<DatabaseCapabilities> | undefined} value - Candidate configuration or metadata; runtime shape/limits are validated.
 * @returns {Readonly<DatabaseCapabilities>} Frozen detached capability snapshot.
 */
export function capabilities(
  value: Partial<DatabaseCapabilities> | undefined
): Readonly<DatabaseCapabilities> {
  /** Fresh capability snapshot detached from mutable adapter metadata. */
  const result = {} as DatabaseCapabilities;
  // Normalize only the named structured API guarantees.
  for (const key of capabilityNames) {
    /** One normalized support declaration, validated before exposure. */
    const support = value?.[key] ?? 'unknown';
    if (!['supported', 'unsupported', 'unknown'].includes(support)) {
      throw executionError('INVALID_EXECUTION_OPTIONS');
    }
    result[key] = support;
  }
  return Object.freeze(result);
}
/** Validate host-owned limits before opening a connection.
 * @param {DatabaseExecutionPolicy} value - Candidate configuration or metadata; runtime shape/limits are validated.
 * @returns {Required<Omit<DatabaseExecutionPolicy,"onMetric">> & Pick<DatabaseExecutionPolicy,"onMetric">} Resolved admission/batch/drain policy with optional hook.
 */
export function executionPolicy(
  value: DatabaseExecutionPolicy = {}
): Required<Omit<DatabaseExecutionPolicy, 'onMetric'>> &
  Pick<DatabaseExecutionPolicy, 'onMetric'> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) =>
        !['maxPending', 'maxBatch', 'shutdownGraceMs', 'onMetric'].includes(k)
    )
  ) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  /** Accepted native-operation ceiling, default 64 and maximum 4096. */
  const maxPending = value.maxPending ?? 64;
  /** Operation/insert-row ceiling, default 128 and maximum 4096. */
  const maxBatch = value.maxBatch ?? 128;
  /** Cooperative drain grace before reverse connector shutdown, default 5000ms. */
  const shutdownGraceMs = value.shutdownGraceMs ?? 5000;
  // Validate admission and batch caps before connection startup.
  for (const n of [maxPending, maxBatch]) {
    if (!Number.isSafeInteger(n) || n < 1 || n > 4096) {
      throw executionError('INVALID_EXECUTION_OPTIONS');
    }
  }
  if (
    !Number.isSafeInteger(shutdownGraceMs) ||
    shutdownGraceMs < 1 ||
    shutdownGraceMs > 60000 ||
    (value.onMetric !== undefined && typeof value.onMetric !== 'function')
  ) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  return { maxPending, maxBatch, shutdownGraceMs, onMetric: value.onMetric };
}
/** Validate cancellation/requirements outside JSON and resolve the earlier deadline.
 * @param {DatabaseQueryOptions} value - Candidate configuration or metadata; runtime shape/limits are validated.
 * @returns {DatabaseQueryOptions} Own options copy with an absolute effective deadline.
 */
export function queryOptions(
  value: DatabaseQueryOptions = {}
): DatabaseQueryOptions {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !['signal', 'deadline', 'timeoutMs', 'require'].includes(k)
    )
  ) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  if (
    value.deadline !== undefined &&
    (!Number.isSafeInteger(value.deadline) ||
      value.deadline < 0 ||
      value.deadline > Date.now() + 600000)
  ) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  if (
    value.timeoutMs !== undefined &&
    (!Number.isSafeInteger(value.timeoutMs) ||
      value.timeoutMs < 1 ||
      value.timeoutMs > 600000)
  ) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  if (
    value.require !== undefined &&
    (!Array.isArray(value.require) ||
      value.require.length > 6 ||
      value.require.some((k) => !capabilityNames.includes(k)))
  ) {
    throw executionError('INVALID_EXECUTION_OPTIONS');
  }
  /** Earlier absolute timeout/deadline cutoff; undefined preserves no deadline. */
  const deadline =
    value.timeoutMs === undefined
      ? value.deadline
      : Math.min(value.deadline ?? Infinity, Date.now() + value.timeoutMs);
  return { ...value, deadline };
}
/** Reject known unsupported operations and strict requirements before native work.
 * @param {QueryOperation} operation - Validated JSON operation selected for this connector.
 * @param {DatabaseCapabilities} available - Normalized connector capability snapshot.
 * @param {DatabaseQueryOptions} options - Separate query cancellation/deadline/strict requirement policy.
 * @returns {void} Unknown legacy metadata remains compatible unless explicitly required.
 */
export function checkCapabilities(
  operation: QueryOperation,
  available: DatabaseCapabilities,
  options: DatabaseQueryOptions
): void {
  /** Explicit requirements plus known operation-specific capabilities, checked before native execution. */
  const required = [...(options.require ?? [])];
  if (
    'returning' in operation &&
    operation.returning?.length &&
    available.returning !== 'unknown'
  ) {
    required.push('returning');
  }
  if (
    [
      'createDb',
      'dropDb',
      'switchDB',
      'createTable',
      'dropTable',
      'alterTable',
      'turcunateTable',
    ].includes(operation.op) &&
    available.schema !== 'unknown'
  ) {
    required.push('schema');
  }
  if (
    (['createIndex', 'dropIndex'].includes(operation.op) ||
      (operation.op === 'createTable' && operation.indexes?.length) ||
      (operation.op === 'alterTable' &&
        operation.actions.some(
          (a) => a.type === 'addIndex' || a.type === 'dropIndex'
        ))) &&
    available.indexes !== 'unknown'
  ) {
    required.push('indexes');
  }
  // Require explicit support for every requested/known-required guarantee.
  for (const key of required) {
    if (available[key] !== 'supported') {
      throw executionError('UNSUPPORTED_CAPABILITY');
    }
  }
}
