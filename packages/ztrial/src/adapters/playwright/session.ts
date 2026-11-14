/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import { lstat, realpath, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentUnavailableError, failureStatus } from '../../results.js';
import {
  normalizeV8Coverage,
  type CoverageRecord,
  type V8SourceCoverage,
} from '../../coverage.js';
import type {
  RunSummary,
  TestResult,
  TestExecutionContext,
} from '../../types/test.js';
import type { PageLike } from './page.js';
/** Explicit native page shape; sessions own fresh pages and only request declared captures/instrumentation. */
export interface BrowserPage extends PageLike {
  /** Close an explicitly owned native page/context/browser resource; borrowed browsers must remain host-owned.
   * @returns {Promise<void>} Actual native-compatible close promise; adapter cleanup separately bounds how long it waits.
   */
  close(): Promise<void>;
  /** Apply the explicit finite session action timeout to the newly owned page.
   * @param {number} ms - Validated native action observation milliseconds.
   * @returns {void} Configures only this page, never a global browser or application.
   */
  setDefaultTimeout(ms: number): void;
  /** Load explicit trusted synthetic fixture markup on the owned page; it can contain executable browser content and is not a sanitizer.
   * @param {string} html - Trusted synthetic test markup, never private repository data sent to a remote provider.
   * @param {{ timeout?: number }} options - Optional bounded native page-content timeout.
   * @returns {Promise<void>} Actual native page content settlement; destination/privacy policy remains with the host.
   */
  setContent(html: string, options?: { timeout?: number }): Promise<void>;
  /** Read the actual owned native page title for a trusted fixture assertion.
   * @returns {Promise<string>} Native document title; not evidence of all-browser compatibility.
   */
  title(): Promise<string>;
  /** Capture only when explicitly requested into the owned fixed-name private artifact namespace.
   * @param {{ path: string; timeout: number }} options - Validated fixed output path and finite native capture timeout.
   * @returns {Promise<unknown>} Actual native capture outcome; screenshot contents need host privacy review.
   */
  screenshot(options: { path: string; timeout: number }): Promise<unknown>;
  /** Optional actual native coverage API or outcome receipts; no instrumentation is invented. */
  coverage?: {
    /** Start explicitly requested native Chromium-compatible JavaScript instrumentation for the selected source inventory.
 * @param {{
      resetOnNavigation?: boolean;
      reportAnonymousScripts?: boolean;
    }} options - Trusted native coverage flags; anonymous/unlisted sources are not counted.
 * @returns {Promise<void>} Native instrumentation startup; unsupported runtimes are reported separately.
 */
    startJSCoverage(options?: {
      resetOnNavigation?: boolean;
      reportAnonymousScripts?: boolean;
    }): Promise<void>;
    /** Read actual native coverage captures after stopping instrumentation on this owned page.
     * @returns {Promise<V8SourceCoverage[]>} Actual runtime source/range records, normalized and bounded before reporting.
     */
    stopJSCoverage(): Promise<V8SourceCoverage[]>;
  };
  /** Read an opt-in native recording handle before page/context cleanup; no recording is inferred from a passing test.
   * @returns {{ saveAs(file: string): Promise<void> } | null} Borrowed recording handle or null; host owns final artifact retention.
   */
  video(): {
    /** Save the explicitly captured video only after its owning context closes, using the adapter’s fixed private filename.
     * @param {string} file - Verified fixed path within this session’s owned capture namespace.
     * @returns {Promise<void>} Actual native recording-save settlement, never fabricated recording bytes.
     */
    saveAs(file: string): Promise<void>;
  } | null;
}
/** Owned per-case native browser context and opt-in tracing; never shared cross-case cookies/session state. */
export interface BrowserContextLike {
  /** Acquire a fresh owned page within this session’s owned context.
   * @returns {Promise<BrowserPage>} Actual native-compatible page; late acquisitions are scheduled for close after cancellation.
   */
  newPage(): Promise<BrowserPage>;
  /** Close an explicitly owned native page/context/browser resource; borrowed browsers must remain host-owned.
   * @returns {Promise<void>} Actual native-compatible close promise; adapter cleanup separately bounds how long it waits.
   */
  close(): Promise<void>;
  /** Borrowed native context trace controls, used only under explicit capture policy. */
  tracing: {
    /** Start explicit native tracing with screenshots/sources disabled by the adapter’s declared capture policy.
 * @param {{
      screenshots: boolean;
      snapshots: boolean;
      sources: boolean;
    }} options - Trusted native trace flags; snapshots may still contain private page content.
 * @returns {Promise<void>} Actual native trace startup, never triggered merely by import.
 */
    start(options: {
      screenshots: boolean;
      snapshots: boolean;
      sources: boolean;
    }): Promise<void>;
    /** Stop explicit tracing and write only its fixed private artifact path.
     * @param {{ path: string }} options - Verified session-owned trace output path.
     * @returns {Promise<void>} Actual native trace-save outcome; capture failures remain failed tests.
     */
    stop(options: { path: string }): Promise<void>;
  };
}
/** Trusted native browser handle; injected browsers remain borrowed while newly launched browsers are owned. */
export interface BrowserLike {
  /** Acquire a fresh native context for this case without reusing cookies/session/cache between cases.
 * @param {{
    acceptDownloads?: boolean;
    recordVideo?: { dir: string };
  }} options - Trusted per-context download/video policy; automatic downloads are disabled.
 * @returns {Promise<BrowserContextLike>} Owned context; borrowing a browser never transfers browser-close ownership.
 */
  newContext(options?: {
    acceptDownloads?: boolean;
    recordVideo?: { dir: string };
  }): Promise<BrowserContextLike>;
  /** Close an explicitly owned native page/context/browser resource; borrowed browsers must remain host-owned.
   * @returns {Promise<void>} Actual native-compatible close promise; adapter cleanup separately bounds how long it waits.
   */
  close(): Promise<void>;
  /** Read actual native browser version for explicit coverage compatibility provenance.
   * @returns {string} Native version label; not a supported-feature certification.
   */
  version(): string;
  /** Read the actual borrowed/owned browser engine identity when available.
   * @returns {{ name(): string }} Native-compatible engine identity; absent metadata requires explicit coverage browserName.
   */
  browserType?(): {
    /** Read actual native engine name for runtime-provenance comparison.
     * @returns {string} Chromium/firefox/webkit-compatible engine label supplied by the trusted native implementation.
     */
    name(): string;
  };
}
/** Explicit trusted optional launcher injection; no dependency or browser binary is installed by this contract. */
export interface PlaywrightDriver {
  /** Explicit trusted Chromium-compatible launcher; no environment loads on import. */
  chromium: {
    /** Explicitly acquire one headless native browser only for a non-skipped case that did not supply a borrowed browser.
 * @param {{
      headless: boolean;
      timeout: number;
    }} options - Trusted headless and finite startup timeout settings.
 * @returns {Promise<BrowserLike>} Owned native browser; dependency/browser installation is never automatic.
 */
    launch(options: {
      headless: boolean;
      timeout: number;
    }): Promise<BrowserLike>;
  };
  /** Optional explicit trusted Firefox-compatible launcher. */
  firefox?: PlaywrightDriver['chromium'];
  /** Optional explicit trusted WebKit-compatible launcher. */
  webkit?: PlaywrightDriver['chromium'];
}
/** One active invocation’s owned page/context plus cooperative signal and reverse cleanup registrar. */
export interface BrowserSession extends TestExecutionContext {
  /** Owned newly acquired session page; native cleanup is attempted before context/browser close. */
  readonly page: BrowserPage;
  /** Owned new per-case browser context, distinct from any borrowed parent browser. */
  readonly context: BrowserContextLike;
}
/** Explicit trusted browser callback; neither schema nor cancellation is a code sandbox. */
export type BrowserTestFunction = (
  session: BrowserSession
) => unknown | Promise<unknown>;
/** One bounded public label and explicitly trusted deferred browser callback, optionally intentionally skipped. */
export interface BrowserCase {
  /** Public case label; exclude credentials and personal traits. */
  name: string;
  /** Explicit trusted executable case callback, never a source string from configuration. */
  run: BrowserTestFunction;
  /** Intentional declaration skip; no environment is acquired for this case. */
  skip?: boolean;
}
/** Explicit per-run native environment/work/cleanup/capture policy; optional features remain inert until execution. */
export interface BrowserOptions {
  /** Explicit engine selection, default Chromium; engine availability remains a separate outcome. */
  browserName?: 'chromium' | 'firefox' | 'webkit';
  /** Borrowed browser: adapter owns only new contexts/pages and never closes this browser. */
  browser?: BrowserLike;
  /** Trusted driver injection; otherwise dynamically import optional playwright. */
  driver?: PlaywrightDriver;
  /** Positive finite per-case observation milliseconds, default5000 and at most600000. */
  timeoutMs?: number;
  /** Positive finite per-cleanup-action observation milliseconds, default1000. */
  cleanupTimeoutMs?: number;
  /** Optional cooperative parent cancellation, linked only for this run/session. */
  signal?: AbortSignal;
  /** Explicit per-run workers from1through8, default1; not a process-global cap. */
  concurrency?: number;
  /** At most128 explicit trusted session setup callbacks. */
  beforeEach?: readonly BrowserTestFunction[];
  /** At most128 explicit trusted session teardown callbacks attempted after reached setup. */
  afterEach?: readonly BrowserTestFunction[];
  /** Explicit capture settings or actual owned artifact references; off by default. */
  artifacts?: {
    /** Explicit existing canonical capture root; host owns access and retention. */
    directory: string;
    /** Explicit screenshot capture opt-in, never inferred from test success. */
    screenshot?: boolean;
    /** Explicit native video capture opt-in; contexts must close before final save. */
    video?: boolean;
    /** Explicit trace capture opt-in; snapshots may contain private page content. */
    trace?: boolean;
  };
  /** Optional actual native coverage API or outcome receipts; no instrumentation is invented. */
  coverage?: {
    /** Explicit bounded source inventory; absent instrumentation is not100%coverage. */
    expectedSources: readonly string[];
  };
}
/** Validate one finite native startup/action/cleanup budget.
 * @param {number} value Explicit/default deadline milliseconds.
 * @param {string} label Fixed nonsecret setting label.
 * @returns {number} Safe integer from1through600000 without coercion. */
