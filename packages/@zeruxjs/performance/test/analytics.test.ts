import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrowserPerformanceAnalytics,
  createServerPerformanceAdapter,
  performanceAnalyticsSchemas,
  requestPerformanceAnalyticsSchema,
} from '@zeruxjs/performance/analytics';
import {
  createVitalReporter,
  createVitalCollector,
  createPerformanceMetric,
} from '@zeruxjs/performance';
import {
  createEventSchemaRegistry,
  validateRegisteredEvent,
} from '@zeruxjs/analytics';
/** Isolated lifecycle target tracking only synthetic listener ownership. */
class Target extends EventTarget {
  visibilityState = 'visible';
  listeners = new Map();
  /** Track native synthetic target registration while preserving EventTarget semantics.
   * @param {string} type - Fixed synthetic native event type.
   * @param {EventListener} fn - Exact listener callback owned by this synthetic target.
   * @param {...unknown} rest - Remaining native EventTarget options forwarded unchanged.
   * @returns {void} Records exactly the registered listener for cleanup assertions.
   */
  addEventListener(type, fn, ...rest) {
    super.addEventListener(type, fn, ...rest);
    /** Fixture listener set for one fixed event type, used to verify exact removal. */
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  /** Remove the exact synthetic registration and update bounded listener accounting.
   * @param {string} type - Fixed synthetic native event type.
   * @param {EventListener} fn - Exact listener callback owned by this synthetic target.
   * @param {...unknown} rest - Remaining native EventTarget options forwarded unchanged.
   * @returns {void} Unrelated listener ownership is preserved.
   */
  removeEventListener(type, fn, ...rest) {
    super.removeEventListener(type, fn, ...rest);
    this.listeners.get(type)?.delete(fn);
  }
  /** Count currently retained synthetic listeners across fixed event types.
   * @returns {number} Fixture listener count, not a process-wide leak measurement.
   */
  count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}
/** Configure an isolated consent/observer/transport fixture without real browser or network work.
 * @param {object} extra - Explicit trusted fixture overrides; no arbitrary source execution.
 * @returns {object} Owned adapter plus synthetic targets/counters; caller destroys/drains it.
 */
function browser(extra = {}) {
  /** Injected document-like lifecycle target, independent of real DOM globals. */
  const doc = new Target();
  /** Injected page-like lifecycle target used for owned pagehide listeners. */
  const win = new Target();
  /** Injected observer callbacks used to feed deterministic entry fixtures. */
  const callbacks = new Map();
  /** Recorded native-observer lease cleanup, isolated per adapter fixture. */
  const disconnected = [];
  /** Approved synthetic event batches retained only by this test. */
  const sent = [];
  let created = 0;
  /** Owned browser/operational adapter; destroy then await actual reporter settlement. */
  const adapter = createBrowserPerformanceAnalytics({
    site: 'north',
    consent: 'granted',
    document: doc,
    window: win,
    webVitals: { version: '5.2.0', inpSupported: true },
    observer: {
      supportedEntryTypes: [
        'paint',
        'largest-contentful-paint',
        'layout-shift',
        'navigation',
      ],
      navigation: () => ({ responseStart: 20, requestStart: 5 }),
      createObserver: (callback) => {
        created++;
        return {
          /** Record one fixed synthetic native entry-type registration.
           * @param {object} options - Explicit synthetic native observer configuration.
           * @param {string} options.type - Fixed native entry type.
           * @returns {void} Records callback ownership only; no browser API is invoked.
           */
          observe({ type }) {
            callbacks.set(type, callback);
          },
          /** Record one owned synthetic observer disconnection.
           * @returns {void} No other fixture observer is affected.
           */
          disconnect() {
            disconnected.push(true);
          },
        };
      },
    },
    send: async (events) => {
      sent.push(events);
      return true;
    },
    ...extra,
  });
  return {
    adapter,
    doc,
    win,
    callbacks,
    disconnected,
    sent,
    get created() {
      return created;
    },
  };
}
test('consent denies startup/effects, and revocation disposes observers and clears identity samples', async () => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = browser({ consent: 'denied' });
  try {
    assert.equal(f.adapter.start(), false);
    assert.equal(f.created, 0);
    assert.equal(
      f.adapter.receiveWebVital({ name: 'INP', value: 100, id: 'v5_1' }),
      false
    );
    assert.equal(await f.adapter.flush(), 0);
    assert.equal(f.sent.length, 0);
    f.adapter.setConsent('granted', { sessionId: 'session_0123456789' });
    assert.equal(f.adapter.start(), true);
    assert.equal(f.created, 3);
    await f.adapter.flush();
    assert.equal(f.sent[0][0].sessionId, 'session_0123456789');
    f.adapter.setConsent('denied');
    assert.equal(f.disconnected.length, 3);
    assert.equal(f.doc.count() + f.win.count(), 0);
    assert.equal(f.adapter.snapshot().sampleSize, 0);
    assert.equal(f.adapter.snapshot().consent, 'denied');
    assert.equal(await f.adapter.flush(), 0);
  } finally {
    f.adapter.destroy();
    await f.adapter.whenClosed();
  }
});
test('native and maintained INP metrics map approved units/schemas; unsupported/raw events are not renamed INP', async () => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = browser();
  /** Inert analytics schema registry used to independently validate emitted scalar facts. */
  const registry = createEventSchemaRegistry(performanceAnalyticsSchemas());
  try {
    f.adapter.start();
    f.callbacks.get('largest-contentful-paint')([
      { startTime: 1234, name: 'https://private/?token=secret' },
    ]);
    f.callbacks.get('layout-shift')([{ startTime: 1, value: 1.2 }]);
    assert.equal(
      f.adapter.receiveWebVital({ name: 'event', duration: 77, id: 'v5_1' }),
      false
    );
    assert.equal(
      f.adapter.receiveWebVital({
        name: 'INP',
        value: 250,
        id: 'v5_1',
        entries: [{ target: 'PRIVATE' }],
        attribution: { url: 'PRIVATE' },
      }),
      true
    );
    assert.equal(
      f.adapter.receiveWebVital({ name: 'INP', value: 250, id: 'v5_1' }),
      false
    );
    await f.adapter.flush();
    // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
    for (const event of f.sent.flat()) {
      validateRegisteredEvent(event, registry);
    }
    /** Observed synthetic CLS event; score semantics are distinct from ratios. */
    const cls = f.sent.flat().find((e) => e.properties.metric === 'CLS');
    assert.equal(cls.properties.layout_shift_score, 1.2);
    assert.equal(cls.properties.unit, 'score');
    assert.doesNotMatch(
      JSON.stringify(f.sent),
      /PRIVATE|private|token|entries|attribution|v5_1/
    );
    /** Bounded sample/coverage projection checked without private identity fields. */
    const summary = f.adapter.snapshot();
    assert.equal(summary.sampleSize, 4);
    assert.equal(summary.coverage.INP, 'web-vitals-5');
    assert.ok(
      summary.observations.every(
        (o) =>
          o.coverageVersion === 1 &&
          o.sampleSize > 0 &&
          o.consent.includes('granted')
      )
    );
  } finally {
    f.adapter.destroy();
    await f.adapter.whenClosed();
  }
  /** Owned adapter with deliberately unavailable native observation capabilities. */
  const unsupported = browser({
    webVitals: { version: '5.2.0', inpSupported: false },
    observer: {
      supportedEntryTypes: [],
      createObserver: () => {
        throw Error('must not observe unsupported types');
      },
    },
  });
  try {
    unsupported.adapter.start();
    assert.equal(
      unsupported.adapter.receiveWebVital({
        name: 'INP',
        value: 2,
        id: 'v5_1',
      }),
      false
    );
    assert.equal(unsupported.adapter.snapshot().coverage.INP, 'unsupported');
  } finally {
    unsupported.adapter.destroy();
    await unsupported.adapter.whenClosed();
  }
});
test('hidden/pagehide flushes are bounded and destroy removes all owned listeners', async () => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = browser();
  f.adapter.start();
  assert.equal(f.doc.count(), 1);
  assert.equal(f.win.count(), 1);
  f.doc.visibilityState = 'hidden';
  f.doc.dispatchEvent(new Event('visibilitychange'));
  await f.adapter.flush();
  assert.equal(f.sent.length, 1);
  f.callbacks.get('paint')([
    { name: 'first-contentful-paint', startTime: 500 },
  ]);
  f.win.dispatchEvent(new Event('pagehide'));
  await f.adapter.flush();
  assert.equal(f.sent.length, 2);
  f.adapter.destroy();
  await f.adapter.whenClosed();
  assert.equal(f.doc.count() + f.win.count(), 0);
  f.callbacks.get('paint')([
    { name: 'first-contentful-paint', startTime: 800 },
  ]);
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.sent.length, 2);
  assert.equal(
    f.adapter.receiveWebVital({ name: 'INP', value: 2, id: 'v5_1' }),
    false
  );
});
test('reporter backoff, attempt/age limits, overload and permanent denial are explicit', async () => {
  let now = 1000,
    calls = 0;
  /** Owned explicit-flush reporter; destroy then await whenClosed at teardown. */
  const reporter = createVitalReporter({
    send: async () => {
      calls++;
      return false;
    },
    maxBatch: 2,
    maxQueue: 2,
    maxRetries: 1,
    retryBaseMs: 10,
    retryMaxMs: 10,
    maxAgeMs: 100,
    now: () => now,
  });
  // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
  for (const value of [1, 2, 3]) {
    reporter.add(createPerformanceMetric('LCP', value));
  }
  assert.equal(reporter.diagnostics().dropped, 1);
  await assert.rejects(reporter.flush());
  assert.equal(reporter.pending, 2);
  assert.equal(await reporter.flush(), 0);
  now += 10;
  await assert.rejects(reporter.flush());
  assert.equal(calls, 2);
  assert.equal(reporter.pending, 0);
  reporter.add(createPerformanceMetric('FCP', 1));
  now += 100;
  assert.equal(reporter.pending, 0);
  reporter.destroy();
  await reporter.whenClosed();
  let cancels = 0;
  /** Owned reporter simulating permanent transport denial and response-body cleanup. */
  const denied = createVitalReporter({
    url: 'https://metrics.test',
    fetch: async () => ({
      ok: false,
      status: 403,
      body: {
        /** Record cancellation of the borrowed synthetic Fetch response body.
         * @returns {Promise<void>} Settles synthetic body cleanup without closing a global Fetch pool.
         */
        async cancel() {
          cancels++;
        },
      },
    }),
  });
  denied.add(createPerformanceMetric('LCP', 1));
  await assert.rejects(denied.flush(), /403/);
  assert.equal(denied.pending, 0);
  assert.equal(cancels, 1);
  denied.destroy();
  await denied.whenClosed();
  assert.throws(() =>
    createVitalReporter({ url: 'https://metrics.test/?token=PRIVATE' })
  );
});
test('destroy recovery excludes ambiguous in-flight writes and retains native capacity until cleanup', async () => {
  let settle;
  /** Owned explicit-flush reporter; destroy then await whenClosed at teardown. */
  const reporter = createVitalReporter({
    send: () => new Promise((resolve) => (settle = resolve)),
    timeoutMs: 10,
    maxBatch: 1,
    maxQueue: 2,
  });
  try {
    reporter.add(createPerformanceMetric('FCP', 1));
    await assert.rejects(reporter.flush(), /deadline/);
    assert.equal(reporter.diagnostics().inFlight, true);
    await assert.rejects(reporter.flush(), /still pending/);
    reporter.add(createPerformanceMetric('LCP', 2));
    /** Only known queued recovery observations; active uncertain work is excluded. */
    const recovery = reporter.destroy({ unsent: 'recover' });
    assert.deepEqual(
      recovery.recovered.map((m) => m.name),
      ['LCP']
    );
    assert.equal(recovery.inFlightOutcome, 'unknown');
    let closed = false;
    /** Actual drain promise, observed independently of timeout/abort waiting. */
    const closing = reporter.whenClosed().then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(closed, false);
    settle(true);
    await closing;
    assert.equal(reporter.diagnostics().inFlight, false);
    assert.equal(reporter.destroy().recovered.length, 0);
  } finally {
    reporter.destroy();
    settle?.(true);
    await reporter.whenClosed();
  }
});
test('consent change fences a late failed delivery instead of requeueing old-session metrics', async () => {
  let reject;
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = browser({
    send: (_events, { signal }) =>
      new Promise((_resolve, fail) => {
        reject = fail;
        signal.addEventListener('abort', () => {}, { once: true });
      }),
  });
  try {
    f.adapter.start();
    /** Admitted delivery promise whose actual injected transport still needs settlement. */
    const sending = f.adapter.flush();
    /** Assertion observing a deliberately failing delivery to prevent unhandled rejection. */
    const caught = assert.rejects(sending);
    await new Promise((resolve) => setImmediate(resolve));
    f.adapter.setConsent('denied');
    reject(Error('PRIVATE storage outage'));
    await caught;
    f.adapter.setConsent('granted', { sessionId: 'session_9876543210' });
    assert.equal(f.adapter.snapshot().reporter.pending, 0);
    f.adapter.destroy();
    await f.adapter.whenClosed();
  } finally {
    f.adapter.destroy();
    reject?.();
    await f.adapter.whenClosed();
  }
});
test('server metrics use bounded route labels and exclude operational correlation/marketing identities', async () => {
  /** Approved synthetic observations delivered by the injected sink. */
  const received = [];
  /** Owned browser/operational adapter; destroy then await actual reporter settlement. */
  const adapter = createServerPerformanceAdapter({
    routes: ['catalog'],
    send: async (metrics) => {
      received.push(metrics);
      return true;
    },
  });
  try {
    adapter.record(
      {
        durationMs: 12,
        status: 503,
        outcome: 'error',
        requestId: 'PRIVATE',
        traceId: 'PRIVATE',
        url: '/private?token=x',
        visitorId: 'PRIVATE',
      },
      'catalog'
    );
    adapter.record({ durationMs: 3, status: 200, outcome: 'completed' });
    await adapter.flush();
    assert.equal(received[0][0].name, 'request.catalog');
    assert.equal(received[0][0].statusClass, '5xx');
    assert.equal(received[0][0].outcome, 'error');
    assert.doesNotMatch(
      JSON.stringify(received),
      /PRIVATE|private|token|traceId|requestId|visitorId/
    );
    assert.equal(adapter.snapshot().consent, 'not-applicable');
    assert.equal(adapter.snapshot().sampleSize, 2);
    assert.throws(() =>
      adapter.record(
        { durationMs: 1, status: 200, outcome: 'completed' },
        '/private/user123'
      )
    );
    /** Inert bounded operational schema distinct from marketing identity/trace fields. */
    const schema = requestPerformanceAnalyticsSchema(['catalog']);
    /** Inert analytics schema registry used to independently validate emitted scalar facts. */
    const registry = createEventSchemaRegistry([schema]);
    validateRegisteredEvent(
      {
        name: schema.name,
        source: 'system',
        site: 'north',
        properties: {
          route: 'catalog',
          status_class: '5xx',
          outcome: 'error',
          scope: 'operational-only',
          duration_ms: 12,
          sample_size: 1,
        },
      },
      registry
    );
  } finally {
    adapter.destroy();
    await adapter.whenClosed();
  }
});
test('collector enforces direct cardinality and strips extra metadata from reporter transport', async () => {
  /** Inert bounded synthetic sample collector; no persistent handles are acquired. */
  const collector = createVitalCollector({
    maxMetricNames: 1,
    maxPerMetric: 1,
  });
  collector.record({ name: 'custom', value: 1, timestamp: Date.now() });
  assert.throws(
    () => collector.record(createPerformanceMetric('FCP', 2)),
    /cardinality/
  );
  assert.throws(() =>
    collector.record({
      ...createPerformanceMetric('FCP', 2),
      name: '/PRIVATE?token=x',
    })
  );
  let body;
  /** Owned explicit-flush reporter; destroy then await whenClosed at teardown. */
  const reporter = createVitalReporter({
    url: 'https://metrics.test',
    fetch: async (_url, init) => {
      body = init.body;
      return { ok: true };
    },
  });
  reporter.add({
    ...createPerformanceMetric('FCP', 1),
    url: 'PRIVATE',
    password: 'PRIVATE',
  });
  await reporter.flush();
  assert.doesNotMatch(body, /PRIVATE|password|url/);
  reporter.destroy();
  await reporter.whenClosed();
});
test('unsupported observer registrations release acquired observers and report coverage', async () => {
  let stopped = 0;
  /** Owned browser/operational adapter; destroy then await actual reporter settlement. */
  const adapter = createBrowserPerformanceAnalytics({
    site: 'north',
    consent: 'granted',
    send: async () => true,
    observer: {
      supportedEntryTypes: [
        'paint',
        'largest-contentful-paint',
        'layout-shift',
      ],
      createObserver: () => ({
        /** Record one fixed synthetic native entry-type registration.
         * @returns {void} Records callback ownership only; no browser API is invoked.
         */
        observe() {
          throw Error('unsupported');
        },
        /** Record one owned synthetic observer disconnection.
         * @returns {void} No other fixture observer is affected.
         */
        disconnect() {
          stopped++;
        },
      }),
    },
  });
  try {
    adapter.start();
    assert.equal(stopped, 3);
    assert.equal(adapter.snapshot().coverage.LCP, 'unsupported');
    assert.equal(adapter.snapshot().coverage.INP, 'unsupported');
  } finally {
    adapter.destroy();
    await adapter.whenClosed();
  }
  assert.throws(() =>
    createBrowserPerformanceAnalytics({
      site: 'https://private/?token=x',
      send: async () => true,
    })
  );
});
