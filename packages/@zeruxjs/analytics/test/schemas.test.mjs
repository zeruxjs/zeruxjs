import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createAnalytics,
  createEventSchemaRegistry,
  readEventSchemaCoverage,
  createAnalyticsCollector,
  createEventClient,
} from '@zeruxjs/analytics';
/** Scoped CommonJS bridge for the existing SQLite test connector. */
const require = createRequire(import.meta.url);
/** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Finite dimension definition shared by compatible schema versions. */
const dimension = {
  kind: 'dimension',
  type: 'string',
  values: ['docs', 'home'],
  maxCardinality: 2,
};
/** Initial immutable schema fixture. */
const v1 = {
  name: 'page.view',
  version: 1,
  properties: {
    section: { ...dimension, required: true },
    duration_ms: { kind: 'metric', unit: 'milliseconds', min: 0, max: 60000 },
  },
  userProperties: { plan: { ...dimension, values: ['free', 'paid'] } },
  sessionProperties: { campaign: { ...dimension, values: ['spring', 'fall'] } },
};
/** Additive optional-field schema fixture. */
const v2 = {
  ...v1,
  version: 2,
  properties: {
    ...v1.properties,
    engaged: { kind: 'parameter', type: 'boolean' },
  },
};
/** Create an isolated SQLite or injected database fixture with explicit teardown/fault controls.
 * @returns {Promise<object>} Isolated fixture values for the following assertions.
 */
async function database() {
  /** Fixture-owned SQLite connector; teardown disconnects it. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Synthetic fixture context for the declared operation. */
  const ctx = {
    connection: {
      slug: 'metrics',
      name: 'metrics',
      connector: '@zeruxjs/db-sqlite',
      options: {},
    },
  };
  /** Injected or synthetic database facade; ownership expectations are asserted explicitly. */
  const connection = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (args) => connector.execute({ op, ...args }, ctx)]
    )
  );
  return {
    connector,
    connection,
    manager: {
      connectionSlugs: ['metrics'],
      getConnectionFacade: () => connection,
    },
  };
}
/** Explicit named SQLite/schema/consent policy builder for this test.
 * @param {object} db - Isolated fixture database.
 * @param {object} registry - Validated fixture schema registry.
 * @returns {object} Explicit named SQLite/schema/consent policy builder for this test. */
