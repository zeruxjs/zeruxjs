import { failureStatus } from '../results.js';
import { TestContext } from './context.js';
import type {
  TestCase,
  TestFunction,
  TestResult,
  RunSummary,
  RunOptions,
  Suite,
} from '../types/test.js';
/** Preserve native trusted callback errors and normalize thrown non-Error values for private runner diagnostics.
 * @param {unknown} value - Unknown trusted callback failure; do not publish raw content by default.
 * @returns {Error} Native error or a text-normalized error, retaining private causes only in process.
 */
function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
/** Invoke one trusted test/hook with its own cooperative signal and bounded reverse cleanup scope; reporting timeout never force-cancels JavaScript.
 * @param {TestFunction} fn - Explicit trusted callback invoked once in this attempt.
 * @param {number} timeoutMs - Positive finite callback deadline in milliseconds; cleanup waits each get the same budget.
 * @param {string} name - Public timeout label; do not include credentials or private request data.
 * @returns {Promise<void>} Callback/cleanup outcome; noncooperative timed-out work may still settle or cause later effects.
 */
export async function withTimeout(
  fn: TestFunction,
  timeoutMs: number,
  name: string
): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be positive');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Owned per-invocation cooperative signal, aborted on timeout and after callback completion. */
  const controller = new AbortController();
  /** Bounded per-invocation reverse cleanup registrations; no global mock/resource sweep. */
  const cleanup: (() => void | Promise<void>)[] = [];
  let closed = false;
  let failure: unknown;
  let failed = false;
  let cleanupFailure: AggregateError | undefined;
  /** Single-invocation cleanup/signal capability; do not retain it for future callbacks. */
  const context = {
    signal: controller.signal,
    /** Register acquired resources immediately on this one callback invocation’s lifetime, at most 128 callbacks.
     * @param {() => void | Promise<void>} dispose - Trusted synchronous/asynchronous owned cleanup; never a source string.
     * @returns {void} Retains cleanup for reverse execution; closed/invalid/full scope rejects.
     */
    onCleanup(dispose: () => void | Promise<void>) {
      if (closed || typeof dispose !== 'function' || cleanup.length >= 128) {
        throw new Error('Invalid or closed test cleanup scope');
      }
      cleanup.push(dispose);
    },
  };
  try {
    await Promise.race([
      Promise.resolve().then(() => fn(context)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          /** Fixed timeout failure tied to this invocation’s public label. */
          const error = new Error(`Test timeout: ${name}`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    closed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    controller.abort();
    /** Private cleanup failures, aggregated without turning failed cleanup into a skip. */
    const errors: unknown[] = [];
    for (const dispose of cleanup.reverse()) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(dispose),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error('Test resource cleanup timeout')),
              timeoutMs
            );
          }),
        ]);
      } catch (error) {
        errors.push(error);
      } finally {
        if (deadline) {
          clearTimeout(deadline);
        }
      }
    }
    if (errors.length) {
      cleanupFailure = new AggregateError(
        [...(failed ? [failure] : []), ...errors],
        'Test or resource cleanup failed'
      );
    }
  }
  if (cleanupFailure) {
    throw cleanupFailure;
  }
  if (failed) {
    throw failure;
  }
}
/** Run an isolated captured test list sequentially with suite hooks, explicit finite retry counts and outcome-preserving cleanup; callbacks remain trusted executable code.
 * @param {TestContext} context - Borrowed registration context; avoid mutation during an active run.
 * @param {RunOptions} options - Explicit matching/focus/bail/deadline/retry and trusted result-observer policy.
 * @returns {Promise<RunSummary>} Actual passed/failed/skipped/unavailable counts and trusted in-process causes; optional throwOnFailure rejects.
 */