const duration = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 600000) {
    throw new RangeError(`Invalid ${label}`);
  }
  return value;
};
/** Validate per-run browser/cleanup/concurrency/capture/coverage policy before acquiring an optional environment; identity and external destinations remain host-owned.
 * @param {BrowserOptions} options - Trusted explicit browser configuration, never imported executable JSON.
 * @returns {void} Rejects unsupported combinations and budgets without loading a browser.
 */
function validate(options: BrowserOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Invalid browser options');
  }
  duration(options.timeoutMs ?? 5000, 'timeoutMs');
  duration(options.cleanupTimeoutMs ?? 1000, 'cleanupTimeoutMs');
  if (
    !Number.isSafeInteger(options.concurrency ?? 1) ||
    (options.concurrency ?? 1) < 1 ||
    (options.concurrency ?? 1) > 8
  ) {
    throw new RangeError('Invalid browser concurrency');
  }
  if (
    options.browserName !== undefined &&
    !['chromium', 'firefox', 'webkit'].includes(options.browserName)
  ) {
    throw new TypeError('Invalid browser name');
  }
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('Invalid browser signal');
  }
  if (
    options.browser !== undefined &&
    (!options.browser || typeof options.browser !== 'object')
  ) {
    throw new TypeError('Invalid borrowed browser');
  }
  if (
    options.driver !== undefined &&
    (!options.driver || typeof options.driver !== 'object')
  ) {
    throw new TypeError('Invalid browser driver');
  }
  if (
    options.artifacts !== undefined &&
    (!options.artifacts ||
      typeof options.artifacts !== 'object' ||
      Array.isArray(options.artifacts))
  ) {
    throw new TypeError('Invalid capture options');
  }
  if (options.browser && options.driver) {
    throw new TypeError('Choose borrowed browser or driver');
  }
  if (
    options.browser &&
    (['newContext', 'close', 'version'] as const).some(
      (key) => typeof options.browser![key] !== 'function'
    )
  ) {
    throw new TypeError('Invalid borrowed browser');
  }
  for (const hooks of [options.beforeEach, options.afterEach]) {
    if (
      hooks !== undefined &&
      (!Array.isArray(hooks) ||
        hooks.length > 128 ||
        hooks.some((hook) => typeof hook !== 'function'))
    ) {
      throw new TypeError('Invalid browser hooks');
    }
  }
  /** Explicit optional artifact policy; no capture starts if all flags are off. */
  const capture = options.artifacts;
  if (capture) {
    if (
      typeof capture.directory !== 'string' ||
      !capture.directory ||
      capture.directory.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(capture.directory) ||
      capture.directory.split(/[\\/]/).includes('..')
    ) {
      throw new TypeError('Invalid artifact directory');
    }
    for (const flag of ['screenshot', 'video', 'trace'] as const) {
      if (capture[flag] !== undefined && typeof capture[flag] !== 'boolean') {
        throw new TypeError('Invalid capture option');
      }
    }
  }
  if (options.coverage && !options.coverage.expectedSources?.length) {
    throw new TypeError('Coverage requires expected sources');
  }
  if (
    options.browser &&
    options.coverage &&
    !options.browserName &&
    typeof options.browser.browserType !== 'function'
  ) {
    throw new TypeError(
      'Borrowed browser coverage requires an explicit browserName'
    );
  }
  if (options.coverage) {
    normalizeV8Coverage([], {
      runtime: 'validation',
      expectedSources: options.coverage.expectedSources,
    });
  }
}
/** Detach mutable hook/capture/expected-source lists while preserving explicitly borrowed browser/driver ownership.
 * @param {BrowserOptions} options - Validated trusted per-run configuration.
 * @returns {BrowserOptions} Shallow configuration/list snapshot, never an owned clone of browser/driver objects.
 */
