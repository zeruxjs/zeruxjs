import { createFixtureCleanup } from './fixture-cleanup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReportSourceRegistry,
  createReportSourceHandler,
} from '../dist/sources.js';
import { createGa4ReportSource } from '../dist/ga4.js';
/** Synthetic verified tenant/site/principal/grant partition. */
const identity = {
  tenant: 'tenant-a',
  site: 'shop',
  principal: 'reader',
  credentialPartition: 'grant-a',
};
/** Explicit finite fixture field/unit catalog, not provider discovery. */
const schema = {
  version: 1,
  fields: [
    { name: 'date', kind: 'dimension', type: 'string' },
    { name: 'eventCount', kind: 'metric', type: 'decimal', unit: 'count' },
  ],
};
/** Finite fixture query plan; no arbitrary provider URL or identity fields. */
const query = {
  source: 'ga',
  schemaVersion: 1,
  dimensions: ['date'],
  metrics: ['eventCount'],
  from: '2026-01-01',
  to: '2026-01-02',
  limit: 10,
};
/** Borrowed synthetic short-lived token provider; no real grant is loaded. */
const credentials = {
  /** Return only the synthetic fixed-scope token; no OAuth network grant is acquired.
   * @returns {Promise<object>} Explicit fixture result or intentional failure; no live-provider qualification.
   */
  async getAccessToken() {
    return {
      accessToken: 'fixture-only',
      expiresAt: Date.now() + 60000,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    };
  },
};
/** Synthetic provider response builder retaining decimal precision.
 * @returns {unknown} Result of this documented fixture projection or explicit failure.
 */
const payload = () => ({
  dimensionHeaders: [{ name: 'date' }],
  metricHeaders: [{ name: 'eventCount', type: 'TYPE_INTEGER' }],
  metadata: { timeZone: 'UTC' },
  rowCount: 1,
  rows: [
    {
      dimensionValues: [{ value: '20260101' }],
      metricValues: [{ value: '9007199254740993' }],
    },
  ],
});
/** Create an owned explicit fixture registry with a fixed-property injected adapter.
 * @param {function} fetch - Explicit synthetic query/callback/options value, never a live credential or arbitrary source.
 * @param {unknown} options - Explicit synthetic query/callback/options value, never a live credential or arbitrary source.
 * @returns {object} Explicit fixture result or intentional failure; no live-provider qualification.
 */