export async function executeTests(
  context: TestContext,
  options: RunOptions = {}
): Promise<RunSummary> {
  /** Host-clock run start used only for report duration. */
  const begin = Date.now();
  /** Ordered actual case/hook result receipts for this run. */
  const results: TestResult[] = [];
  /** Captured registration list; callbacks and context remain trusted host-owned values. */
  const tests = [...context.cases];
  /** Whether any runnable focused case controls this run’s selection. */
  const hasOnly = tests.some((test) => test.only && !test.skip);
  if (hasOnly && options.forbidOnly) {
    throw new Error('Focused tests are forbidden by configuration');
  }
  /** Read ordered borrowed suite ancestry for one captured registration.
   * @param {TestCase} test Captured case with registry-local suite identity.
   * @returns {Suite[]} Ordered root-to-leaf suite records. */
  const ancestors = (test: TestCase): Suite[] =>
    [...context.suites.get(test.suiteId)!.ancestors, test.suiteId].map(
      (id) => context.suites.get(id)!
    );
  /** Trusted literal match or already-compiled host RegExp; CLI strings never compile as regex. */
  const match = options.match;
  if (
    match !== undefined &&
    typeof match !== 'string' &&
    !(match instanceof RegExp)
  ) {
    throw new TypeError(
      'Test match must be literal text or an explicit RegExp'
    );
  }
  // Copy an already-compiled host pattern; CLI strings never become patterns.
  // The private copy also preserves frozen/borrowed RegExp ownership.
  /** Private copy of the trusted compiled pattern, preserving borrowed lastIndex ownership. */
  const pattern = match instanceof RegExp ? structuredClone(match) : undefined;
  /** Evaluate only the copied host pattern with legacy global/sticky search semantics.
   * @param {string} name Captured public case label.
   * @returns {boolean} Whether the already-compiled trusted pattern matches. */
  const matchesPattern = (name: string): boolean => {
    if (!pattern) {
      return true;
    }
    if (!pattern.sticky) {
      pattern.lastIndex = 0;
      return pattern.test(name);
    }
    // Historical matching ignored g/y positioning. Search a sticky pattern at
    // every start position without compiling any user-supplied pattern text.
    for (let index = 0; index <= name.length; index++) {
      pattern.lastIndex = index;
      if (pattern.test(name)) {
        return true;
      }
    }
    return false;
  };
  /** Apply declared skip/focus and explicit match policy without executing a callback.
   * @param {TestCase} test Captured test registration.
   * @returns {boolean} Whether the case is eligible for actual execution. */
  const eligible = (test: TestCase) =>
    !test.skip &&
    (!hasOnly || test.only) &&
    (match === undefined ||
      (typeof match === 'string'
        ? test.name.includes(match)
        : matchesPattern(test.name)));
  /** Captured eligible cases used to compute per-suite final cleanup boundaries. */
  const selected = tests.filter(eligible);
  /** Expected eligible descendant counts used to settle afterAll once per started suite. */
  const suiteCount = new Map<number, number>();
  for (const t of selected) {
    for (const suite of ancestors(t)) {
      suiteCount.set(suite.id, (suiteCount.get(suite.id) || 0) + 1);
    }
  }
  /** Suite identifiers whose beforeAll phase was actually entered. */
  const started = new Set<number>();
  /** Suite identifiers whose normal final afterAll phase already ran. */
  const closed = new Set<number>();
  /** Completed eligible descendant count per suite. */
  const finished = new Map<number, number>();
  /** Private setup failures propagated to descendant cases without rerunning beforeAll. */
  const suiteErrors = new Map<number, Error>();
  /** Explicit/default callback observation budget; each hook owns a separate invocation. */
  const timeout = options.timeoutMs ?? 5000;
  /** Validated whole-case retry count; retrying trusted test side effects is an explicit test policy. */
  const retries = options.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 100) {
    throw new RangeError('Invalid retries');
  }
  let bailed = false;
  for (const item of tests) {
    if (bailed || !eligible(item)) {
      /** Actual case or teardown receipt; omitted/filtered cases remain explicit skips. */
      const result: TestResult = {
        name: item.name,
        status: 'skipped',
        reason: (() => {
          if (bailed) {
            return 'bail';
          } else {
            if (item.skip) {
              return 'declared-skip';
            } else {
              return 'filtered';
            }
          }
        })(),
        durationMs: 0,
      };
      results.push(result);
      options.onResult?.(result);
      continue;
    }
    /** Root-to-leaf borrowed suite ancestry for this captured case. */
    const chain = ancestors(item);
    /** Host-clock case start used only for actual report duration. */
    const start = Date.now();
    let failure: Error | undefined;
    let attempts = 0;
    for (const suite of chain) {
      if (started.has(suite.id)) {
        continue;
      }
      started.add(suite.id);
      try {
        for (const hook of suite.beforeAll) {
          await withTimeout(hook, timeout, 'beforeAll');
        }
      } catch (e) {
        suiteErrors.set(suite.id, errorOf(e));
      }
    }
    /** First recorded ancestor setup failure, if present. */
    const setupError = chain.map((s) => suiteErrors.get(s.id)).find(Boolean);
    if (setupError) {
      failure = setupError;
    } else {
      /** Declared per-case attempt count; no retry is inferred from an ambiguous external mutation. */
      const total = (item.retries ?? retries) + 1;
      for (let run = 0; run < total; run++) {
        attempts++;
        failure = undefined;
        /** Suites entered during this attempt so reached afterEach hooks remain owned on failure. */
        const active: Suite[] = [];
        try {
          for (const suite of chain) {
            active.push(suite);
            for (const hook of suite.beforeEach) {
              await withTimeout(hook, timeout, 'beforeEach');
            }
          }
          await withTimeout(item.fn, item.timeoutMs ?? timeout, item.name);
        } catch (e) {
          failure = errorOf(e);
        } finally {
          for (const suite of active.reverse()) {
            for (const hook of suite.afterEach) {
              try {
                await withTimeout(hook, timeout, 'afterEach');
              } catch (e) {
                failure = failure
                  ? new AggregateError(
                      [failure, errorOf(e)],
                      'Test and cleanup failed'
                    )
                  : errorOf(e);
              }
            }
          }
        }
        if (!failure || failureStatus(failure) !== 'failed') {
          break;
        }
      }
    }
    for (const suite of [...chain].reverse()) {
      /** Completed descendant count used to identify the final suite teardown boundary. */
      const done = (finished.get(suite.id) ?? 0) + 1;
      finished.set(suite.id, done);
      if (done === suiteCount.get(suite.id)) {
        closed.add(suite.id);
        for (const hook of suite.afterAll) {
          try {
            await withTimeout(hook, timeout, 'afterAll');
          } catch (e) {
            failure = failure
              ? new AggregateError(
                  [failure, errorOf(e)],
                  'Test and cleanup failed'
                )
              : errorOf(e);
          }
        }
      }
    }
    /** Actual case or teardown receipt; omitted/filtered cases remain explicit skips. */
    const result: TestResult = {
      name: item.name,
      status: failure ? failureStatus(failure) : 'passed',
      environment: 'node',
      durationMs: Date.now() - start,
      attempts,
      ...(failure ? { error: failure } : {}),
    };
    results.push(result);
    options.onResult?.(result);
    if (options.bail && failure && failureStatus(failure) !== 'skipped') {
      bailed = true;
    }
  }
  // On bail, the normal per-suite last-test path is never reached for some
  // already-started suites. Always run their afterAll hooks for resource cleanup.
  for (const suite of [...started]
    .map((id) => context.suites.get(id)!)
    .sort((a, b) => b.ancestors.length - a.ancestors.length)) {
    if (closed.has(suite.id)) {
      continue;
    }
    for (const hook of suite.afterAll) {
      try {
        await withTimeout(hook, timeout, 'afterAll');
      } catch (error) {
        /** Actual case or teardown receipt; omitted/filtered cases remain explicit skips. */
        const result: TestResult = {
          name: `afterAll: ${suite.name}`,
          status: 'failed',
          durationMs: 0,
          error: errorOf(error),
        };
        results.push(result);
        options.onResult?.(result);
      }
    }
  }
  /** Counts derived from actual accumulated outcomes, never fabricated coverage or browser success. */
  const summary: RunSummary = {
    unavailable: results.filter((r) => r.status === 'environment-unavailable')
      .length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    durationMs: Date.now() - begin,
    results,
  };
  if (options.throwOnFailure && (summary.failed || summary.unavailable)) {
    throw new AggregateError(
      results.flatMap((r) => (r.error ? [r.error] : [])),
      `${summary.failed} tests failed, ${summary.unavailable ?? 0} environments unavailable`
    );
  }
  return summary;
}
