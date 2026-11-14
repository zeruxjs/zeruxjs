import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeRuntimeServices } from '../dist/bootstrap/services.js';
import { createTagManager, emptyTagContainer } from '@zeruxjs/tags';
import { createReports } from '@zeruxjs/reports';
import { createMemoryRequestIdStore } from '@zeruxjs/analytics';
/** Synthetic collected events retained only to assert request-ID deduplication. */
const hits = [];
/** Injected analytics boundary with isolated request-ID stores and no external persistence. */
const analytics = {
  track: async (ev) => {
    hits.push(ev);
    return 'ok';
  },
  events: async () => [],
  createRequestIdStore: () => createMemoryRequestIdStore(),
};
/** Inject actual tags/reports facades with synthetic analytics and no native databases.
 * @returns {object} Service factories whose managers belong to the framework generation.
 */
function providers() {
  return {
    database: async () => ({}),
    cache: async () => ({}),
    analytics: async () => analytics,
    tags: async (config, a) =>
      createTagManager({
        ...config,
        analytics: a,
        requestIds: config.requestIds ?? createMemoryRequestIdStore(),
        container: emptyTagContainer(),
      }),
    reports: async (config, a) => createReports({ ...config, analytics: a }),
  };
}
test('tags and reports HTTP mounts, lifecycle, redacted config and browser ingress', async () => {
  /** Private tags/reports registration with explicit origin and administrator authorization fixtures. */
  const config = {
    analytics: { analytics: 'main', enabled: true },
    tags: {
      enabled: true,
      allowedOrigins: ['https://myapp.test'],
      authorizeAdmin: (r) => r.headers.get('x-access') === 'yes',
    },
    reports: {
      enabled: true,
      authorize: (r) => r.headers.get('x-access') === 'yes',
    },
  };
  /** Generation owner closed before asserting that all mounted service routes disappear. */
  const scope = await initializeRuntimeServices(
    config,
    process.cwd(),
    providers()
  );
  try {
    assert.deepEqual(
      scope
        .status()
        .slice(-2)
        .map((x) => x.name),
      ['tags', 'reports']
    );
    assert.equal(config.tags, undefined);
    assert.equal(config.reports, undefined);
    /** Current generation routes used directly without starting a user application. */
    const routes = scope.httpRoutes();
    /** Mounted path projection proving expected collection and reporting endpoints exist. */
    const paths = routes.map((r) => r.pattern);
    assert.ok(paths.includes('/_tags/collect'));
    assert.ok(paths.includes('/_tags/ttag.js'));
    assert.ok(paths.includes('/_reports/api'));
    /** Generated collector script response inspected as text, never evaluated by this test. */
    const script = await routes
      .find((r) => r.pattern === '/_tags/ttag.js')
      .handler(new Request('https://myapp.test/_tags/ttag.js'));
    assert.equal(script.status, 200);
    assert.ok((await script.text()).includes('sendBeacon'));
    /** Fixed synthetic request identifier reused deliberately to exercise duplicate rejection. */
    const id = 'ABCDEFGHIJ123456';
    /** Generation-owned browser ingress route subject to its configured origin policy. */
    const collector = routes.find((r) => r.pattern === '/_tags/collect');
    /** Create a fresh synthetic same-origin collection request.
     * @returns {Request} Request with the same event ID for deduplication checks.
     */
    const request = () =>
      new Request('https://myapp.test/_tags/collect', {
        method: 'POST',
        headers: {
          origin: 'https://myapp.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'signup',
          requestId: id,
          properties: { tier: 'free' },
        }),
      });
    assert.equal((await collector.handler(request())).status, 204);
    assert.equal(hits.length, 1);
    assert.equal((await collector.handler(request())).status, 409);
    assert.equal(hits.length, 1);
    /** Authorized report endpoint checked with an intentionally missing access header. */
    const api = routes.find((r) => r.pattern === '/_reports/api');
    assert.equal(
      (await api.handler(new Request('https://myapp.test/_reports/api')))
        .status,
      403
    );
  } finally {
    await scope.close();
  }
  assert.equal(scope.httpRoutes().length, 0);
});
test('invalid report authentication config never mounts insecure admin', async () => {
  /** Explicit service configuration used to test authorizer validation or default package initialization. */
  const cfg = { analytics: { enabled: true }, reports: { enabled: true } };
  await assert.rejects(
    initializeRuntimeServices(cfg, process.cwd(), {
      ...providers(),
      reports: async (config, a) => createReports({ ...config, analytics: a }),
    }),
    { code: 'MISSING_AUTHORIZER' }
  );
});
test('default framework initializers dynamically mount real Tags/Reports packages', async () => {
  /** Explicit service configuration used to test authorizer validation or default package initialization. */
  const cfg = {
    analytics: { enabled: true },
    tags: {
      enabled: true,
      allowedOrigins: ['https://myapp.test'],
      authorizeAdmin: () => true,
    },
    reports: { enabled: true, authorize: () => true },
  };
  /** Generation owner closed before asserting that all mounted service routes disappear. */
  const scope = await initializeRuntimeServices(cfg, process.cwd(), {
    database: async () => ({}),
    cache: async () => ({}),
    analytics: async () => analytics,
  });
  try {
    assert.equal(scope.status().find((x) => x.name === 'tags').state, 'ready');
    assert.equal(
      scope.status().find((x) => x.name === 'reports').state,
      'ready'
    );
    assert.ok(
      scope.httpRoutes().some((r) => r.pattern === '/_tags/admin/preview')
    );
    assert.ok(scope.httpRoutes().some((r) => r.pattern === '/_reports/query'));
  } finally {
    await scope.close();
  }
});
