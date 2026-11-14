import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createRunner,
  EnvironmentUnavailableError,
  skipTest,
  normalizeResults,
  normalizeV8Coverage,
  mergeCoverage,
  summarizeCoverage,
} from 'ztrial';
import {
  createBrowserRunner,
  runBrowserTests,
  withBrowser,
  runE2E,
  visit,
  click,
} from 'ztrial/playwright';
import { formatSummary } from '../dist/utils/logger.js';

/**
 * Create a deterministic trusted native browser double; no real browser, application or capture encoder runs.
 * @param {object} options Explicit synthetic acquisition/cleanup/delay failures.
 * @param {Error | undefined} options.launchError Optional fixed native-launch failure.
 * @param {Error | undefined} options.hookError Existing compatibility field ignored by this double.
 * @param {Error | undefined} options.pageCloseError Optional fixed page-close failure.
 * @param {number} options.late Synthetic delayed launch milliseconds, default zero.
 * @returns {object} Independent counters, borrowed browser and explicit trusted driver injection.
 */
function driver({
  launchError,
  hookError: _hookError,
  pageCloseError,
  late = 0,
} = {}) {
  /** Synthetic driver acquisition/cleanup/capture counters; they are not live browser measurements. */
  const counts = {
    launches: 0,
    browsers: 0,
    contexts: 0,
    pages: 0,
    active: 0,
    peak: 0,
    screenshots: 0,
    traces: 0,
    videos: 0,
  };
  /** Synthetic page handles retained only for ownership assertions. */
  const created = [];
  /** Create one deterministic native-compatible browser double without launching any actual browser.
   * @returns {object} Synthetic browser/context/page methods recording only fixture-owned effects. */
  const makeBrowser = () => ({
    version: () => 'test-driver-1',
    close: async () => {
      counts.browsers++;
    },
    newContext: async (options) => {
      counts.active++;
      counts.peak = Math.max(counts.peak, counts.active);
      let page;
      /** Synthetic per-case native context double; capture methods write fixed marker bytes, not real recordings. */
      const context = {
        close: async () => {
          counts.contexts++;
          counts.active--;
        },
        tracing: {
          start: async () => {},
          stop: async ({ path }) => {
            counts.traces++;
            await writeFile(path, 'trace');
          },
        },
        newPage: async () => {
          page = {
            goto: async () => {},
            locator: () => ({ count: async () => 1, click: async () => {} }),
            setContent: async () => {},
            title: async () => 'fixture',
            setDefaultTimeout: () => {},
            close: async () => {
              counts.pages++;
              if (pageCloseError) {
                throw pageCloseError;
              }
            },
            screenshot: async ({ path }) => {
              counts.screenshots++;
              await writeFile(path, 'image');
            },
            video: () =>
              options.recordVideo
                ? {
                    saveAs: async (file) => {
                      counts.videos++;
                      await writeFile(file, 'video');
                    },
                  }
                : null,
            coverage: {
              startJSCoverage: async () => {},
              stopJSCoverage: async () => [
                {
                  url: 'https://test.invalid/app.js',
                  source: 'abc',
                  functions: [
                    {
                      isBlockCoverage: true,
                      ranges: [{ startOffset: 0, endOffset: 3, count: 1 }],
                    },
                  ],
                },
              ],
            },
          };
          created.push(page);
          return page;
        },
      };
      return context;
    },
  });
  return {
    counts,
    created,
    browser: makeBrowser(),
    driver: {
      chromium: {
        launch: async () => {
          counts.launches++;
          if (launchError) {
            throw launchError;
          }
          if (late) {
            await new Promise((resolve) => setTimeout(resolve, late));
          }
          return makeBrowser();
        },
      },
    },
  };
}