const config = (db, registry) => ({
  analytics: 'metrics',
  database: db.manager,
  schemaRegistry: registry,
  numericFields: ['duration_ms'],
  webConsent: 'required',
  onWarning: () => {},
});
test('real SQLite: additive schemas preserve immutable history, numeric units, legacy coverage and deterministic snapshots', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  try {
    /** First fixture receipt, service, key or lease in this comparison. */
    const first = createEventSchemaRegistry([v1]);
    /** First independent fixture receipt/summary in the asserted comparison. */
    const one = createAnalytics(config(db, first));
    assert.equal(await one.initialize(), true);
    assert.ok(
      await one.track(
        first.event('page.view', {
          site: 'north',
          properties: { section: 'docs', duration_ms: 12 },
        })
      )
    );
    /** Second fixture receipt, service, key or lease for replay/rotation/isolation checks. */
    const second = createEventSchemaRegistry([v2, v1]);
    /** Second isolated schema manager sharing only the explicit fixture store. */
    const two = createAnalytics(config(db, second));
    await two.initialize();
    assert.ok(
      await two.track(
        second.event('page.view', {
          site: 'north',
          properties: { section: 'home', duration_ms: 8, engaged: true },
        })
      )
    );
    assert.ok(
      await two.track({
        name: 'page.view',
        schemaVersion: 1,
        site: 'north',
        properties: { section: 'docs' },
      })
    );
    assert.equal(
      await two.track({
        name: 'page.view',
        schemaVersion: 1,
        properties: { section: 'docs', engaged: true },
      }),
      undefined
    );
    /** Bounded fixture query rows, not production data. */
    const rows = await two.events({ site: 'north' });
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows
        .map(readEventSchemaCoverage)
        .map((c) => c.schemaVersion)
        .sort(),
      [1, 1, 2]
    );
    assert.equal(
      readEventSchemaCoverage({ properties_json: '{}' }).coverage,
      'legacy-unversioned'
    );
    assert.throws(() =>
      readEventSchemaCoverage({
        properties_json: '{"zAnalyticsSchema":{"schemaVersion":2}}',
      })
    );
    assert.throws(
      () => readEventSchemaCoverage({ properties_json: 'PRIVATE malformed' }),
      (e) =>
        e.code === 'INVALID_STORED_PROPERTIES' && !e.message.includes('PRIVATE')
    );
    /** Native indexed-only numeric result with schema unit metadata. */
    const numeric = await two.aggregateNumeric({
      groupBy: 'event',
      valueField: 'duration_ms',
      metric: 'sum',
    });
    assert.equal(numeric.total, 20);
    assert.equal(numeric.schema.unit, 'milliseconds');
    assert.equal(numeric.schema.coverage, 'mixed-history');
    assert.equal(numeric.coverage, 'indexed-only');
    assert.equal(
      second.describe().catalogId,
      createEventSchemaRegistry([v1, v2]).describe().catalogId
    );
    assert.ok(Object.isFrozen(second.describe().schemas[0].properties));
    assert.throws(() => {
      second.describe().schemas[0].properties.section.values.push('private');
    });
  } finally {
    await db.connector.disconnect();
  }
});
test('schema definition validation rejects breaking upgrades, cardinality overflow, unsafe/free-text properties and executable accessors', () => {
  // Each breaking/unsafe definition must fail catalog creation before ingestion.
  for (const candidate of [
    [
      v1,
      {
        ...v2,
        properties: {
          ...v1.properties,
          duration_ms: { kind: 'metric', unit: 'seconds' },
        },
      },
    ],
    [
      v1,
      {
        ...v2,
        properties: {
          ...v1.properties,
          needed: { kind: 'parameter', type: 'boolean', required: true },
        },
      },
    ],
    [v1, { ...v2, version: 3 }],
    [v1, v1],
    [{ ...v1, properties: { section: { ...dimension, maxCardinality: 1 } } }],
    [{ ...v1, properties: { email: dimension } }],
    [{ ...v1, properties: { text: { kind: 'parameter', type: 'string' } } }],
    [
      {
        ...v1,
        properties: {
          section: { ...dimension, values: ['private@example.test'] },
        },
      },
    ],
  ]) {
    assert.throws(
      () => createEventSchemaRegistry(candidate),
      (e) => e.name === 'AnalyticsSchemaError'
    );
  }
  let invoked = 0;
  assert.throws(() =>
    createEventSchemaRegistry([
      {
        ...v1,
        get properties() {
          invoked++;
          return {};
        },
      },
    ])
  );
  assert.equal(invoked, 0);
  /** Accessor-bearing dimension fixture; rejection must not invoke the accessor. */
  const brokenValues = ['docs'];
  Object.defineProperty(brokenValues, 0, {
    get() {
      invoked++;
      return 'docs';
    },
  });
  assert.throws(() =>
    createEventSchemaRegistry([
      {
        ...v1,
        properties: { section: { ...dimension, values: brokenValues } },
      },
    ])
  );
  assert.equal(invoked, 0);
  /** Caller-owned schema copy mutated only to verify registry detachment. */
  const raw = structuredClone(v1);
  /** Validated immutable registry isolated from later caller mutations. */
  const catalog = createEventSchemaRegistry([raw]);
  raw.properties.section.values.push('changed');
  assert.throws(() =>
    catalog.prepare({ name: 'page.view', properties: { section: 'changed' } })
  );
});
test('ingestion bounds properties and consent before DB dispatch, across independent managers without cardinality races', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  try {
    /** Explicit versioned schema registry for validation-before-write checks. */
    const registry = createEventSchemaRegistry([v1]);
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics(config(db, registry));
    /** Second fixture manager, worker or response used for isolation/replay checks. */
    const b = createAnalytics(config(db, registry));
    await a.initialize();
    let inserts = 0;
    /** Borrowed original method or inert original HTML retained for comparison. */
    const original = db.connection.insert;
    db.connection.insert = async (op) => {
      inserts++;
      return original(op);
    };
    /** Synthetic schema-valid baseline event; denial cases vary one field at a time. */
    const valid = {
      name: 'page.view',
      source: 'web',
      consent: 'granted',
      properties: { section: 'docs' },
    };
    // Every denied, unknown or mismatched property case must avoid database inserts.
    for (const input of [
      { ...valid, consent: 'denied' },
      { ...valid, consent: 'unknown' },
      { ...valid, properties: { section: 'third' } },
      { ...valid, properties: { section: 'docs', extra: 1 } },
      { ...valid, properties: { section: 'docs', duration_ms: 60001 } },
      { ...valid, schemaVersion: 9 },
      { ...valid, userProperties: { plan: 'free' } },
      { ...valid, sessionProperties: { campaign: 'spring' } },
      { ...valid, properties: { section: 'docs', zAnalyticsSchema: 1 } },
    ]) {
      assert.equal(await a.track(input), undefined);
    }
    assert.equal(inserts, 0);
    /** Generated synthetic correlation IDs tested for diversity and grammar. */
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? a : b).track({
          ...valid,
          site: i % 2 ? 'north' : 'south',
          properties: { section: i % 2 ? 'home' : 'docs' },
        })
      )
    );
    assert.ok(ids.every(Boolean));
    assert.ok(
      await a.track({
        ...valid,
        visitorId: 'visitor_0123456789',
        sessionId: 'session_0123456789',
        userProperties: { plan: 'paid' },
        sessionProperties: { campaign: 'spring' },
      })
    );
    /** Parsed stored fixture provenance checked for explicit scopes. */
    const stored = JSON.parse(
      (await a.events()).find((r) => r.session_id).properties_json
    );
    assert.deepEqual(stored.zAnalyticsSchema.userProperties, { plan: 'paid' });
    assert.deepEqual(stored.zAnalyticsSchema.sessionProperties, {
      campaign: 'spring',
    });
    /** Bounded synthetic value used to exceed a deliberately tiny byte budget. */
    const large = 'x'.repeat(100);
    /** Registry with an intentionally small serialized-property budget. */
    const tiny = createEventSchemaRegistry(
      [{ ...v1, properties: { section: { ...dimension, values: [large] } } }],
      { maxBytes: 128 }
    );
    assert.throws(() =>
      tiny.prepare({ ...valid, properties: { section: large } })
    );
  } finally {
    await db.connector.disconnect();
  }
});
test('collector rejects forged sites/schema before reservation; outages stay best effort and diagnostics omit private data', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = await database();
  try {
    /** Explicit versioned schema registry for validation-before-write checks. */
    const registry = createEventSchemaRegistry([v1]);
    /** First fixture manager, worker or response in the scoped comparison. */
    const a = createAnalytics(config(db, registry));
    await a.initialize();
    let reservations = 0;
    /** Headless collector bound only to synthetic/injected tracking. */
    const collector = createAnalyticsCollector({
      analytics: a,
      allowedOrigins: ['https://public.test'],
      siteByOrigin: { 'https://public.test': 'north' },
      requestIdStore: {
        async reserve() {
          reservations++;
          return true;
        },
      },
    });
    /** Synthetic Fetch request builder; it performs no outbound network call.
     * @param {string|ReadableStream} body - Local request body, never fetched remotely.
     * @returns {Request} Synthetic Fetch request builder; it performs no outbound network call. */
    const request = (body) =>
      new Request('https://events.test/collect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://public.test',
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await collector.handler(
          request({
            name: 'page.view',
            site: 'south',
            consent: 'granted',
            properties: { section: 'docs' },
          })
        )
      ).status,
      403
    );
    /** Actual invalid-schema HTTP response checked for redaction. */
    const rejected = await collector.handler(
      request({
        name: 'page.view',
        consent: 'granted',
        properties: { section: 'PRIVATE' },
      })
    );
    assert.equal(rejected.status, 422);
    assert.doesNotMatch(await rejected.text(), /PRIVATE/);
    assert.equal(reservations, 0);
    assert.equal(
      (
        await collector.handler(
          request({
            name: 'page.view',
            consent: 'granted',
            properties: { section: 'docs' },
          })
        )
      ).status,
      204
    );
    assert.equal(reservations, 1);
    assert.equal((await a.events({ site: 'north' })).length, 1);
    /** Captured fixed diagnostics checked for cardinality and private-data exclusion. */
    const warnings = [];
    db.connection.insert = async () => {
      throw Error('PRIVATE database password');
    };
    /** Injected malformed or failed dependency used for fail-closed checks. */
    const broken = createAnalytics({
      ...config(db, registry),
      onWarning: (m) => warnings.push(m),
    });
    assert.equal(
      await broken.track({
        name: 'page.view',
        properties: { section: 'docs' },
      }),
      undefined
    );
    assert.equal(broken.status().dropped, 1);
    assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE/);
    /** Invalid configuration that must remain fenced after enable attempts. */
    const invalid = createAnalytics({
      ...config(db, registry),
      eventSchemas: {},
    });
    invalid.setEnabled(true);
    assert.equal(await invalid.initialize(), false);
    assert.equal(invalid.enabled, false);
  } finally {
    await db.connector.disconnect();
  }
});
test('browser versioned fields require explicit consent and identity and remain inert without a network call', async () => {
  /** Observed fixture calls used to assert admission, policy or no-write behavior. */
  const calls = [];
  /** Injected browser client or explicitly owned optional live client. */
  const client = createEventClient({
    endpoint: 'https://events.test/collect',
    fetch: async (_, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(
    await client.track('page.view', {}, { userProperties: { plan: 'paid' } }),
    false
  );
  assert.equal(calls.length, 0);
  client.setConsent('granted');
  assert.equal(
    await client.track(
      'page.view',
      { section: 'docs' },
      {
        schemaVersion: 2,
        visitorId: 'visitor_0123456789',
        userProperties: { plan: 'paid' },
      }
    ),
    true
  );
  assert.equal(calls[0].schemaVersion, 2);
  assert.deepEqual(calls[0].userProperties, { plan: 'paid' });
});
test('metric domains, ambiguous units and malformed registry configuration fail before execution', async () => {
  /** Allowlisted native aggregate descriptors extracted by the fixture. */
  const metrics = createEventSchemaRegistry([
    {
      name: 'a',
      version: 1,
      properties: { value: { kind: 'metric', unit: 'count' } },
    },
    {
      name: 'b',
      version: 1,
      properties: { value: { kind: 'metric', unit: 'bytes' } },
    },
  ]);
  assert.throws(
    () => metrics.metric('value'),
    (e) => e.code === 'AMBIGUOUS_METRIC_UNIT'
  );
  assert.equal(metrics.metric('value', 'a').unit, 'count');
  // Count/byte metrics reject negative, fractional and precision-losing values.
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => metrics.prepare({ name: 'a', properties: { value } }));
  }
  let calls = 0;
  /** Manager configured only against the fixture-owned or injected database. */
  const analytics = createAnalytics({
    analytics: 'db',
    database: {
      connectionSlugs: ['db'],
      getConnectionFacade() {
        calls++;
        throw Error('should not initialize');
      },
    },
    schemaRegistry: { prepare() {}, describe() {} },
    onWarning: () => {},
  });
  assert.equal(await analytics.initialize(), false);
  analytics.setEnabled(true);
  assert.equal(analytics.enabled, false);
  assert.equal(calls, 0);
});