function snapshot(options: BrowserOptions): BrowserOptions {
  return {
    ...options,
    ...(options.beforeEach && { beforeEach: [...options.beforeEach] }),
    ...(options.afterEach && { afterEach: [...options.afterEach] }),
    ...(options.artifacts && { artifacts: { ...options.artifacts } }),
    ...(options.coverage && {
      coverage: { expectedSources: [...options.coverage.expectedSources] },
    }),
  };
}
/** Verify an explicit existing canonical real artifact directory only when capture was requested; never infer capture from merely importing the package.
 * @param {BrowserOptions} options - Validated explicit capture policy.
 * @returns {Promise<string | undefined>} Verified owned capture root or undefined; host owns artifact access, review and retention.
 */
async function artifactRoot(
  options: BrowserOptions
): Promise<string | undefined> {
  /** Explicit optional artifact policy; no capture starts if all flags are off. */
  const capture = options.artifacts;
  if (!capture || !(capture.screenshot || capture.trace || capture.video)) {
    return undefined;
  }
  /** Verified existing capture root, or undefined when capture is disabled. */
  const root = path.resolve(capture.directory);
  /** Native capture-root metadata requiring a canonical real directory. */
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(root)) !== root
  ) {
    throw new TypeError(
      'Artifact directory must exist without symlink components'
    );
  }
  return root;
}
/** Private actual session receipt; cleanup failures preserve honest terminal outcomes. */
interface Outcome {
  /** Actual trusted callback return value, retained only in the in-process outcome. */
  value?: unknown;
  /** Private native/host failure cause; never default public telemetry. */
  error?: Error;
  /** Optional actual native coverage API or outcome receipts; no instrumentation is invented. */
  coverage: CoverageRecord[];
  /** Explicit capture settings or actual owned artifact references; off by default. */
  artifacts: NonNullable<TestResult['artifacts']>;
  /** Explicit timeout/cancelled coverage label. */
  reason?: string;
  /** Whether any bounded cleanup action failed; such failures override skipped/unavailable classification. */
  cleanupFailed?: boolean;
}
/** Normalize private trusted native failures without publishing their content.
 * @param {unknown} error Unknown native/host failure.
 * @returns {Error} Original native Error or a text-normalized private cause. */
