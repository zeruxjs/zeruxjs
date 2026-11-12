import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createAnalytics,
  createAnalyticsCollector,
  createEventClient,
  createAnonymousAnalyticsId,
  purgeAnalyticsEvents,
} from '../dist/index.js';
/** Scoped CommonJS bridge for the existing SQLite test connector. */
const require = createRequire(import.meta.url);
/** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Synthetic fixture context for the declared operation. */
const ctx = {
  connection: {
    slug: 'metrics',
    name: 'metrics',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/** Create an isolated SQLite or injected database fixture with explicit teardown/fault controls.
 * @returns {Promise<object>} Isolated fixture values for the following assertions.
 */
async function database() {
  /** Borrowed synthetic facade or owned in-memory SQLite connector. */
  const conn = await createConnector({ filename: ':memory:', driver: 'node' });
  /** Isolated fixture database or injected facade for this test. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (args) => conn.execute({ op, ...args }, ctx)]
    )
  );
  return {
    db,
    manager: { connectionSlugs: ['metrics'], getConnectionFacade: () => db },
    close: () => conn.disconnect(),
  };
}
/** Historical timestamp safely older than retention cutoff. */
const past = Date.now() - 4 * 86400000;
/** Local request builder with explicit body and policy headers.
 * @param {object} data - Synthetic collector body.
 * @param {object} headers - Explicit synthetic request headers.
 * @returns {Request} Local request builder with explicit body and policy headers. */
const collectorRequest = (data, headers = {}) =>
  new Request('https://analytics.example/_analytics/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
test('real SQLite: allowlisted event schema, explicit consent, opaque IDs and exact reporting', async () => {
  /** Owned in-memory fixture and explicit teardown callback. */
  const { manager, close } = await database();
  try {
    /** Captured fixed diagnostics checked for cardinality and private-data exclusion. */
    const warnings = [];
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      numericFields: ['price'],
      webConsent: 'required',
      eventSchemas: {
        purchase: { properties: { price: 'number', campaign: 'string' } },
      },
      onWarning: (s) => warnings.push(s),
    });
    assert.equal(await a.initialize(), true);
    assert.equal(
      await a.track({
        name: 'purchase',
        source: 'web',
        site: 'north',
        properties: { price: 3 },
      }),
      undefined
    );
    assert.equal(
      await a.track({
        name: 'purchase',
        source: 'web',
        site: 'north',
        consent: 'denied',
        properties: { price: 3 },
      }),
      undefined
    );
    assert.equal(
      await a.track({
        name: 'purchase',
        source: 'web',
        consent: 'granted',
        sessionId: 'email@example.com',
        properties: { price: 3 },
      }),
      undefined
    );
    assert.equal(
      await a.track({
        name: 'purchase',
        source: 'web',
        consent: 'granted',
        properties: { price: '3' },
      }),
      undefined
    );
    assert.equal(
      await a.track({ name: 'missing', source: 'web', consent: 'granted' }),
      undefined
    );
    assert.equal(
      await a.track({
        name: 'purchase',
        source: 'web',
        consent: 'granted',
        properties: { price: 3, zVisitorId: 'spoof' },
      }),
      undefined
    );
    /** Synthetic opaque source/correlation identifier. */
    const id = await a.track({
      name: 'purchase',
      source: 'web',
      consent: 'granted',
      site: 'north',
      visitorId: 'anon_VID_0123456789',
      sessionId: 'session_0123456789',
      properties: { price: 3, campaign: 'a' },
    });
    assert.equal(typeof id, 'string');
    /** Bounded fixture query rows, not production data. */
    const rows = await a.events({ site: 'north' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_id, 'session_0123456789');
    assert.equal(
      JSON.parse(rows[0].properties_json).zVisitorId,
      'anon_VID_0123456789'
    );
    /** Native event-count receipt checked for exact persisted totals. */
    const report = await a.aggregate({ groupBy: 'event', site: 'north' });
    assert.equal(report.total, 1);
    assert.equal(report.mode, 'database');
    /** Numeric-sidecar receipt checked separately from event history coverage. */
    const numerical = await a.aggregateNumeric({
      groupBy: 'event',
      valueField: 'price',
      metric: 'sum',
      site: 'north',
    });
    assert.equal(numerical.total, 3);
    assert.equal(numerical.coverage, 'indexed-only');
    assert.ok(warnings.length > 0);
    /** Bounded scan/purge/checkpoint receipt. */
    const page = await a.countsWithCoverage({ site: 'north' });
    assert.equal(page.coverage, 'sampled-page');
    assert.equal(page.scanned, 1);
  } finally {
    await close();
  }
});

test('real SQLite: origin tenant enforcement, deny-consent & known-bot skip without reservation, invalid request ID validation', async () => {
  /** Owned in-memory fixture and explicit teardown callback. */
  const { manager, close } = await database();
  try {
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      webConsent: 'required',
    });
    await a.initialize();
    let reserved = 0;
    /** Injected atomic reservation observer used to assert ordering before dispatch. */
    const requestIdStore = {
      async reserve() {
        reserved++;
        return true;
      },
    };
    /** Configured collector whose request policy is tested. */
    const c = createAnalyticsCollector({
      analytics: a,
      allowedOrigins: ['https://public.example'],
      siteByOrigin: { 'https://public.example': 'north' },
      requireBrowserConsent: true,
      botPolicy: 'drop-known',
      requestIdStore,
    });
    /** Explicit synthetic allowed origin headers. */
    const origin = { origin: 'https://public.example' };
    assert.equal(
      (
        await c.handler(
          collectorRequest(
            { name: 'page.view', site: 'south', consent: 'granted' },
            origin
          )
        )
      ).status,
      403
    );
    assert.equal(
      (
        await c.handler(
          collectorRequest({ name: 'page.view', consent: 'denied' }, origin)
        )
      ).status,
      204
    );
    assert.equal(
      (await c.handler(collectorRequest({ name: 'page.view' }, origin))).status,
      204
    );
    assert.equal(
      (
        await c.handler(
          collectorRequest(
            {
              name: 'page.view',
              consent: 'granted',
              requestId: '0000000000000000',
              sessionId: 'a@b.com',
            },
            origin
          )
        )
      ).status,
      422
    );
    assert.equal(reserved, 0);
    assert.equal(
      (
        await c.handler(
          collectorRequest(
            { name: 'page.view', consent: 'granted' },
            { ...origin, 'user-agent': 'ExampleBot/1.0' }
          )
        )
      ).status,
      204
    );
    assert.equal(
      (
        await c.handler(
          collectorRequest({ name: 'page.view', consent: 'granted' }, origin)
        )
      ).status,
      204
    );
    assert.equal(reserved, 1);
    assert.equal((await a.events({ site: 'north' })).length, 1);
    assert.equal((await a.events({ site: 'south' })).length, 0);
    assert.throws(
      () =>
        createAnalyticsCollector({
          analytics: a,
          allowedOrigins: ['https://public.example'],
          siteByOrigin: { 'https://other.example': 'north' },
        }),
      /mapping/
    );
  } finally {
    await close();
  }
});

test('browser consent changes do not send identifiers until granted; failed DB does not throw from collection', async () => {
  /** Observed fixture calls used to assert admission, policy or no-write behavior. */
  const calls = [];
  /** Injected browser client or explicitly owned optional live client. */
  const client = createEventClient({
    endpoint: 'https://m.example/collect',
    requireConsent: true,
    fetch: async (_, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await client.track('page.view'), false);
  client.setConsent('granted');
  /** Generated or deliberately malformed tracking/correlation token. */
  const token = createAnonymousAnalyticsId();
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.notEqual(token, createAnonymousAnalyticsId());
  assert.equal(
    await client.track('page.view', { page: 'home' }, { sessionId: token }),
    true
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].consent, 'granted');
  client.setConsent('denied');
  assert.equal(await client.track('page.view'), false);
  assert.equal(calls.length, 1);
  /** Captured fixed warning messages; private causes must not appear. */
  const warning = [];
  /** Manager/request with intentionally absent configuration or identity. */
  const missing = createAnalytics({
    analytics: 'unknown',
    database: {
      connectionSlugs: [],
      getConnectionFacade() {
        throw Error('offline');
      },
    },
    onWarning: (m) => warning.push(m),
  });
  /** Collector configured against the deliberately unavailable store. */
  const collection = createAnalyticsCollector({
    analytics: missing,
    serverToken: 'secret',
  });
  assert.equal(
    (
      await collection.handler(
        collectorRequest(
          { name: 'page.view' },
          { authorization: 'Bearer secret' }
        )
      )
    ).status,
    204
  );
  assert.equal(missing.status().dropped, 1);
  assert.equal(warning.length, 1);
});

test('real SQLite: retention is tenant-bound, approval-gated, dry-run by default, numeric-first and keyset-paged', async () => {
  /** Owned in-memory connector facade, manager and teardown. */
  const { db, manager, close } = await database();
  try {
    /** Synthetic approval/audit observations; no real user data is involved. */
    const audit = [];
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      numericFields: ['price'],
      approveRetention: async (scope) => {
        audit.push(scope);
        return scope.site === 'north';
      },
    });
    await a.initialize();
    // Seed both synthetic tenants so destructive scope can be checked independently.
    for (let i = 0; i < 7; i++) {
      assert.ok(
        await a.track({
          name: 'purchase',
          site: i < 6 ? 'north' : 'south',
          occurredAt: past,
          properties: { price: i },
        })
      );
    }
    assert.ok(
      await a.track({
        name: 'purchase',
        site: 'north',
        properties: { price: 99 },
      })
    );
    await assert.rejects(
      a.purgePage({
        site: '',
        before: Date.now() - 2 * 86400000,
        dryRun: false,
      }),
      /site|approval/
    );
    await assert.rejects(
      a.purgePage({ site: 'north', before: Date.now() }),
      /cutoff/
    );
    /** Explicit bounded tenant/window query reused for replay checks. */
    const q = { site: 'north', before: Date.now() - 2 * 86400000, limit: 2 };
    /** Preview-only receipt; assertions verify no deletion. */
    const dry = await a.purgePage(q);
    assert.equal(dry.scanned, 2);
    assert.equal(dry.deleted, 0);
    assert.equal(dry.dryRun, true);
    let cursor = undefined,
      total = 0,
      removedFacts = 0,
      pages = 0;
    // Follow only returned keyset cursors and accumulate confirmed deletion receipts.
    do {
      /** Bounded scan/purge/checkpoint receipt. */
      const page = await a.purgePage({ ...q, cursor, dryRun: false });
      total += page.deleted;
      removedFacts += page.deletedNumericFacts;
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    assert.equal(total, 6);
    assert.equal(removedFacts, 6);
    assert.equal(pages, 3);
    assert.equal((await a.events({ site: 'north' })).length, 1);
    assert.equal((await a.events({ site: 'south' })).length, 1);
    assert.equal(
      (
        await a.aggregateNumeric({
          groupBy: 'site',
          valueField: 'price',
          metric: 'sum',
        })
      ).matchedFacts,
      2
    );
    assert.equal(audit.length, 3);
    assert.equal(
      (await db.select({ table: 'analytics_events_numeric', columns: ['id'] }))
        .rows.length,
      2
    );
  } finally {
    await close();
  }
});

test('real SQLite: incomplete numeric deletion leaves original source event and blocks any successful claim', async () => {
  /** Owned in-memory connector facade, manager and teardown. */
  const { db, manager, close } = await database();
  try {
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      numericFields: ['amount'],
      approveRetention: () => true,
    });
    await a.initialize();
    await a.track({
      name: 'purchase',
      site: 'north',
      occurredAt: past,
      properties: { amount: 9 },
    });
    /** Injected malformed or failed dependency used for fail-closed checks. */
    const broken = {
      ...db,
      delete: async (op) => {
        if (op.table.endsWith('_numeric')) {
          return { ok: false };
        } else {
          return db.delete(op);
        }
      },
    };
    await assert.rejects(
      purgeAnalyticsEvents(
        broken,
        'analytics_events',
        'analytics_events_numeric',
        { site: 'north', before: Date.now() - 2 * 86400000, dryRun: false },
        { numericTableReady: true }
      ),
      /Numeric retention delete failed/
    );
    assert.equal((await a.events({ site: 'north' })).length, 1);
  } finally {
    await close();
  }
});