function setup(fetch, options = {}) {
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({
    authorize: () => true,
    ...options,
  });
  registry.register(
    'ga',
    createGa4ReportSource({
      binding: identity,
      property: '123',
      schema,
      timeZone: 'UTC',
      credentials,
      fetch,
      maxAttempts: 2,
    })
  );
  return registry;
}
test('GA4 fixed endpoint, precision, schema and private scoped identity', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  let calls = 0;
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = setup(async (url, init) => {
    calls++;
    assert.equal(
      url,
      'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport'
    );
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).limit, '10');
    return Response.json(payload());
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  try {
    /** Explicit tested projection/receipt; unknown or missing data must not become fake zeroes. */
    const result = await registry.query(query, identity);
    assert.equal(result.rows[0][1], '9007199254740993');
    assert.equal(result.cachePrivacy, 'private-no-store');
    assert.equal(result.coverage.kind, 'provider-reported');
    assert(!JSON.stringify(result).includes('fixture-only'));
    await assert.rejects(
      registry.query(query, { ...identity, tenant: 'other' }),
      { code: 'DENIED' }
    );
    assert.equal(calls, 1);
    assert.throws(
      () =>
        registry.validatePlan([query, { ...query, metrics: ['IMPRESSIONS'] }]),
      { code: 'INVALID_QUERY' }
    );
    await assert.rejects(
      registry.query({ ...query, endpoint: 'https://evil.example' }, identity),
      { code: 'INVALID_QUERY' }
    );
  } finally {
    await registry.close();
  }
  assert.equal(registry.status().pending, 0);
});
test('denied authorizer runs before credentials; quota/outage are distinct from zero data', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned registry whose authorizer must deny before credentials/provider work. */
  const denied = setup(
    () => {
      throw Error('no calls');
    },
    { authorize: () => false }
  );
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => denied.close());
  await assert.rejects(denied.query(query, identity), { code: 'DENIED' });
  await denied.close();
  // Inspect only the finite synthetic cases/handles; no live-provider acceptance is inferred.
  for (const [status, code] of [
    [429, 'QUOTA'],
    [503, 'UNAVAILABLE'],
  ]) {
    let calls = 0;
    /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
    const registry = setup(async () => {
      calls++;
      return new Response('private provider body', {
        status,
        headers: { 'retry-after': '0' },
      });
    });
    // Register fixture ownership before later assertions can fail.
    cleanup('source', () => registry.close());
    await assert.rejects(
      registry.query(query, identity),
      (e) =>
        e.code === code && !JSON.stringify(e).includes('private provider body')
    );
    assert.equal(calls, 2);
    await registry.close();
  }
  /** Explicit empty fixture/snapshot, distinct from missing/unavailable data. */
  const empty = setup(async () =>
    Response.json({ ...payload(), rowCount: 0, rows: [] })
  );
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => empty.close());
  assert.deepEqual((await empty.query(query, identity)).rows, []);
  await empty.close();
});
test('cancellation/close retain actual pending ownership until cooperative fetch settles', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  let started;
  /** Observed synthetic request-start barrier; it does not prove mutation persistence. */
  const ready = new Promise((r) => (started = r));
  let aborted = false;
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = setup(async (_url, { signal }) => {
    started();
    return await new Promise((_, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(Error('private URL and credential'));
        },
        { once: true }
      )
    );
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  /** Owned fixture abort controller released before pending owners drain. */
  const c = new AbortController();
  // Register fixture ownership before later assertions can fail.
  cleanup('cancel', () => c.abort());
  /** Observed in-flight query/handler result; test teardown settles its owner before awaiting it. */
  const job = registry.query(query, identity, c.signal);
  // Register fixture ownership before later assertions can fail.
  void job.catch(() => {});
  cleanup('pending', async () => {
    await Promise.allSettled([job]);
  });
  await ready;
  c.abort();
  await assert.rejects(job, { code: 'CANCELLED' });
  await registry.close();
  assert(aborted);
  assert.equal(registry.status().pending, 0);
  await assert.rejects(registry.query(query, identity), { code: 'CLOSED' });
});
test('HTTP authenticates before body/source, preserves no-store and redacts failures', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = setup(async () => {
    throw Error('secret token');
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  /** Borrowed body/query handler; source registry retains its own lifecycle. */
  const handler = createReportSourceHandler({
    registry,
    resolveScope: () => identity,
  });
  /** Private synthetic HTTP receipt, independently checked for no-store/errors. */
  const res = await handler(
    new Request('https://host/reports/source', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
    })
  );
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await res.json(), { error: 'UNAVAILABLE' });
  /** Owned registry whose authorizer must deny before credentials/provider work. */
  const denied = createReportSourceHandler({
    registry,
    resolveScope: () => {
      throw Error('private session');
    },
  });
  assert.equal(
    (await denied(new Request('https://host/report', { method: 'POST' })))
      .status,
    403
  );
  await registry.close();
});
test('invalid provider units, timezone and response byte budgets fail closed', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  // Inspect only the finite synthetic cases/handles; no live-provider acceptance is inferred.

  for (const mutate of [
    (v) => (v.metadata.timeZone = 'America/New_York'),
    (v) => (v.metricHeaders[0].type = 'TYPE_CURRENCY'),
    (v) => (v.rows[0].metricValues[0].value = 'NaN'),
  ]) {
    /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
    const registry = setup(async () => {
      /** Fresh synthetic provider response being intentionally corrupted. */
      const v = payload();
      mutate(v);
      return Response.json(v);
    });
    // Register fixture ownership before later assertions can fail.
    cleanup('source', () => registry.close());
    await assert.rejects(registry.query(query, identity), {
      code: 'INVALID_RESULT',
    });
    await registry.close();
  }
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = setup(async () => Response.json(payload()), {
    maxBytes: 256,
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  await assert.rejects(registry.query(query, identity), {
    code: 'INVALID_RESULT',
  });
  await registry.close();
});

test('GA4 quota reason in 403 is not treated as denied or empty', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = setup(async () =>
    Response.json(
      {
        error: {
          errors: [{ reason: 'quotaExceeded', message: 'private credential' }],
        },
      },
      { status: 403, headers: { 'retry-after': '99' } }
    )
  );
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  await assert.rejects(registry.query(query, identity), { code: 'QUOTA' });
  await registry.close();
});
test('registry deadlines hold noncooperative capacity until actual settlement', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  let finish;
  cleanup('cancel', () => finish?.());
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({
    authorize: () => true,
    maxConcurrent: 1,
    timeoutMs: 5,
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  registry.register('ga', {
    schema,
    capabilities: { readOnly: true, maxRows: 10, maxDays: 10 },
    /** Return a finite explicit synthetic adapter result or hold until the test releases its native barrier.
     * @returns {Promise<object>} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    async query() {
      await new Promise((r) => (finish = r));
      return {
        columns: schema.fields,
        rows: [],
        timeZone: 'UTC',
        coverage: {
          kind: 'internal',
          truncated: false,
          totalRows: 0,
          sampling: 'unknown',
          restricted: false,
        },
      };
    },
  });
  await assert.rejects(registry.query(query, identity), { code: 'CANCELLED' });
  assert.equal(registry.status().pending, 1);
  await assert.rejects(registry.query(query, identity), { code: 'OVERLOAD' });
  finish();
  await registry.close();
  assert.equal(registry.status().pending, 0);
});

test('close disposes each owner once and still disposes others after synchronous cleanup failure', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  let disposed = 0;
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({ authorize: () => true });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', async () => {
    try {
      await registry.close();
    } catch (error) {
      if (error.code !== 'UNAVAILABLE') {
        throw error;
      }
    }
  });
  /** Trusted injected adapter whose explicit cleanup/failure semantics are under test. */
  const adapter = {
    schema,
    capabilities: { readOnly: true, maxRows: 10, maxDays: 10 },
    query: async () => {
      throw Error('unused');
    },
    /** Release/count one synthetic adapter owner or throw its intentional private cleanup failure.
     * @returns {void} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    dispose() {
      disposed++;
      throw Error('private cleanup');
    },
  };
  registry.register('one', adapter);
  registry.register('two', adapter);
  registry.register('three', {
    ...adapter,
    /** Release/count one synthetic adapter owner or throw its intentional private cleanup failure.
     * @returns {void} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    dispose() {
      disposed++;
    },
  });
  await assert.rejects(registry.close(), { code: 'UNAVAILABLE' });
  assert.equal(disposed, 2);
  assert.equal(registry.status().sources, 0);
});
test('private cache identities separate principals and schema plans do not merge incompatible sources', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({ authorize: () => true });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  registry.register('ga', {
    schema,
    capabilities: { readOnly: true, maxRows: 10, maxDays: 10 },
    /** Return a finite explicit synthetic adapter result or hold until the test releases its native barrier.
     * @returns {Promise<object>} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    async query() {
      return {
        columns: schema.fields,
        rows: [],
        timeZone: 'UTC',
        coverage: {
          kind: 'internal',
          truncated: false,
          totalRows: 0,
          sampling: 'unknown',
          restricted: false,
        },
      };
    },
  });
  /** First synthetic scoped result/store/view; ownership remains explicit. */
  const a = await registry.query(query, identity);
  /** Second synthetic scoped result/store/view proving isolation or deterministic ordering. */
  const b = await registry.query(query, { ...identity, principal: 'other' });
  assert.notEqual(a.cacheIdentity, b.cacheIdentity);
  assert.deepEqual(a.window, {
    from: query.from,
    to: query.to,
    inclusive: true,
  });
  await registry.close();
});
test('mixed panels validate against their own schema and HTTP cancelled bodies are disposed', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = setup(async () => Response.json(payload()));
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  /** Independent incompatible field schema; panels cannot silently merge. */
  const second = {
    version: 1,
    fields: [
      { name: 'DATE', kind: 'dimension', type: 'string' },
      { name: 'IMPRESSIONS', kind: 'metric', type: 'decimal', unit: 'count' },
    ],
  };
  registry.register('ads', {
    schema: second,
    capabilities: { readOnly: true, maxRows: 10, maxDays: 10 },
    /** Return a finite explicit synthetic adapter result or hold until the test releases its native barrier.
     * @returns {Promise<object>} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    async query() {
      throw Error('validation must not execute');
    },
  });
  /** Finite AdSense plan using its own explicit schema. */
  const ads = {
    ...query,
    source: 'ads',
    dimensions: ['DATE'],
    metrics: ['IMPRESSIONS'],
  };
  assert.equal(registry.validatePlan([query, ads]).length, 2);
  assert.throws(
    () => registry.validatePlan([query, { ...ads, metrics: ['eventCount'] }]),
    { code: 'INVALID_QUERY' }
  );
  let cancelled = false;
  /** Owned synthetic request cancellation; no force-cancellation claim. */
  const controller = new AbortController();
  // Register fixture ownership before later assertions can fail.
  cleanup('cancel', () => controller.abort());
  /** Bounded synthetic request stream/definition; cancellation owns reader cleanup. */
  const body = new ReadableStream({
    /** Observe cancellation of the synthetic bounded request body reader.
     * @returns {void} Explicit fixture result or intentional failure; no live-provider qualification.
     */
    cancel() {
      cancelled = true;
    },
  });
  /** Borrowed body/query handler; source registry retains its own lifecycle. */
  const handler = createReportSourceHandler({
    registry,
    resolveScope: () => identity,
  });
  /** Observed in-flight query/handler result; test teardown settles its owner before awaiting it. */
  const job = handler(
    new Request('https://host/query', {
      method: 'POST',
      duplex: 'half',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    })
  );
  // Register fixture ownership before later assertions can fail.
  void job.catch(() => {});
  cleanup('pending', async () => {
    await Promise.allSettled([job]);
  });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  /** Synthetic private HTTP result, never a live-provider acceptance claim. */
  const response = await job;
  assert.equal(response.status, 408);
  assert(cancelled);
  await registry.close();
});