const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));
/** Run one explicit trusted browser callback with owned page/context and optional owned browser; capture is opt-in, cleanup bounded and late acquisitions scheduled for release.
 * @param {BrowserOptions} options - Detached validated browser policy; injected native implementations remain trusted.
 * @param {BrowserTestFunction} run - Trusted session callback; cancellation cannot force arbitrary JavaScript to stop.
 * @param {string} root - Optional verified explicit capture root.
 * @returns {Promise<Outcome>} Actual value/coverage/artifact/failure receipt; cleanup failures never become green skips.
 */
async function execute(
  options: BrowserOptions,
  run: BrowserTestFunction,
  root?: string
): Promise<Outcome> {
  /** Owned cooperative session signal; abort is not forced JavaScript termination. */
  const controller = new AbortController();
  /** Propagate only this parent lifetime’s cancellation into the owned session/link scope.
   * @returns {void} Requests cooperative cancellation without closing borrowed browsers directly. */
  const abort = () =>
    controller.abort(
      options.signal?.reason ?? new Error('Browser test cancelled')
    );
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) {
    abort();
  }
  /** Validated/default native case observation budget. */
  const timeout = options.timeoutMs ?? 5000;
  /** Validated/default independent per-cleanup-action observation budget. */
  const cleanupTimeout = options.cleanupTimeoutMs ?? 1000;
  let timedOut = false;
  /** Owned finite session timeout, always cleared after the callback phase. */
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Browser test deadline exceeded'));
  }, timeout);
  /** Private bounded-cleanup failures aggregated without suppressing later cleanup actions. */
  const cleanupErrors: Error[] = [];
  let browser: BrowserLike | undefined,
    context: BrowserContextLike | undefined,
    page: BrowserPage | undefined;
  let active = false,
    tracing = false,
    covering = false,
    directory: string | undefined,
    runtime = 'browser-unknown';
  let browserName = options.browserName ?? 'chromium';
  let value: unknown, failure: Error | undefined;
  let session: BrowserSession | undefined;
  /** At most128 explicit session-owned cleanup handles, attempted once in reverse order. */
  const callbacks: (() => void | Promise<void>)[] = [];
  /** Actual normalized coverage receipts or explicit missing/unsupported coverage. */
  const coverage: CoverageRecord[] = [];
  /** Actual fixed relative artifact references, never embedded recordings or source files. */
  const artifacts: { type: 'screenshot' | 'trace' | 'video'; path: string }[] =
    [];
  /** Observed cooperative session rejection racing trusted native/callback work. */
  const cancelled = new Promise<never>((_, reject) => {
    /** Reject only this owned session wait with its private cancellation cause.
     * @returns {void} Reports cancellation; noncooperative underlying work may still settle. */
    const rejectAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) {
      rejectAbort();
    } else {
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    }
  });
  void cancelled.catch(() => {});
  /** Attempt one owned native/resource cleanup under its independent finite observation budget, retaining failures while allowing later actions.
   * @param {() => unknown | Promise<unknown>} action - Trusted cleanup action for a resource this session owns.
   * @returns {Promise<void>} Bounded observation settlement; noncooperative action may continue afterward.
   */
  async function cleanup(action: () => unknown | Promise<unknown>) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(action),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Browser cleanup deadline exceeded')),
            cleanupTimeout
          );
        }),
      ]);
    } catch (error) {
      cleanupErrors.push(asError(error));
    } finally {
      if (deadline) {
        clearTimeout(deadline);
      }
    }
  }
  /** Retain ownership of a pending native acquisition and schedule late resources for release after observed cancellation.
   * @param {Promise<T>} pending Explicit trusted native resource acquisition.
   * @param {(resource: T) => Promise<void>} release Cleanup for only the newly owned acquired resource.
   * @returns {Promise<T>} Acquired resource or cancellation; late cleanup is best-effort bounded observation. */
  const acquire = async <T>(
    pending: Promise<T>,
    release: (resource: T) => Promise<void>
  ): Promise<T> => {
    /** Actual native acquisition transformed to preserve cleanup if cancellation wins its race. */
    const owned = pending.then((resource) => {
      if (controller.signal.aborted) {
        void cleanup(() => release(resource));
        throw controller.signal.reason;
      }
      return resource;
    });
    return Promise.race([owned, cancelled]);
  };
  /** Await explicit trusted native/callback work against session cancellation without claiming forced rollback.
   * @param {Promise<T>} pending Trusted native/callback operation.
   * @returns {Promise<T>} Observed result or explicit session cancellation. */
  const stage = <T>(pending: Promise<T>): Promise<T> =>
    Promise.race([pending, cancelled]);
  try {
    controller.signal.throwIfAborted();
    if (options.browser) {
      browser = options.browser;
    } else {
      let driver = options.driver;
      if (!driver) {
        try {
          /** Fixed optional Playwright module name loaded only on explicit non-skipped execution. */
          const specifier = 'playwright';
          driver = (await stage(
            import(specifier)
          )) as unknown as PlaywrightDriver;
        } catch (error) {
          if (controller.signal.aborted) {
            throw error;
          }
          throw new EnvironmentUnavailableError('playwright', error);
        }
      }
      /** Explicit supported native launcher selected from the trusted injected/optional driver. */
      const launcher = driver[options.browserName ?? 'chromium'];
      if (!launcher || typeof launcher.launch !== 'function') {
        throw new EnvironmentUnavailableError('browser-launcher');
      }
      try {
        browser = await acquire(
          launcher.launch({ headless: true, timeout }),
          (resource) => resource.close()
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw error;
        }
        throw new EnvironmentUnavailableError('browser-launch', error);
      }
    }
    /** Actual native engine name checked against any explicitly declared browserName. */
    const actual = browser.browserType?.().name();
    if (actual) {
      if (options.browserName && actual !== options.browserName) {
        throw new TypeError(
          'Browser type does not match configured browserName'
        );
      }
      browserName = actual as typeof browserName;
    }
    runtime = `${browserName}:${browser.version()}`;
    if (root) {
      directory = await stage(mkdtemp(path.join(root, 'ztrial-')));
    }
    context = await acquire(
      browser.newContext({
        acceptDownloads: false,
        ...(options.artifacts?.video && directory
          ? { recordVideo: { dir: directory } }
          : {}),
      }),
      (resource) => resource.close()
    );
    page = await acquire(context.newPage(), (resource) => resource.close());
    page.setDefaultTimeout(timeout);
    session = {
      page,
      context,
      signal: controller.signal,
      /** Register one explicitly acquired session resource immediately, at most128 callbacks while the session is active.
       * @param {() => void | Promise<void>} dispose - Trusted owned cleanup callback; no source string is interpreted.
       * @returns {void} Retains reverse cleanup ownership; closed/late/invalid registrations reject.
       */
      onCleanup(dispose) {
        if (
          !active ||
          typeof dispose !== 'function' ||
          callbacks.length >= 128
        ) {
          throw new Error('Invalid or closed browser cleanup scope');
        }
        callbacks.push(dispose);
      },
    };
    if (options.artifacts?.trace && directory) {
      await stage(
        context.tracing.start({
          screenshots: false,
          snapshots: true,
          sources: false,
        })
      );
      tracing = true;
    }
    if (options.coverage) {
      if (browserName === 'chromium' && page.coverage) {
        await stage(
          page.coverage.startJSCoverage({
            resetOnNavigation: true,
            reportAnonymousScripts: false,
          })
        );
        covering = true;
      } else {
        coverage.push(
          ...normalizeV8Coverage([], {
            runtime,
            expectedSources: options.coverage.expectedSources,
            unsupported: true,
          })
        );
      }
    }
    active = true;
    for (const hook of options.beforeEach ?? []) {
      await stage(Promise.resolve().then(() => hook(session!)));
    }
    value = await stage(Promise.resolve().then(() => run(session!)));
  } catch (error) {
    failure = asError(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (session && active) {
      for (const hook of options.afterEach ?? []) {
        await cleanup(() => hook(session!));
      }
    }
    if (covering && page?.coverage) {
      await cleanup(async () =>
        coverage.push(
          ...normalizeV8Coverage(await page!.coverage!.stopJSCoverage(), {
            runtime,
            expectedSources: options.coverage!.expectedSources,
          })
        )
      );
    }
    if (options.coverage && !coverage.length) {
      coverage.push(
        ...normalizeV8Coverage([], {
          runtime,
          expectedSources: options.coverage.expectedSources,
        })
      );
    }
    /** Derive one fixed internal capture filename within this session’s owned artifact directory.
     * @param {string} filename Fixed internal screenshot/trace/video filename.
     * @returns {string} Owned native artifact path; never a public test label. */
    const output = (filename: string) => path.join(directory!, filename);
    /** Retain a native capture reference only after its save operation succeeds.
     * @param {"screenshot" | "trace" | "video"} type Fixed explicit capture kind.
     * @param {string} file Fixed successfully written owned artifact path.
     * @returns {number} Current retained artifact reference count. */
    const record = (type: 'screenshot' | 'trace' | 'video', file: string) =>
      artifacts.push({
        type,
        path: path.relative(root!, file).split(path.sep).join('/'),
      });
    if (directory && page && options.artifacts?.screenshot) {
      await cleanup(async () => {
        /** Fixed owned screenshot/trace/video output path, never a client-supplied filename. */
        const file = output('page.png');
        await page!.screenshot({ path: file, timeout: cleanupTimeout });
        record('screenshot', file);
      });
    }
    if (directory && context && tracing) {
      await cleanup(async () => {
        /** Fixed owned screenshot/trace/video output path, never a client-supplied filename. */
        const file = output('trace.zip');
        await context!.tracing.stop({ path: file });
        record('trace', file);
      });
    }
    active = false;
    controller.abort();
    for (const callback of callbacks.reverse()) {
      await cleanup(callback);
    }
    let video: ReturnType<BrowserPage['video']> = null;
    if (options.artifacts?.video && page) {
      await cleanup(() => {
        video = page!.video();
      });
    }
    if (page) {
      await cleanup(() => page!.close());
    }
    if (context) {
      await cleanup(() => context!.close());
    }
    if (directory && video) {
      await cleanup(async () => {
        /** Fixed owned screenshot/trace/video output path, never a client-supplied filename. */
        const file = output('video.webm');
        await video!.saveAs(file);
        record('video', file);
      });
    }
    if (browser && !options.browser) {
      await cleanup(() => browser!.close());
    }
    if (cleanupErrors.length) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        'Browser test or cleanup failed'
      );
    }
  }
  return {
    value,
    cleanupFailed: cleanupErrors.length > 0,
    ...(failure && { error: failure }),
    coverage,
    artifacts,
    ...(() => {
      if (timedOut) {
        return { reason: 'timeout' };
      } else {
        if (options.signal?.aborted) {
          return { reason: 'cancelled' };
        } else {
          return {};
        }
      }
    })(),
  };
}
/** Execute one explicit scoped browser callback, link optional existing test cancellation and preserve capture/cleanup failures without acquiring an application server.
 * @param {BrowserOptions} options - Trusted explicit native environment/capture/work policy.
 * @param {(session: BrowserSession) => T | Promise<T>} run - Trusted session callback whose result is returned only after session cleanup.
 * @param {TestExecutionContext} scope - Optional borrowed runner invocation context for linked cancellation and awaiting scoped cleanup.
 * @returns {Promise<{ value: T; coverage: CoverageRecord[]; artifacts: NonNullable<TestResult["artifacts"]> }>} Actual callback value/provenance references or explicit failure; raw causes stay host-private.
 */
