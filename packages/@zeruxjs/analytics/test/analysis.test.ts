import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAnalytics, createAnalyticsAnalysis } from '@zeruxjs/analytics';
/** Scoped CommonJS bridge for the existing SQLite test connector. */
const require = createRequire(import.meta.url);
/** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** UTC day duration used for deterministic window arithmetic. */
const DAY = 86400000;
/** Whole UTC day sufficiently in the past for historical-window checks. */
const day = Math.floor((Date.now() - 10 * DAY) / DAY) * DAY;
/** Synthetic opaque consented visitor identity. */
const visitor = 'visitor_0123456789';
/** Synthetic opaque consented session identity. */
const session = 'session_0123456789';
/** Create an isolated SQLite or injected database fixture with explicit teardown/fault controls.
 * @returns {Promise<object>} Isolated fixture values for the following assertions.
 */
async function database() {
  /** Fixture-owned SQLite connector; teardown disconnects it. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Synthetic connector/message context containing no real credentials or recipient data. */
  const context = {
    connection: {
      slug: 'analysis',
      name: 'analysis',
      connector: '@zeruxjs/db-sqlite',
      options: {},
    },
  };
  /** Observed fixture calls used to assert admission, policy or no-write behavior. */
  const calls = [];
  /** Injected or synthetic database facade; ownership expectations are asserted explicitly. */
  const connection = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select'].map((op) => [
      op,
      (args, options) => {
        calls.push({ op, args, options });
        return connector.execute({ op, ...args }, context);
      },
    ])
  );
  /** Manager configured only against the fixture-owned or injected database. */
  const analytics = createAnalytics({
    analytics: 'analysis',
    database: {
      connectionSlugs: ['analysis'],
      getConnectionFacade: () => connection,
    },
    onWarning: () => {},
  });
  await analytics.initialize();
  return { connector, connection, analytics, calls };
}
/** Synthetic source/projection row used to assert validation and identity behavior.
 * @param {string|number} id - Synthetic opaque fixture identifier.
 * @param {string} name - Synthetic event name.
 * @param {number} at - Synthetic UTC millisecond timestamp.
 * @param {object} extra - Explicit fixture overrides, default empty.
 * @returns {object} Synthetic source/projection row used to assert validation and identity behavior. */
const row = (id, name, at, extra = {}) => ({
  id: String(id).padStart(6, '0'),
  event_name: name,
  site: 'north',
  source: 'web',
  pathname: '/',
  session_id: session,
  occurred_at: at,
  properties_json: JSON.stringify({ zConsent: 'granted', zVisitorId: visitor }),
  ...extra,
});
/** Fixture insertion helper; never connects to application data.
 * @param {object} db - Isolated fixture database.
 * @param {object[]} rows - Synthetic rows to insert.
 * @returns {unknown} Fixture insertion helper; never connects to application data. */
const insert = (db, rows) =>
  db.connection.insert({ table: 'analytics_events', values: rows });
/** Analysis-scope fixture with explicit synthetic tenant authorization.
 * @param {object} db - Isolated fixture database.
 * @returns {object} Analysis-scope fixture with explicit synthetic tenant authorization. */
const scope = (db) =>
  db.analytics.createAnalysis({
    site: 'north',
    authorize: () => true,
    pageSize: 2,
  });