test('owned browser resources close after hook/test failure; skips never allocate a browser', async () => {
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  /** Observed synthetic lifecycle callback order. */
  const hooks = [];
  /** Actual adapter/runner outcome over deterministic doubles; no real browser certification is inferred. */
  const result = await runBrowserTests(
    [
      {
        name: 'normal',
        run: async ({ page }) => {
          await visit(page, 'https://test.invalid');
          await click(page, 'button');
          await runE2E(page, [async () => {}]);
        },
      },
      {
        name: 'failing',
        run: () => {
          throw Error('assertion failed');
        },
      },
      { name: 'skip', skip: true, run: () => assert.fail('not run') },
    ],
    {
      driver: fixture.driver,
      afterEach: [
        () => {
          hooks.push('after');
        },
      ],
    }
  );
  assert.deepEqual(
    [result.passed, result.failed, result.skipped, result.unavailable],
    [1, 1, 1, 0]
  );
  assert.equal(fixture.counts.pages, 2);
  assert.equal(fixture.counts.contexts, 2);
  assert.equal(fixture.counts.browsers, 2);
  assert.deepEqual(hooks, ['after', 'after']);
  /** Injected deterministic driver/setup failure fixture. */
  const failure = driver();
  /** Actual setup-failure result proving reached cleanup still executes. */
  const hook = await runBrowserTests(
    [{ name: 'setup fails', run: () => assert.fail('not run') }],
    {
      driver: failure.driver,
      beforeEach: [
        () => {
          throw Error('hook failed');
        },
      ],
      afterEach: [() => hooks.push('cleanup')],
    }
  );
  assert.equal(hook.failed, 1);
  assert.equal(failure.counts.contexts, 1);
  assert.equal(failure.counts.browsers, 1);
  assert.equal(hooks.at(-1), 'cleanup');
});

test('parallel bounds and independent runner registries preserve result order', async () => {
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  /** First independent inert runner or normalized synthetic capture receipt, according to the local test. */
  const first = createBrowserRunner({ driver: fixture.driver, concurrency: 2 });
  /** Second independent inert browser registry whose intentional skip must allocate no environment. */
  const second = createBrowserRunner({ driver: fixture.driver });
  for (let index = 0; index < 5; index++) {
    first.test(
      'case ' + index,
      () => new Promise((resolve) => setTimeout(resolve, 3))
    );
  }
  second.skip('unrelated');
  /** Actual concurrent isolated runner receipts checked for deterministic order and configured worker bounds. */
  const [a, b] = await Promise.all([first.runTests(), second.runTests()]);
  assert.equal(a.passed, 5);
  assert.equal(b.skipped, 1);
  assert.ok(fixture.counts.peak <= 2);
  assert.deepEqual(
    a.results.map((result) => result.name),
    ['case 0', 'case 1', 'case 2', 'case 3', 'case 4']
  );
});

test('borrowed browser stays open; timeout, cancellation and late launch release owned sessions', async () => {
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  /** Actual injected borrowed-browser run proving the host browser is not closed. */
  const borrowed = await runBrowserTests([{ name: 'borrow', run: () => {} }], {
    browser: fixture.browser,
  });
  assert.equal(borrowed.passed, 1);
  assert.equal(fixture.counts.browsers, 0);
  assert.equal(fixture.counts.contexts, 1);
  /** Separate deterministic driver double for callback timeout cleanup. */
  const timed = driver();
  /** Actual adapter/runner outcome over deterministic doubles; no real browser certification is inferred. */
  const result = await runBrowserTests(
    [{ name: 'pending', run: () => new Promise(() => {}) }],
    { driver: timed.driver, timeoutMs: 10 }
  );
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].reason, 'timeout');
  assert.equal(timed.counts.pages, 1);
  assert.equal(timed.counts.browsers, 1);
  /** Owned fixture cancellation controller, never a global browser shutdown signal. */
  const controller = new AbortController();
  controller.abort();
  /** Actual adapter receipt after explicit fixture cancellation. */
  const cancelled = await runBrowserTests(
    [{ name: 'cancelled', run: () => {} }],
    { driver: fixture.driver, signal: controller.signal }
  );
  assert.equal(cancelled.failed, 1);
  assert.equal(cancelled.results[0].reason, 'cancelled');
  /** Injected delayed native-acquisition double proving late resources retain cleanup ownership. */
  const late = driver({ late: 25 });
  /** Actual timed-out launch receipt, not proof the delayed native promise stopped. */
  const deadline = await runBrowserTests(
    [{ name: 'late launch', run: () => {} }],
    { driver: late.driver, timeoutMs: 5 }
  );
  assert.equal(deadline.failed, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(late.counts.browsers, 1);
});