test('real SQLite: late historical numeric data is reconciled one page at a time and retries are idempotent', async () => {
  /** Owned in-memory connector facade, manager and teardown. */
  const { db, manager, close } = await database();
  try {
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      numericFields: ['price'],
    });
    await a.initialize();
    /** Synthetic boundary timestamp; UTC millisecond semantics are intentional. */
    const at = past;
    /** Synthetic source rows retained only in this fixture. */
    const records = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        event_name: 'purchase',
        source: 'server',
        site: 'north',
        pathname: '/',
        session_id: '',
        occurred_at: at,
        properties_json: '{"price":3}',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        event_name: 'purchase',
        source: 'server',
        site: 'north',
        pathname: '/',
        session_id: '',
        occurred_at: at,
        properties_json: '{"price":4}',
      },
    ];
    assert.equal(
      (await db.insert({ table: 'analytics_events', values: records })).ok,
      true
    );
    /** Explicit bounded tenant/window query reused for replay checks. */
    const q = { since: at - 1, until: at + 1, site: 'north', batchSize: 1 };
    /** First fixture receipt, service, key or lease in this comparison. */
    const first = await a.reconcileNumeric(q);
    assert.equal(first.created, 1);
    assert.equal(first.hasMore, true);
    /** Second fixture receipt, service, key or lease for replay/rotation/isolation checks. */
    const second = await a.reconcileNumeric({ ...q, cursor: first.nextCursor });
    assert.equal(second.created, 1);
    assert.equal(second.hasMore, false);
    /** Repeated page/acceptance used to assert unchanged persisted state. */
    const replay = await a.reconcileNumeric(q);
    assert.equal(replay.existing, 1);
    assert.equal(
      (
        await a.aggregateNumeric({
          groupBy: 'site',
          metric: 'sum',
          valueField: 'price',
        })
      ).total,
      7
    );
  } finally {
    await close();
  }
});