test('SQLite sessions: event-time order, exact timeout boundary, duplicate timestamps and tenant/consent coverage', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  let analysis;
  try {
    await insert(db, [
      row(1, 'view', day + 30 * 60000),
      row(2, 'view', day),
      row(3, 'view', day),
      row(4, 'view', day + 31 * 60000),
      row(5, 'view', day + 60 * 60000),
      row(6, 'private', day, { site: 'south' }),
      row(7, 'unknown', day, { properties_json: '{}' }),
      row(8, 'missing', day, { session_id: '' }),
      row(9, 'bad', day, { properties_json: 'PRIVATE malformed' }),
    ]);
    analysis = scope(db);
    await analysis.initializeIndexes();
    /** Actual operation receipt checked by the following assertions. */
    const result = await analysis.sessions({ since: day, until: day + DAY });
    assert.equal(result.sessions, 2);
    assert.equal(result.events, 5);
    assert.equal(result.totalDurationMs, 30 * 60000);
    assert.equal(result.coverage.persistedCount, 8);
    assert.equal(result.coverage.unconsented, 1);
    assert.equal(result.coverage.missingIdentity, 1);
    assert.equal(result.coverage.invalid, 1);
    assert.equal(result.coverage.windowExhausted, true);
    assert.equal(result.coverage.snapshot, false);
    assert.equal(result.coverage.legacyUnversioned, 7);
    assert.ok(
      db.calls
        .filter((c) => c.op === 'select')
        .every((c) =>
          c.args.where.and.some(
            (x) => x.field === 'site' && x.value === 'north'
          )
        )
    );
    assert.ok(
      db.calls.some(
        (c) => c.op === 'select' && c.options.signal instanceof AbortSignal
      )
    );
  } finally {
    await analysis?.close();
    await db.connector.disconnect();
  }
});
test('SQLite funnels: strict increasing timestamps, ordered/repeated steps, conversion dedupe and window expiry', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  let analysis;
  try {
    await insert(db, [
      row(1, 'purchase', day + 100),
      row(2, 'start', day),
      row(3, 'start', day + 1),
      row(4, 'purchase', day + 100),
      row(5, 'start', day),
      row(6, 'purchase', day, {
        properties_json: JSON.stringify({
          zConsent: 'granted',
          zVisitorId: 'visitor_9876543210',
        }),
      }),
      row(7, 'start', day, {
        properties_json: JSON.stringify({
          zConsent: 'granted',
          zVisitorId: 'visitor_9876543210',
        }),
      }),
    ]);
    analysis = scope(db);
    /** Actual operation receipt checked by the following assertions. */
    const result = await analysis.funnel({
      since: day,
      until: day + DAY,
      steps: ['start', 'purchase'],
      conversionWindowMs: 1000,
    });
    assert.equal(result.entered, 2);
    assert.equal(result.converted, 1);
    assert.equal(result.conversionRate, 0.5);
    assert.equal(result.coverage.mode, 'bounded-persisted-window');
    /** Replay receipt used to verify idempotence without duplicate work. */
    const repeated = await analysis.funnel({
      since: day,
      until: day + DAY,
      steps: ['start', 'start', 'purchase'],
      conversionWindowMs: 1000,
    });
    assert.deepEqual(
      repeated.steps.map((s) => s.principals),
      [2, 1, 1]
    );
    /** Result for the deliberately expired window or lease. */
    const expired = await analysis.funnel({
      since: day,
      until: day + DAY,
      steps: ['start', 'purchase'],
      conversionWindowMs: 10,
    });
    assert.equal(expired.converted, 0);
  } finally {
    await analysis?.close();
    await db.connector.disconnect();
  }
});
test('SQLite UTC cohorts: first observed entry, return-before-entry rejection, distinct retention and unfinished future buckets', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  let analysis;
  try {
    await insert(db, [
      row(1, 'return', day),
      row(2, 'entry', day + 100),
      row(3, 'return', day + DAY),
      row(4, 'return', day + DAY + 1),
      row(5, 'entry', day + DAY),
      row(6, 'return', day + 2 * DAY),
    ]);
    analysis = scope(db);
    /** Actual operation receipt checked by the following assertions. */
    const result = await analysis.cohort({
      since: day,
      until: day + 2 * DAY,
      entryEvent: 'entry',
      returnEvent: 'return',
      retentionDays: 20,
    });
    assert.equal(result.cohorts[0].principals, 1);
    assert.equal(result.cohorts[1].principals, 0);
    assert.deepEqual(
      result.cohorts[0].retention.slice(0, 3).map((b) => b.observed),
      [0, 1, 1]
    );
    assert.equal(result.cohorts[0].retention[20].observed, null);
    assert.equal(result.cohorts[0].retention[20].rate, null);
    assert.equal(result.membership, 'first-entry-observed-in-window');
  } finally {
    await analysis?.close();
    await db.connector.disconnect();
  }
});
test('bounded pages expose sampling and unknown conversions; limits and denied tenants cause zero queries', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  let analysis;
  try {
    await insert(db, [
      row(1, 'start', day),
      row(2, 'finish', day + 1),
      row(3, 'finish', day + 2),
    ]);
    analysis = db.analytics.createAnalysis({
      site: 'north',
      authorize: () => true,
      maxEvents: 1,
      pageSize: 1,
    });
    /** Actual operation receipt checked by the following assertions. */
    const result = await analysis.funnel({
      since: day,
      until: day + DAY,
      steps: ['start', 'finish'],
    });
    assert.equal(result.coverage.mode, 'sampled-page');
    assert.equal(result.coverage.truncated, true);
    assert.equal(result.coverage.scanned, 1);
    assert.equal(result.conversionRate, null);
    assert.equal(result.converted, null);
    assert.equal(result.observedConverted, 0);
    /** Explicitly unauthorized analysis scope; it must not dispatch queries. */
    const denied = db.analytics.createAnalysis({
      site: 'south',
      authorize: () => false,
    });
    /** Pre-operation count/time used to detect unauthorized work or retention scope. */
    const before = db.calls.length;
    await assert.rejects(
      denied.sessions({ since: day, until: day + DAY }),
      (e) => e.code === 'DENIED'
    );
    assert.equal(db.calls.length, before);
    await denied.close();
    // Every unsupported or forged window must fail before a database query.
    for (const query of [
      { since: day, until: day + 32 * DAY },
      { since: day, until: day },
      { since: day, until: day + DAY, site: 'south' },
      { since: day, until: day + DAY, plan: 'native' },
    ]) {
      assert.throws(() => analysis.sessions(query));
    }
    assert.throws(() =>
      analysis.cohort({
        since: day + 1,
        until: day + DAY,
        entryEvent: 'x',
        returnEvent: 'y',
        retentionDays: 1,
      })
    );
  } finally {
    await analysis?.close();
    await db.connector.disconnect();
  }
});
test('dependency failure/unsafe result never becomes zero; unsupported COUNT is not emulated', async () => {
  /** Fixture factory varying only the explicitly supplied test options.
   * @param {object} connection - Injected database facade.
   * @returns {object} Fixture factory varying only the explicitly supplied test options. */
  const make = (connection) =>
    createAnalyticsAnalysis({
      site: 'north',
      authorize: () => true,
      connection: () => connection,
    });
  let calls = 0;
  /** Malformed/tampered fixture result expected to fail closed. */
  const bad = make({
    select: async () => {
      calls++;
      throw Error('PRIVATE database token');
    },
  });
  await assert.rejects(
    bad.sessions({ since: day, until: day + DAY }),
    (e) => e.code === 'UNAVAILABLE' && !e.message.includes('PRIVATE')
  );
  assert.equal(calls, 1);
  await bad.close();
  /** Injected backend without the required native query capability. */
  const unsupported = make({
    select: async () => ({ ok: false, error: { message: 'PRIVATE' } }),
  });
  await assert.rejects(
    unsupported.sessions({ since: day, until: day + DAY }),
    (e) => e.code === 'UNSUPPORTED_OR_FAILED_PLAN'
  );
  await unsupported.close();
  /** Fixture attempting to return or submit another tenant scope. */
  const forged = make({
    select: async (op) => {
      if (op.columns[0]?.as) {
        return { ok: true, rows: [{ analysis_count: 1 }] };
      } else {
        return { ok: true, rows: [row(1, 'x', day, { site: 'south' })] };
      }
    },
  });
  await assert.rejects(
    forged.sessions({ since: day, until: day + DAY }),
    (e) => e.code === 'SCOPE_OR_ORDER_VIOLATION'
  );
  await forged.close();
});
test('deadline/disconnect cancellation retains actual native ownership and close drains without closing borrowed DB', async () => {
  let finish,
    signal,
    closed = 0;
  /** Isolated fixture database or injected facade for this test. */
  const db = {
    select: (_op, options) => {
      signal = options.signal;
      return new Promise((resolve) => (finish = resolve));
    },
    close() {
      closed++;
    },
  };
  /** Owned bounded analysis scope; tests drain it before database teardown. */
  const analysis = createAnalyticsAnalysis({
    site: 'north',
    authorize: () => true,
    connection: () => db,
    maxConcurrent: 1,
    timeoutMs: 10,
  });
  await assert.rejects(
    analysis.sessions({ since: day, until: day + DAY }),
    (e) => e.code === 'DEADLINE'
  );
  assert.equal(signal.aborted, true);
  assert.equal(analysis.diagnostics().pending, 1);
  await assert.rejects(
    analysis.sessions({ since: day, until: day + DAY }),
    (e) => e.code === 'OVERLOAD'
  );
  let settled = false;
  /** Observed close promise; must wait for actual native work settlement. */
  const closing = analysis.close().then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(settled, false);
  finish({ ok: true, rows: [{ analysis_count: 0 }] });
  await closing;
  assert.equal(analysis.diagnostics().pending, 0);
  assert.equal(closed, 0);
  await assert.rejects(
    analysis.sessions({ since: day, until: day + DAY }),
    (e) => e.code === 'CLOSED'
  );
  /** Owned test AbortController; cancellation is explicit rather than timing-derived. */
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  /** Pre-cancelled analysis scope used to assert zero authorization/query work. */
  const pre = createAnalyticsAnalysis({
    site: 'north',
    authorize: () => {
      calls++;
      return true;
    },
    connection: () => db,
  });
  await assert.rejects(
    pre.sessions(
      { since: day, until: day + DAY },
      { signal: controller.signal }
    ),
    (e) => e.code === 'CANCELLED'
  );
  assert.equal(calls, 0);
  await pre.close();
});
test('missing identity and changing persisted population never imply zero conversions', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  let analysis;
  try {
    await insert(db, [
      row(1, 'start', day, { properties_json: '{"zConsent":"granted"}' }),
    ]);
    analysis = scope(db);
    /** Actual operation receipt checked by the following assertions. */
    const result = await analysis.funnel({
      since: day,
      until: day + DAY,
      steps: ['start', 'finish'],
    });
    assert.equal(result.coverage.missingIdentity, 1);
    assert.equal(result.converted, null);
    assert.equal(result.observedConverted, 0);
    assert.equal(result.conversionRate, null);
  } finally {
    await analysis?.close();
    await db.connector.disconnect();
  }
  /** Injected or synthetic database facade; ownership expectations are asserted explicitly. */
  const connection = {
    select: async (op) => {
      if (op.columns[0]?.as) {
        return { ok: true, rows: [{ analysis_count: 5 }] };
      } else {
        return { ok: true, rows: [] };
      }
    },
  };
  /** Analysis fixture whose count and source page intentionally disagree. */
  const changed = createAnalyticsAnalysis({
    site: 'north',
    authorize: () => true,
    connection: () => connection,
  });
  /** Actual operation receipt checked by the following assertions. */
  const result = await changed.funnel({
    since: day,
    until: day + DAY,
    steps: ['start', 'finish'],
  });
  assert.equal(result.coverage.countMatchesScan, false);
  assert.equal(result.converted, null);
  await changed.close();
});
test('actual AbortSignal cancels an outstanding read; late backend settlement releases capacity', async () => {
  let finish;
  /** Owned test AbortController; cancellation is explicit rather than timing-derived. */
  const controller = new AbortController();
  /** Owned bounded analysis scope; tests drain it before database teardown. */
  const analysis = createAnalyticsAnalysis({
    site: 'north',
    authorize: () => true,
    connection: () => ({
      select: () => new Promise((resolve) => (finish = resolve)),
    }),
  });
  /** Outstanding operation whose actual settlement remains test-controlled. */
  const pending = analysis.sessions(
    { since: day, until: day + DAY },
    { signal: controller.signal }
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort('PRIVATE');
  await assert.rejects(
    pending,
    (e) => e.code === 'CANCELLED' && !e.message.includes('PRIVATE')
  );
  assert.equal(analysis.diagnostics().pending, 1);
  finish({ ok: true, rows: [{ analysis_count: 0 }] });
  await analysis.close();
  assert.equal(analysis.diagnostics().pending, 0);
});
test('safe decimal timestamp/count replies are normalized without native precision claims', async () => {
  /** Injected or synthetic database facade; ownership expectations are asserted explicitly. */
  const connection = {
    select: async (op) => {
      if (op.columns[0]?.as) {
        return { ok: true, rows: [{ analysis_count: '1' }] };
      } else {
        return { ok: true, rows: [row(1, 'start', String(day))] };
      }
    },
  };
  /** Owned bounded analysis scope; tests drain it before database teardown. */
  const analysis = createAnalyticsAnalysis({
    site: 'north',
    authorize: () => true,
    connection: () => connection,
  });
  try {
    /** Actual operation receipt checked by the following assertions. */
    const result = await analysis.sessions({ since: day, until: day + DAY });
    assert.equal(result.sessions, 1);
    assert.equal(result.coverage.invalid, 0);
  } finally {
    await analysis.close();
  }
});