test('environment unavailable is not a failed assertion or intentional skip in backend/reporters', async () => {
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver({
    launchError: new Error('browser executable unavailable'),
  });
  /** Actual injected unavailable-launch outcome, distinct from intentional skip. */
  const frontend = await runBrowserTests(
    [{ name: 'unavailable', run: () => {} }],
    { driver: fixture.driver }
  );
  assert.equal(frontend.unavailable, 1);
  assert.equal(frontend.failed, 0);
  assert.equal(frontend.skipped, 0);
  assert.equal(
    frontend.results[0].error.cause.message,
    'browser executable unavailable'
  );
  /** Independent inert backend runner using only synthetic callback failures. */
  const runner = createRunner();
  runner.test('optional environment', () => {
    throw new EnvironmentUnavailableError('browser');
  });
  runner.test('explicit skip', () => skipTest('intentional'));
  runner.test('ordinary failure', () => {
    throw Error('failure');
  });
  /** Independent backend runner or actual synthetic outcome checked for honest unavailable/cleanup status. */
  const backend = await runner.runTests();
  assert.deepEqual(
    [backend.unavailable, backend.skipped, backend.failed],
    [1, 1, 1]
  );
  assert.match(
    formatSummary(backend, 'tap'),
    /not ok 1.*environment-unavailable/
  );
  assert.match(formatSummary(backend, 'tap'), /ok 2.*SKIP/);
  assert.equal(normalizeResults(backend)[0].status, 'environment-unavailable');
});

test('withBrowser integrates runner cancellation/cleanup and cleanup errors cannot become skips', async () => {
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  /** Independent inert backend runner using only synthetic callback failures. */
  const runner = createRunner();
  runner.test('browser pending', (context) =>
    withBrowser(
      { driver: fixture.driver, timeoutMs: 1000 },
      () => new Promise(() => {}),
      context
    )
  );
  /** Actual scoped runner receipt after linked browser callback cancellation. */
  const summary = await runner.runTests({ timeoutMs: 15 });
  assert.equal(summary.failed, 1);
  assert.equal(fixture.counts.contexts, 1);
  assert.equal(fixture.counts.browsers, 1);
  /** Injected native page-close failure fixture; teardown must still attempt later resources. */
  const failed = driver({ pageCloseError: Error('page close failed') });
  /** Actual adapter/runner outcome over deterministic doubles; no real browser certification is inferred. */
  const result = await runBrowserTests(
    [{ name: 'cleanup', run: () => skipTest('intentional') }],
    { driver: failed.driver }
  );
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 0);
  assert.equal(failed.counts.contexts, 1);
  assert.equal(failed.counts.browsers, 1);
  /** Independent backend runner or actual synthetic outcome checked for honest unavailable/cleanup status. */
  const backend = createRunner();
  backend.test('skip then failed teardown', () => skipTest('skip'));
  backend.afterEach(() => {
    throw Error('teardown failed');
  });
  assert.equal((await backend.runTests()).failed, 1);
});

