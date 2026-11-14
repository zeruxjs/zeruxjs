import type { CoverageRecord } from './coverage.js';
import type { RunSummary, TestResult } from './types/test.js';
/** An unavailable optional environment is neither an assertion failure nor a skip. */
export class EnvironmentUnavailableError extends Error {
  /** Create an explicit unavailable-environment or intentional-skip outcome without reporting a passing assertion.
   * @param {string} environment - Fixed environment label, excluding private data.
   * @param {unknown} cause - Optional private native load/launch cause.
   */
  constructor(
    readonly environment: string,
    cause?: unknown
  ) {
    super(`Test environment unavailable: ${environment}`, { cause });
    this.name = 'EnvironmentUnavailableError';
  }
}
/** Explicit trusted callback marker for intentional skipping, distinct from missing environments. */
export class IntentionalSkipError extends Error {
  /** Create an explicit unavailable-environment or intentional-skip outcome without reporting a passing assertion.
   * @param {string} reason - Public intentional-skip reason, default fixed text; omit secrets.
   */
  constructor(reason = 'Intentional skip') {
    super(reason);
    this.name = 'IntentionalSkipError';
  }
}
/** Explicitly end the current trusted callback with an intentional-skip marker; teardown failures can still override it.
 * @param {string} reason - Optional public reason bounded to2048characters; never include private test values.
 * @returns {never} Throws the intentional-skip marker, never silently declares a passed result.
 */
export function skipTest(reason?: string): never {
  if (
    reason !== undefined &&
    (typeof reason !== 'string' || reason.length > 2048)
  ) {
    throw new TypeError('Invalid skip reason');
  }
  throw new IntentionalSkipError(reason);
}
/** Classify trusted native outcome markers, keeping missing required environments distinct from intentional skips.
 * @param {unknown} error - Unknown trusted callback error/marker.
 * @returns {TestResult['status']} Environment-unavailable, skipped or failed; no missing environment becomes a green skip.
 */
export function failureStatus(error: unknown): TestResult['status'] {
  if (error instanceof EnvironmentUnavailableError) {
    return 'environment-unavailable';
  } else {
    if (error instanceof IntentionalSkipError) {
      return 'skipped';
    } else {
      return 'failed';
    }
  }
}
/** Portable trusted projection; full schema validation/disclosure policy belongs to report construction. */
export interface NormalizedResultRecord {
  /** Supported portable result schema version. */
  version: 1;
  /** Public test label; the host must exclude secrets/personal data. */
  name: string;
  /** Actual trusted Node/browser environment or explicit fallback. */
  environment: 'node' | 'browser';
  /** Actual passed/failed/skipped/unavailable outcome. */
  status: TestResult['status'];
  /** Actual observed result duration in milliseconds. */
  durationMs: number;
  /** Optional public selection/skip explanation. */
  reason?: string;
  /** Optional trusted error name/message without stacks or causes; still potentially private. */
  error?: {
    /** Error classification copied from the trusted error; no stack or cause is serialized. */
    name: string;
    /** Private trusted error text included only under the chosen report disclosure policy. */
    message: string;
  };
  /** Distinguishes not collected, reported or explicitly empty source inventory. */
  coverageStatus: 'not-collected' | 'reported' | 'no-sources';
  /** Borrowed actual coverage receipts, never inferred from test success. */
  coverage: readonly CoverageRecord[];
  /** Borrowed explicit capture references; no artifact file is opened by normalization. */
  artifacts: NonNullable<TestResult['artifacts']>;
}
/** Project trusted in-process results into portable V1 fields without stacks/causes; optional text/source/artifact labels still require report disclosure policy.
 * @param {RunSummary} summary - Actual trusted runner summary; this low-level projection does not fully validate hostile JSON.
 * @param {'node' | 'browser'} environment - Fallback environment only when a trusted result omits it, default Node.
 * @returns {NormalizedResultRecord[]} New result envelopes with borrowed coverage/artifact lists; no instrumentation or capture is invented.
 */
export function normalizeResults(
  summary: RunSummary,
  environment: 'node' | 'browser' = 'node'
): NormalizedResultRecord[] {
  return summary.results.map((result) => ({
    version: 1 as const,
    name: result.name,
    environment: result.environment ?? environment,
    status: result.status,
    durationMs: result.durationMs,
    reason:
      result.reason ??
      (result.status === 'skipped' ? 'intentional-or-filtered' : undefined),
    ...(result.error && {
      error: { name: result.error.name, message: result.error.message },
    }),
    coverageStatus: (() => {
      if (result.coverage === undefined) {
        return 'not-collected';
      } else {
        if (result.coverage.length) {
          return 'reported';
        } else {
          return 'no-sources';
        }
      }
    })(),
    coverage: result.coverage ?? [],
    artifacts: result.artifacts ?? [],
  }));
}