test('retention without configured numeric fields requires explicit statement about historical sidecars', async () => {
  /** Owned in-memory fixture and explicit teardown callback. */
  const { manager, close } = await database();
  try {
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      approveRetention: () => true,
    });
    await a.initialize();
    await a.track({ name: 'view', site: 'north', occurredAt: past });
    /** Explicit bounded tenant/window query reused for replay checks. */
    const q = {
      site: 'north',
      before: Date.now() - 2 * 86400000,
      dryRun: false,
    };
    await assert.rejects(a.purgePage(q), /historical numeric sidecar policy/);
    assert.equal((await a.events({ site: 'north' })).length, 1);
    assert.equal(
      (await a.purgePage({ ...q, numericSidecar: 'absent' })).deleted,
      1
    );
  } finally {
    await close();
  }
});

test('invalid strict collection config fails closed even after setEnabled(true)', async () => {
  /** Owned in-memory fixture and explicit teardown callback. */
  const { manager, close } = await database();
  try {
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics({
      analytics: 'metrics',
      database: manager,
      eventSchemas: { 'page.view': { properties: { score: 'object' } } },
    });
    a.setEnabled(true);
    assert.equal(a.enabled, false);
    assert.equal(await a.initialize(), false);
    assert.equal(await a.track({ name: 'page.view' }), undefined);
    /** Second fixture manager, worker or response used for isolation/replay checks. */
    const b = createAnalytics({
      analytics: 'metrics',
      database: manager,
      webConsent: 'definitely-not-valid',
    });
    b.setEnabled(true);
    assert.equal(b.enabled, false);
  } finally {
    await close();
  }
});