test('captures are opt-in with private generated paths and no test-name interpolation', async () => {
  /** Owned temporary capture/config fixture namespace removed in finally. */
  const root = await mkdtemp(join(tmpdir(), 'ztrial-artifacts-'));
  try {
    /** Injected driver proving no captures occur without explicit flags. */
    const none = driver();
    await runBrowserTests([{ name: '../../unsafe', run: () => {} }], {
      driver: none.driver,
    });
    assert.equal(
      none.counts.screenshots + none.counts.traces + none.counts.videos,
      0
    );
    assert.deepEqual(await readdir(root), []);
    /** Independent injected browser driver double; no Playwright or application starts. */
    const fixture = driver();
    /** Actual adapter/runner outcome over deterministic doubles; no real browser certification is inferred. */
    const result = await runBrowserTests(
      [{ name: '../../unsafe', run: () => {} }],
      {
        driver: fixture.driver,
        artifacts: {
          directory: root,
          screenshot: true,
          trace: true,
          video: true,
        },
      }
    );
    assert.equal(result.passed, 1);
    assert.equal(result.results[0].artifacts.length, 3);
    for (const artifact of result.results[0].artifacts) {
      assert.ok(!artifact.path.includes('..'));
      assert.ok(!artifact.path.startsWith('/'));
      assert.ok((await readFile(join(root, artifact.path))).length > 0);
    }
    await assert.rejects(
      runBrowserTests([], {
        artifacts: { directory: root + '/../escape', trace: true },
      }),
      /artifact/
    );
    /** Owned temporary symlink used only to prove unsafe capture-root rejection. */
    const link = root + '-link';
    await symlink(root, link, 'dir');
    try {
      await assert.rejects(
        runBrowserTests([], { artifacts: { directory: link, trace: true } }),
        /symlink/
      );
    } finally {
      await rm(link, { force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('coverage reports missing/unsupported instrumentation and merges only compatible captures', async () => {
  /** Fixed explicit synthetic V8 source/range record, not actual application instrumentation. */
  const input = [
    {
      url: 'file:///app.js',
      source: 'abc',
      functions: [
        {
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: 3, count: 1 }],
        },
      ],
    },
  ];
  /** First independent inert runner or normalized synthetic capture receipt, according to the local test. */
  const first = normalizeV8Coverage(input, {
    runtime: 'node:test-version',
    expectedSources: ['file:///app.js', 'file:///missing.js'],
  });
  assert.equal(first[1].status, 'uninstrumented');
  assert.equal(summarizeCoverage(first).uninstrumentedSources, 1);
  /** Actual normalized/merged synthetic native counters checked only for compatibility semantics. */
  const merged = mergeCoverage([...first, ...first]);
  assert.equal(merged[0].ranges[0].count, 2);
  assert.throws(
    () => mergeCoverage([first[0], { ...first[0], runtime: 'chromium:other' }]),
    /Incompatible/
  );
  assert.throws(
    () =>
      mergeCoverage([first[0], { ...first[0], sourceHash: 'a'.repeat(64) }]),
    /Incompatible/
  );
  assert.throws(
    () =>
      normalizeV8Coverage(
        [
          {
            ...input[0],
            functions: [
              {
                isBlockCoverage: true,
                ranges: [{ startOffset: 0, endOffset: 4, count: 1 }],
              },
            ],
          },
        ],
        { runtime: 'node:test', expectedSources: ['file:///app.js'] }
      ),
    /range/
  );
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  /** Actual adapter/runner outcome over deterministic doubles; no real browser certification is inferred. */
  const result = await runBrowserTests([{ name: 'coverage', run: () => {} }], {
    driver: fixture.driver,
    coverage: {
      expectedSources: [
        'https://test.invalid/app.js',
        'https://test.invalid/not-loaded.js',
      ],
    },
  });
  assert.equal(result.results[0].coverage[0].status, 'instrumented');
  assert.equal(result.results[0].coverage[1].status, 'uninstrumented');
  assert.ok(
    !JSON.stringify(result.results[0].coverage).includes('"source":"abc"')
  );
  /** Actual injected unsupported-engine coverage receipt; no percentage is invented. */
  const unsupported = await runBrowserTests(
    [{ name: 'unsupported', run: () => {} }],
    {
      browser: fixture.browser,
      browserName: 'firefox',
      coverage: { expectedSources: ['app.js'] },
    }
  );
  assert.equal(unsupported.results[0].coverage[0].status, 'unsupported');
});

test('invalid browser options reject before driver allocation and backend runners stay isolated', async () => {
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  for (const options of [
    { concurrency: 0 },
    { timeoutMs: 0 },
    { browserName: 'unknown' },
    { artifacts: { directory: '../escape', trace: true } },
    { coverage: { expectedSources: ['a', 'a'] } },
  ]) {
    await assert.rejects(
      runBrowserTests([], { ...options, driver: fixture.driver })
    );
  }
  assert.equal(fixture.counts.launches, 0);
  /** Independent synthetic backend runner with a known failure. */
  const a = createRunner();
  /** Independent synthetic backend runner with a known success. */
  const b = createRunner();
  a.test('fail', () => {
    throw Error('expected');
  });
  b.test('pass', () => {});
  /** Actual concurrent independent backend outcomes, preserving registry isolation. */
  const [one, two] = await Promise.all([a.runTests(), b.runTests()]);
  assert.equal(one.failed, 1);
  assert.equal(two.passed, 1);
});

test('optional installed environment check reports unavailable without installing or launching apps', async (t) => {
  try {
    /** Optional installed-module resolution metadata; resolving a module never launches a real browser. */
    const resolved = import.meta.resolve('playwright');
    assert.equal(typeof resolved, 'string');
    t.diagnostic(
      'Playwright installed: real browser execution is handled only by the optional browser smoke check'
    );
  } catch {
    /** Actual adapter/runner outcome over deterministic doubles; no real browser certification is inferred. */
    const result = await runBrowserTests([
      { name: 'missing dependency', run: () => assert.fail('not run') },
    ]);
    assert.equal(result.unavailable, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 0);
  }
});

test('CLI and throwOnFailure preserve unavailable outcomes instead of reporting green', async () => {
  /** Built package-local CLI callback imported for private temporary test modules. */
  const { main } = await import('../dist/bin/cli.js');
  /** Owned temporary capture/config fixture namespace removed in finally. */
  const root = await mkdtemp(join(tmpdir(), 'ztrial-unavailable-'));
  /** Fixed public runtime entry URL used only in trusted synthetic fixture source. */
  const entry = new URL('../dist/index.js', import.meta.url).href;
  /** Original stdout writer restored unconditionally after local CLI output capture. */
  const original = process.stdout.write;
  let output = '';
  try {
    await writeFile(
      join(root, 'environment.test.mjs'),
      `import {test,EnvironmentUnavailableError} from ${JSON.stringify(entry)};test('optional browser',()=>{throw new EnvironmentUnavailableError('browser');});`
    );
    await writeFile(
      join(root, 'config.json'),
      JSON.stringify({ root, files: ['**/*.test.mjs'], reporter: 'tap' })
    );
    process.stdout.write = (value) => {
      output += String(value);
      return true;
    };
    assert.equal(
      await main([
        '--config',
        join(root, 'config.json'),
        '--match',
        'optional',
      ]),
      2
    );
  } finally {
    process.stdout.write = original;
    await rm(root, { recursive: true, force: true });
  }
  assert.match(output, /not ok.*environment-unavailable/);
  assert.doesNotMatch(output, /# SKIP/);
  /** Independent inert backend runner using only synthetic callback failures. */
  const runner = createRunner();
  runner.test('unavailable', () => {
    throw new EnvironmentUnavailableError('browser');
  });
  await assert.rejects(
    runner.runTests({ throwOnFailure: true }),
    /unavailable/
  );
});

test('closed runner scope rejects late browser setup without leaking parent signal listeners', async () => {
  /** Native diagnostic helper counting only this fixture signal’s registered abort listeners. */
  const { getEventListeners } = await import('node:events');
  /** Owned fixture cancellation controller, never a global browser shutdown signal. */
  const controller = new AbortController();
  /** Pre-call owned signal listener count used to prove rejected scope setup does not leak. */
  const count = getEventListeners(controller.signal, 'abort').length;
  /** Independent injected browser driver double; no Playwright or application starts. */
  const fixture = driver();
  /** Explicit already-closed synthetic invocation owner; no resource may be allocated after its rejection. */
  const scope = {
    signal: new AbortController().signal,
    onCleanup: () => {
      throw Error('scope closed');
    },
  };
  await assert.rejects(
    withBrowser(
      { driver: fixture.driver, signal: controller.signal },
      () => {},
      scope
    ),
    /scope closed/
  );
  assert.equal(getEventListeners(controller.signal, 'abort').length, count);
  assert.equal(fixture.counts.launches, 0);
});
