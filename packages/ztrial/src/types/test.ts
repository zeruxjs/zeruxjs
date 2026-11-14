import type { CoverageRecord } from '../coverage.js';
/** One callback invocation’s cooperative cancellation and explicit reverse cleanup ownership. */
export interface TestExecutionContext {
  /** Owned invocation cancellation signal; callbacks must cooperate to stop actual work. */
  readonly signal: AbortSignal;
  /** Register owned cleanup immediately after acquisition on this individual callback invocation.
   * @param {() => void | Promise<void>} dispose - Trusted synchronous/asynchronous cleanup; at most128 per invocation.
   * @returns {void} Runs once in reverse order after callback completion/failure/timeout; rejects late registrations.
   */
  onCleanup(dispose: () => void | Promise<void>): void;
}
/** Trusted executable case/hook callback; timeout cannot forcibly terminate arbitrary JavaScript. */
export type TestFunction = (
  context: TestExecutionContext
) => unknown | Promise<unknown>;
/** Trusted lifecycle callback with its own invocation cleanup scope, distinct from test-body scope. */
export type HookFunction = TestFunction;
/** Internal deferred case registration; callbacks are trusted host/test code. */
export interface TestCase {
  /** Registry-local monotonic identifier, not durable cross-run identity. */
  id: number;
  /** Public report label; omit secrets and personal data. */
  name: string;
  /** Explicit trusted executable callback; never parsed from arbitrary data. */
  fn: TestFunction;
  /** Intentional declared/inherited skip flag. */
  skip: boolean;
  /** Explicit focused-selection flag, optionally forbidden by the run owner. */
  only: boolean;
  /** Owning registry-local suite identifier. */
  suiteId: number;
  /** Explicit positive callback observation deadline; CLI limits it to ten minutes. */
  timeoutMs?: number;
  /** Explicit whole-case retry count; production side effects require their own safe fixture design. */
  retries?: number;
}
/** Registry-owned synchronous suite declaration and ordered lifecycle hooks. */
export interface Suite {
  /** Registry-local monotonic identifier, not durable cross-run identity. */
  id: number;
  /** Parent registry-local suite identifier, or null for the root. */
  parent: number | null;
  /** Public report label; omit secrets and personal data. */
  name: string;
  /** Ordered root-to-parent local suite identifiers. */
  ancestors: number[];
  /** Ordered trusted suite setup callbacks, each with an invocation-owned context. */
  beforeAll: HookFunction[];
  /** Ordered trusted suite teardown callbacks, including reached suites on bail. */
  afterAll: HookFunction[];
  /** Ordered trusted per-attempt setup callbacks, each with its own cleanup scope. */
  beforeEach: HookFunction[];
  /** Ordered trusted reached-suite per-attempt cleanup callbacks. */
  afterEach: HookFunction[];
  /** Intentional declared/inherited skip flag. */
  skip: boolean;
  /** Explicit focused-selection flag, optionally forbidden by the run owner. */
  only: boolean;
}
/** Actual normalized outcome distinguishing intentional skip from unavailable required environments. */
export type TestStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'environment-unavailable';
/** Trusted in-process outcome; raw errors may contain private data and require explicit report redaction. */
export interface TestResult {
  /** Public report label; omit secrets and personal data. */
  name: string;
  /** Actual passed/failed/skipped/environment-unavailable classification. */
  status: TestStatus;
  /** Observed host-clock duration in milliseconds. */
  durationMs: number;
  /** Optional private native cause; default public report encoders omit error text. */
  error?: Error;
  /** Actual callback attempt count, not a delivery or exactly-once guarantee. */
  attempts?: number;
  /** Actual Node/browser execution label; absence is not browser acceptance. */
  environment?: 'node' | 'browser';
  /** Optional public skip/unavailable explanation; omit private values. */
  reason?: string;
  /** Optional actual instrumentation receipts, never inferred from test success. */
  coverage?: readonly CoverageRecord[];
  /** Optional explicit owner-managed capture references; no artifact bytes are embedded. */
  artifacts?: readonly {
    /** Explicit screenshot/trace/video capture kind. */
    type: 'screenshot' | 'trace' | 'video';
    /** Safe relative owned capture path, subject to report disclosure policy. */
    path: string;
  }[];
}
/** Actual outcome counts and ordered per-case receipts; not fabricated browser or coverage evidence. */
export interface RunSummary {
  /** Actual passed result count. */
  passed: number;
  /** Explicit unavailable required-environment count; not an intentional skip. */
  unavailable?: number;
  /** Actual failed callback/cleanup result count. */
  failed: number;
  /** Intentional declared/filtered/bail skip count. */
  skipped: number;
  /** Observed host-clock duration in milliseconds. */
  durationMs: number;
  /** Ordered actual trusted in-process result records. */
  results: TestResult[];
}
/** Explicit trusted execution/reporting policy; retries are intentional test behavior, not production mutation recovery. */
export interface RunOptions {
  /** Explicit positive callback observation deadline; CLI limits it to ten minutes. */
  timeoutMs?: number;
  /** Explicit whole-case retry count; production side effects require their own safe fixture design. */
  retries?: number;
  /** Explicitly reject when failures or required environments are unavailable. */
  throwOnFailure?: boolean;
  /** Literal text or an explicitly compiled trusted RegExp; CLI text is never compiled as regex. */
  match?: string | RegExp;
  /** Stop starting later eligible cases after a failure/unavailable result while cleaning reached suites. */
  bail?: boolean;
  /** Reject accidental focused registrations before executing selected cases. */
  forbidOnly?: boolean;
  /** Trusted synchronous result observer; it is not a private-data-safe log sink. */
  onResult?: (result: TestResult) => void;
}