export async function withBrowser<T>(
  options: BrowserOptions,
  run: (session: BrowserSession) => T | Promise<T>,
  scope?: TestExecutionContext
): Promise<{
  /** Actual trusted callback return value, retained only in the in-process outcome. */
  value: T;
  /** Optional actual native coverage API or outcome receipts; no instrumentation is invented. */
  coverage: CoverageRecord[];
  /** Explicit capture settings or actual owned artifact references; off by default. */
  artifacts: NonNullable<TestResult['artifacts']>;
}> {
  validate(options);
  options = snapshot(options);
  if (
    scope &&
    (!(scope.signal instanceof AbortSignal) ||
      typeof scope.onCleanup !== 'function')
  ) {
    throw new TypeError('Invalid browser test scope');
  }
  if (typeof run !== 'function') {
    throw new TypeError('Browser callback is required');
  }
  /** Owned linked cancellation controller borrowing only the declared parent signals. */
  const linked = new AbortController();
  /** Explicit parent/run cancellation signals; unrelated tests remain independent. */
  const signals = [options.signal, scope?.signal].filter(
    (signal): signal is AbortSignal => !!signal
  );
  /** Owned signal listener removers, invoked in finally after the scoped adapter settles. */
  const unlink: (() => void)[] = [];
  for (const signal of signals) {
    /** Propagate only this parent lifetime’s cancellation into the owned session/link scope.
     * @returns {void} Requests cooperative cancellation without closing borrowed browsers directly. */
    const abort = () => linked.abort(signal.reason);
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
      unlink.push(() => signal.removeEventListener('abort', abort));
    }
  }
  let pending: Promise<Outcome> | undefined;
  let delivered = false;
  try {
    scope?.onCleanup(async () => {
      linked.abort();
      if (pending && !delivered) {
        /** Actual private session outcome; errors remain explicit rather than becoming passing captures. */
        const result = await pending;
        if (result.cleanupFailed) {
          throw result.error;
        }
      }
    });
    /** Verified existing capture root, or undefined when capture is disabled. */
    const root = await artifactRoot(options);
    pending = execute({ ...options, signal: linked.signal }, run, root);
    /** Actual private session outcome; errors remain explicit rather than becoming passing captures. */
    const result = await pending;
    delivered = true;
    if (result.error) {
      throw result.error;
    }
    return {
      value: result.value as T,
      coverage: result.coverage,
      artifacts: result.artifacts,
    };
  } finally {
    for (const remove of unlink) {
      remove();
    }
  }
}
/** Execute a bounded captured case list using explicit per-run worker concurrency while preserving registration order and unavailable-versus-skipped outcomes.
 * @param {readonly BrowserCase[]} cases - At most1000 explicit trusted case callbacks; intentional skips acquire no optional browser.
 * @param {BrowserOptions} options - Trusted finite per-run work/capture/cleanup policy, default opt-in environment execution.
 * @returns {Promise<RunSummary>} Actual browser outcomes; missing optional environments are unavailable, not passing skips.
 */
