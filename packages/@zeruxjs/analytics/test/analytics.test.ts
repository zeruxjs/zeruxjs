import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnalytics,
  createAnalyticsCollector,
  createEventClient,
} from '../dist/index.js';
/** Create a named in-memory row fixture with controllable initialization and write failures.
 * @returns {object} Isolated fixture values for the following assertions.
 */
function fakeDb() {
  /** Synthetic persisted rows owned by this fixture only. */
  const data = [];
  let initialized = false;
  let failed = false;
  /** Injected or synthetic database facade; ownership expectations are asserted explicitly. */
  const connection = {
    async createTable({ table, columns }) {
      initialized = table === 'analytics_events' && columns.length === 8;
      return { ok: true };
    },
    async insert({ values }) {
      if (failed) {
        return { ok: false, error: { code: 'UNAVAILABLE' } };
      }
      if (!initialized) {
        throw new Error('Missing table');
      }
      data.push(values);
      return { ok: true };
    },
    async select({ where, limit }) {
      /** Structured query predicates interpreted by the fixture, never executed as SQL strings. */
      const clauses = where?.and ?? (where ? [where] : []);
      return {
        ok: true,
        rows: data
          .filter((v) =>
            clauses.every((c) => {
              if (c.operator === 'eq') {
                return v[c.field] === c.value;
              } else {
                if (c.operator === 'gte') {
                  return v[c.field] >= c.value;
                } else {
                  return v[c.field] <= c.value;
                }
              }
            })
          )
          .slice(0, limit),
      };
    },
  };
  return {
    manager: {
      connectionSlugs: ['primary', 'events'],
      getConnectionFacade(name) {
        assert.equal(name, 'events');
        return connection;
      },
    },
    data,
    fail(value) {
      failed = value;
    },
  };
}
test('named DB selection is mandatory; schema setup and persisted events', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = fakeDb();
  /** Manager/request with intentionally absent configuration or identity. */
  const missing = createAnalytics({
    analytics: 'missing',
    database: f.manager,
    onWarning: () => {},
  });
  assert.equal(await missing.track({ name: 'page.view' }), undefined);
  assert.deepEqual(await missing.events(), []);
  /** Invalid configuration that must remain fenced after enable attempts. */
  const invalid = createAnalytics({
    analytics: 'events',
    database: f.manager,
    table: 'events;DELETE',
    onWarning: () => {},
  });
  assert.equal(await invalid.initialize(), false);
  /** First fixture manager, worker or response in the scoped comparison. */
  const a = createAnalytics({ analytics: 'events', database: f.manager });
  await a.initialize();
  await a.initialize();
  assert.equal(
    typeof (await a.track({
      name: 'page.view',
      source: 'web',
      site: 'site-a',
      properties: { path: '/docs', depth: 4, ok: true },
    })),
    'string'
  );
  assert.equal(
    f.data[0].properties_json,
    '{"path":"/docs","depth":4,"ok":true}'
  );
  await a.track({ name: 'email.open', source: 'email' });
  assert.equal((await a.events({ source: 'email' })).length, 1);
  assert.equal((await a.counts())['page.view'], 1);
  f.fail(true);
  assert.equal(await a.track({ name: 'page.view' }), undefined);
  assert.equal(a.status().dropped, 1);
});
test('invalid event values, property boundaries and untrusted source types are rejected', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = fakeDb();
  /** First fixture manager, worker or response in the scoped comparison. */
  const a = createAnalytics({ analytics: 'events', database: f.manager });
  await a.initialize();
  // Reject each invalid scalar/path/time case without persisting a partial event.
  for (const input of [
    { name: '0invalid' },
    { name: 'ok', properties: { constructor: 'bad' } },
    { name: 'ok', properties: { value: { nested: true } } },
    { name: 'ok', properties: { number: Infinity } },
    { name: 'ok', pathname: '\ninvalid' },
    { name: 'ok', occurredAt: 0 },
  ]) {
    assert.equal(await a.track(input), undefined);
  }
  assert.equal(f.data.length, 0);
});
test('collector requires allowed origin or bearer and bounds JSON and event source', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = fakeDb();
  /** First fixture manager, worker or response in the scoped comparison. */
  const a = createAnalytics({ analytics: 'events', database: f.manager });
  await a.initialize();
  /** Configured collector whose request policy is tested. */
  const c = createAnalyticsCollector({
    analytics: a,
    allowedOrigins: ['https://app.example'],
    serverToken: 'server-secret',
    maxBodyBytes: 512,
    maxEventsPerMinute: 3,
  });
  /** Synthetic Fetch request builder; it performs no outbound network call.
   * @param {object|string} obj - Synthetic request payload or malformed body fixture.
   * @param {object} headers - Explicit synthetic request headers.
   * @returns {Request} Synthetic Fetch request builder; it performs no outbound network call. */
  const request = (obj, headers = {}) =>
    new Request('https://metrics.example/_analytics/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof obj === 'string' ? obj : JSON.stringify(obj),
    });
  assert.equal((await c.handler(request({ name: 'page.view' }))).status, 403);
  assert.equal(
    (
      await c.handler(
        request(
          { name: 'email.sent', source: 'email' },
          { origin: 'https://app.example' }
        )
      )
    ).status,
    403
  );
  assert.equal(
    (
      await c.handler(
        request(
          { name: 'page.view', properties: { color: 'red' } },
          { origin: 'https://app.example' }
        )
      )
    ).status,
    204
  );
  assert.equal(f.data[0].source, 'web');
  assert.equal(
    (
      await c.handler(
        request(
          { name: 'email.sent', source: 'email' },
          { authorization: 'Bearer server-secret' }
        )
      )
    ).status,
    204
  );
  assert.equal(
    (await c.handler(request('{invalid', { origin: 'https://app.example' })))
      .status,
    400
  );
  assert.equal(
    (
      await c.handler(
        request('x'.repeat(1000), { origin: 'https://app.example' })
      )
    ).status,
    429
  );
  assert.equal(
    (
      await c.handler(
        new Request('https://metrics.example/_analytics/collect', {
          method: 'OPTIONS',
          headers: { origin: 'https://app.example' },
        })
      )
    ).status,
    204
  );
});
test('browser client sends uncredentialed bounded events and handles errors silently', async () => {
  /** Observed fixture calls used to assert admission, policy or no-write behavior. */
  const calls = [];
  /** Injected browser client or explicitly owned optional live client. */
  const client = createEventClient({
    endpoint: 'https://metrics.example/collect',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    },
  });
  await client.track('signup', { plan: 'basic' });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(JSON.parse(calls[0].init.body).name, 'signup');
  assert.throws(
    () => createEventClient({ endpoint: 'javascript:alert(1)' }),
    /endpoint/
  );
});