export async function runBrowserTests(
  cases: readonly BrowserCase[],
  options: BrowserOptions = {}
): Promise<RunSummary> {
  validate(options);
  options = snapshot(options);
  if (
    !Array.isArray(cases) ||
    cases.length > 1000 ||
    cases.some(
      (item) =>
        !item ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        item.name.length > 2048 ||
        typeof item.run !== 'function' ||
        (item.skip !== undefined && typeof item.skip !== 'boolean')
    )
  ) {
    throw new TypeError('Invalid browser cases');
  }
  cases = cases.map((item) => ({ ...item }));
  /** Verified existing capture root, or undefined when capture is disabled. */
  const root = await artifactRoot(options);
  /** Host-clock run start used only for actual observed duration. */
  const begin = Date.now();
  /** Preallocated ordered outcome slots, filled only by actual case workers. */
  const results: TestResult[] = new Array(cases.length);
  let cursor = 0;
  /** Claim one captured case index at a time and retain its actual session outcome in registration order.
   * @returns {Promise<void>} Actual worker settlement; concurrency is bounded per run rather than globally.
   */
  async function worker() {
    while (cursor < cases.length) {
      /** Claimed registry-local case index preserving result order under bounded concurrency. */
      const index = cursor++;
      /** Captured case registration or absent slot, checked before execution. */
      const item = cases[index];
      if (!item) {
        continue;
      }
      /** Host-clock case start used only for observed duration. */
      const start = Date.now();
      if (item.skip) {
        results[index] = {
          name: item.name,
          status: 'skipped',
          reason: 'declared-skip',
          environment: 'browser',
          durationMs: 0,
        };
        continue;
      }
      /** Actual single-session receipt, including explicit unavailable/failure/cleanup coverage. */
      const outcome = await execute(options, item.run, root);
      results[index] = {
        name: item.name,
        status: outcome.error ? failureStatus(outcome.error) : 'passed',
        environment: 'browser',
        durationMs: Date.now() - start,
        ...(outcome.error && { error: outcome.error }),
        reason: outcome.reason,
        ...(options.coverage && { coverage: outcome.coverage }),
        artifacts: outcome.artifacts,
      };
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency ?? 1, cases.length) },
      worker
    )
  );
  return {
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    unavailable: results.filter(
      (result) => result.status === 'environment-unavailable'
    ).length,
    durationMs: Date.now() - begin,
    results,
  };
}
/** Create an inert private browser-case registry; no optional environment, application, network navigation or artifact capture starts until runTests.
 * @param {BrowserOptions} options - Trusted validated per-run settings whose lists are detached at construction.
 * @returns {object} Explicit test/skip/run/clear API; each actual run independently owns session cleanup.
 */
export function createBrowserRunner(options: BrowserOptions = {}) {
  validate(options);
  options = snapshot(options);
  /** Private inert case registrations; no page/environment is acquired until explicit run. */
  const cases: BrowserCase[] = [];
  /** Register one explicit trusted bounded browser case without executing it or loading optional environments.
   * @param {string} name Public bounded case label, excluding private values.
   * @param {BrowserTestFunction} run Trusted deferred session callback.
   * @param {boolean} skip Explicit intentional skip flag.
   * @returns {void} Adds one registration or rejects invalid/full private state. */
  const add = (name: string, run: BrowserTestFunction, skip = false) => {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 2048 ||
      typeof run !== 'function' ||
      cases.length >= 1000
    ) {
      throw new TypeError('Invalid browser case');
    }
    cases.push({ name, run, skip });
  };
  return {
    test: (name: string, run: BrowserTestFunction) => add(name, run),
    skip: (name: string, run: BrowserTestFunction = () => {}) =>
      add(name, run, true),
    runTests: () => runBrowserTests([...cases], options),
    clearTests: () => {
      cases.length = 0;
    },
  };
}
