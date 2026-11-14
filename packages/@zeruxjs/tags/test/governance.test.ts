import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';
import {
  createTagManager,
  emptyTagContainer,
  createMemoryTagStore,
  validateContainer,
  releaseSummary,
} from '../dist/index.js';
import {
  createMemoryRequestIdStore,
  createRequestId,
} from '@zeruxjs/analytics';

/** Create isolated in-memory routes and an owned runtime with synthetic host authorization.
 * @param {object} options - Explicit fixture-only dependency/policy overrides; no production credentials.
 * @returns {object} Borrowed fixture stores/route helpers and owned runtime requiring close.
 */
function app(options = {}) {
  /** Synthetic analytics observations; no live database/provider acceptance is inferred. */
  const hits = [];
  /** Borrowed process-local CAS fixture store; memory is not durable cross-replica persistence. */
  const store = options.store ?? createMemoryTagStore(emptyTagContainer());
  /** Owned synthetic tag runtime; stores and analytics remain borrowed. */
  const runtime = createTagManager({
    analytics: {
      track: async (e) => {
        hits.push(e);
        return 'persisted';
      },
    },
    requestIds: createMemoryRequestIdStore(),
    store,
    authorizeAdmin: (request) =>
      request.headers.get('x-role') === 'editor' ||
      request.headers.get('x-role') === 'publisher',
    authorizePublish: (request) =>
      request.headers.get('x-role') === 'publisher',
    dashboardHost: 'tags.example.com',
    ...options,
  });
  /** Select a fixed declared route without starting a listener.
   * @param {string} name - Fixed declared route suffix.
   * @returns {Function} Fixed declared in-memory route handler.
   */
  const route = (name) =>
    runtime.routes().find((r) => r.pattern === '/_tags/' + name).handler;
  /** Construct a synthetic protected request with explicit method/origin/role controls.
   * @param {string} name - Fixed declared route suffix.
   * @param {string} method - Explicit fixture method, default GET.
   * @param {unknown} body - Optional inert fixture payload.
   * @param {string} role - Synthetic trusted host grant, default publisher; never production header authentication.
   * @param {string} origin - Explicit synthetic request Origin used for exact-origin policy assertions.
   * @returns {Request} Synthetic Fetch request without any network/socket work.
   */
  const req = (
    name,
    method = 'GET',
    body = undefined,
    role = 'publisher',
    origin = 'https://tags.example.com'
  ) =>
    new Request('https://tags.example.com/_tags/' + name, {
      method,
      headers: { origin, 'x-role': role, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  /** Invoke a fixed in-memory protected route with explicit synthetic host grants.
   * @param {string} name - Fixed declared route suffix.
   * @param {string} method - Explicit fixture method, default GET.
   * @param {unknown} body - Optional inert fixture payload.
   * @param {string} role - Synthetic trusted host grant, default publisher; never production header authentication.
   * @param {string} origin - Explicit synthetic request Origin used for exact-origin policy assertions.
   * @returns {Promise<Response>} Observed protected in-memory handler response.
   */
  const call = async (
    name,
    method = 'GET',
    body,
    role = 'publisher',
    origin = 'https://tags.example.com'
  ) => route(name)(req(name, method, body, role, origin));
  return { hits, store, runtime, req, call, route };
}

/** Save one explicit next-revision draft through the synthetic authorized API.
 * @param {object} app - Owned synthetic runtime and protected route fixture.
 * @param {Function} modify - Trusted fixture mutation of an independent proposal.
 * @returns {Promise<number>} Saved next draft revision; publication remains separate.
 */
async function draft(app, modify) {
  /** Loaded validated current revision captured before proposing an optimistic edit. */
  const current = await (await app.call('admin/api')).json();
  /** Independent next draft copied before explicit revision mutation. */
  const proposal = structuredClone(current);
  modify(proposal);
  proposal.version++;
  /** Protected operation response; assertions distinguish conflict and committed/unknown outcomes. */
  const response = await app.call('admin/api', 'PUT', proposal, 'editor');
  assert.equal(response.status, 200);
  return proposal.version;
}

test('draft is isolated from published server/browser until role-checked publish; rollback restores live release', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Request-local server state with explicit fixture identity and mutable consent. */
  const astag = a.runtime.createAstag({ site: 'demo' });
  assert.equal((await astag('event', 'visit')).firedTags.length, 1);
  /** Current optimistic revision required for explicit publish/rollback. */
  const revision = await draft(a, (c) => {
    c.triggers.push({ id: 'page', name: 'Page', type: 'pageview' });
    c.tags[0].triggerIds = ['page'];
  });
  assert.equal(revision, 2);
  assert.equal(
    (await astag('event', 'visit')).firedTags.length,
    1,
    'draft cannot affect active server'
  );
  /** Pure live-snapshot trigger preview compared with draft behavior. */
  const publishedPreview = await (
    await a.call('admin/preview', 'POST', { name: 'visit', mode: 'published' })
  ).json();
  /** Pure authorized draft trigger preview, expected not to dispatch or persist. */
  const draftPreview = await (
    await a.call('admin/preview', 'POST', { name: 'visit', mode: 'draft' })
  ).json();
  assert.deepEqual(
    publishedPreview.candidateTags.map((t) => t.id),
    ['internal_analytics']
  );
  assert.deepEqual(draftPreview.candidateTags, []);
  /** Captured pre-operation script or request count used to detect implicit publication/retry. */
  const before = await (await a.call('ttag.js')).text();
  assert.ok(!before.includes('"pageview"'));
  assert.equal(
    (
      await a.call(
        'admin/publish',
        'POST',
        { expectedVersion: revision },
        'editor'
      )
    ).status,
    403
  );
  assert.equal(
    (
      await a.call(
        'admin/publish',
        'POST',
        { expectedVersion: revision },
        'publisher',
        'https://evil.test'
      )
    ).status,
    403
  );
  assert.equal(
    (await a.call('admin/publish', 'POST', { expectedVersion: revision - 1 }))
      .status,
    409
  );
  /** Explicit publication operation response; acceptance does not imply remote telemetry processing. */
  const published = await a.call('admin/publish', 'POST', {
    expectedVersion: revision,
  });
  assert.equal(published.status, 200);
  assert.equal((await astag('event', 'visit')).firedTags.length, 0);
  /** Emitted script derived only from published automatic trigger kinds. */
  const liveScript = await (await a.call('ttag.js')).text();
  assert.ok(liveScript.includes('"pageview"'));
  /** Borrowed published-snapshot reader used to check live/draft separation. */
  const active = a.runtime.published;
  assert.equal((await active()).triggers.length, 2);
  /** Authorized bounded release-history metadata response. */
  const history = await (await a.call('admin/status')).json();
  assert.equal(history.publishedRelease, 2);
  assert.deepEqual(
    history.history.map((x) => x.id),
    [1, 2]
  );
  assert.equal(
    (
      await a.call('admin/rollback', 'POST', {
        expectedVersion: 3,
        releaseId: 100,
      })
    ).status,
    422
  );
  assert.equal(
    (
      await a.call(
        'admin/rollback',
        'POST',
        { expectedVersion: 3, releaseId: 1 },
        'editor'
      )
    ).status,
    403
  );
  assert.equal(
    (
      await a.call('admin/rollback', 'POST', {
        expectedVersion: 3,
        releaseId: 1,
      })
    ).status,
    200
  );
  assert.equal((await astag('event', 'visit')).firedTags.length, 1);
  assert.ok(!(await (await a.call('ttag.js')).text()).includes('"pageview"'));
  /** Post-rollback live/draft metadata; rollback creates a new live release. */
  const rolled = await (await a.call('admin/status')).json();
  assert.equal(rolled.publishedRelease, 3);
  assert.equal(rolled.publishedRevision, 1);
  assert.equal(rolled.draftRevision, 4);
  assert.equal(
    rolled.unpublishedChanges,
    true,
    'rollback retains draft for rework'
  );
  assert.equal(
    (await a.call('admin/publish', 'POST', { expectedVersion: 3 })).status,
    409
  );
  assert.equal(
    (await a.call('admin/publish', 'POST', { expectedVersion: 4 })).status,
    200
  );
  assert.equal(
    (await astag('event', 'visit')).firedTags.length,
    0,
    're-published draft becomes live'
  );
});

test('publisher permission is explicit even if editor is authenticated; governance metadata cannot be forged', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({ authorizePublish: undefined });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** First independent concurrent next-revision proposal. */
  const first = await (await a.call('admin/api')).json();
  /** Untrusted candidate attempting to forge server-owned governance. */
  const malicious = structuredClone(first);
  malicious.version = 2;
  malicious.governance = {
    release: 99,
    published: structuredClone(first),
    history: [],
  };
  assert.equal((await a.call('admin/api', 'PUT', malicious)).status, 422);
  assert.equal(
    (await a.call('admin/publish', 'POST', { expectedVersion: 1 })).status,
    403
  );
  assert.equal(
    (
      await a.call('admin/rollback', 'POST', {
        expectedVersion: 1,
        releaseId: 1,
      })
    ).status,
    403
  );
  assert.equal(
    (await a.call('admin/preview', 'POST', { name: 'view' }, 'editor')).status,
    200
  );
  assert.equal(
    (await a.call('admin/api', 'PUT', { ...first, version: 2 }, 'publisher'))
      .status,
    200
  );
  /** Loaded post-operation document checked for exact optimistic revision. */
  const after = await a.store.load();
  assert.equal(after.governance.release, 1);
  assert.equal(after.version, 2);
  assert.equal(
    (await a.call('admin/status', 'GET', undefined, 'none')).status,
    403
  );
});

test('two manager instances sharing durable CAS document cannot lose updates', async (t) => {
  /** Borrowed process-local CAS fixture store; memory is not durable cross-replica persistence. */
  const store = createMemoryTagStore(emptyTagContainer());
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({ store });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Second owned synthetic manager or operation result used to test isolation. */
  const b = app({ store });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await b.runtime.close();
  });
  /** Loaded validated current revision captured before proposing an optimistic edit. */
  const current = await store.load();
  /** First independent concurrent next-revision proposal. */
  const first = { ...current, version: 2, name: 'first' };
  /** Second independent concurrent candidate using the same expected revision. */
  const second = { ...current, version: 2, name: 'second' };
  /** Concurrent CAS responses; exactly one next revision may win. */
  const responses = await Promise.all([
    a.call('admin/api', 'PUT', first),
    b.call('admin/api', 'PUT', second),
  ]);
  assert.deepEqual(responses.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await a.runtime.published()).name, 'Default');
  assert.equal(
    (await b.call('admin/publish', 'POST', { expectedVersion: 2 })).status,
    200
  );
  assert.equal(
    (await a.runtime.published()).name,
    (await b.runtime.published()).name
  );
  assert.equal(
    (await a.call('admin/publish', 'POST', { expectedVersion: 2 })).status,
    409
  );
});

test('consent defaults and tenant binding apply to web and server; rejected beacons never dispatch', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({
    defaultConsent: 'denied',
    allowedOrigins: ['https://site.example.com'],
    siteByOrigin: { 'https://site.example.com': 'bound_site' },
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Request-local server state with explicit fixture identity and mutable consent. */
  const astag = a.runtime.createAstag({ site: 'bound_site' });
  assert.equal(await astag('event', 'view'), undefined);
  await astag('consent', 'granted');
  assert.equal((await astag('event', 'view')).firedTags.length, 1);
  /** Construct a bounded synthetic collector request with chosen consent/site claims.
   * @param {string} consent - Synthetic untrusted browser consent claim.
   * @param {string} site - Synthetic browser site claim checked against host binding.
   * @returns {Promise<Response>} Collector response; accepted transport is not proof of provider processing.
   */
  const send = (consent, site) =>
    a.route('collect')(
      new Request('https://tags.example.com/_tags/collect', {
        method: 'POST',
        headers: {
          origin: 'https://site.example.com',
          'content-type': 'text/plain',
        },
        body: JSON.stringify({
          name: 'page_view',
          requestId: createRequestId(),
          site,
          consent,
          properties: { ok: true },
        }),
      })
    );
  assert.equal((await send(undefined, 'bound_site')).status, 204);
  assert.equal((await send('denied', 'bound_site')).status, 204);
  assert.equal(a.hits.length, 1);
  assert.equal((await send('granted', 'attacker_site')).status, 403);
  assert.equal((await send('granted', 'bound_site')).status, 204);
  assert.equal(a.hits.length, 2);
  assert.equal(a.hits[1].site, 'bound_site');
});

test('browser cannot overwrite configured site/debug or choose request IDs; deny purges pending events', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({ defaultConsent: 'denied' });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Generated self-contained script fixture compiled/executed only in isolated VM/jsdom. */
  const js = await (await a.call('ttag.js')).text();
  /** Synthetic Beacon/Fetch output log; no operating-system/network delivery occurs. */
  const sent = [];
  /** Isolated synthetic window with explicitly supplied native capabilities. */
  const win = { crypto: webcrypto, addEventListener() {} };
  /** Synthetic document with explicit event listeners; no live browser/AT behavior is implied. */
  const doc = { addEventListener() {} };
  vm.runInNewContext(js, {
    window: win,
    document: doc,
    navigator: {
      sendBeacon: (url, blob) => {
        sent.push(blob);
        return true;
      },
    },
    Uint8Array,
    Blob,
    Promise,
    location: { pathname: '/' },
  });
  assert.equal(win.ttag('config', { site: 'attacker', debug: true }), false);
  assert.equal(win.ttag('get', 'site'), '', 'compiled site stays read-only');
  assert.equal(win.ttag('event', 'view'), null);
  win.ttag('consent', 'granted');
  win.dataLayer.push({
    event: 'view',
    zRequestId: 'ATTACKERCHOSEN00',
    properties: { ok: true },
  });
  win.ttag('consent', 'denied');
  await Promise.resolve();
  assert.equal(sent.length, 0, 'revoking consent empties unsent batch');
  win.ttag('consent', 'granted');
  win.dataLayer.push({ event: 'view', zRequestId: 'ATTACKERCHOSEN00' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  /** Synthetic bounded event with freshly generated opaque correlation ID. */
  const event = JSON.parse(await sent[0].text());
  assert.notEqual(event.requestId, 'ATTACKERCHOSEN00');
  assert.equal(event.consent, 'granted');
});

test('admin CSP uses an exact script hash instead of unrestricted inline scripts', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Synthetic route response checked for privacy, status and fixed headers. */
  const res = await a.call('admin');
  /** Serialized authenticated dashboard fixture; assertions check safe stored text and explicit mount. */
  const html = await res.text();
  /** Exact emitted script body compiled and hashed without executing source modules. */
  const source = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  /** Exact digest of emitted fixture script for CSP comparison. */
  const hash = createHash('sha256').update(source).digest('base64');
  assert.ok(
    res.headers
      .get('content-security-policy')
      .includes(`script-src 'sha256-${hash}'`)
  );
  assert.ok(
    !res.headers
      .get('content-security-policy')
      .includes("script-src 'unsafe-inline'")
  );
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.doesNotThrow(() => new vm.Script(source));
});

test('release record validation rejects nested, mismatched or tampered snapshots', () => {
  /** Independent candidate definition validated before any draft or publish transition. */
  const c = emptyTagContainer();
  c.governance = {
    release: 1,
    published: { ...c, id: 'different' },
    history: [
      {
        id: 1,
        at: new Date().toISOString(),
        action: 'initial',
        container: { ...c, id: 'different' },
      },
    ],
  };
  assert.throws(() => validateContainer(c));
  c.governance.published = { ...c };
  assert.throws(() => validateContainer(c), 'nested release loop rejected');
  /** Bounded release-summary fixture result. */
  const stats = releaseSummary(emptyTagContainer());
  assert.equal(stats.publishedRelease, 1);
});

test('live telemetry store/ID failures are warning-only; invalid caller values still fail validation', async (t) => {
  /** Fixed redacted diagnostic log; backend error text must be absent. */
  const warnings = [];
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({ onWarning: (message) => warnings.push(message) });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Owned runtime with explicitly failing synthetic storage dependencies. */
  const broken = createTagManager({
    analytics: {
      track: async () => {
        throw Error('DB down');
      },
    },
    requestIds: {
      reserve: async () => {
        throw Error('request store down');
      },
    },
    store: {
      load: async () => {
        throw Error('config DB down');
      },
      save: async () => false,
    },
    onWarning: (message) => warnings.push(message),
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await broken.close();
  });
  /** Synthetic missing/failed-reservation result, never a fabricated successful event. */
  const missing = await broken.createAstag()('event', 'checkout', {
    value: 100,
  });
  assert.deepEqual(missing.failures, ['request_id_unavailable']);
  /** Fixed fail-soft dispatch outcome from an unavailable synthetic store. */
  const evaluation = await broken.evaluate({
    name: 'checkout',
    properties: { value: 10 },
    source: 'server',
    requestId: createRequestId(),
    requestUtcDay: '2026-10-14',
  });
  assert.deepEqual(evaluation.failures, ['container_unavailable']);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => !w.includes('DB down')));
  assert.equal(
    (await a.runtime.createAstag()('event', 'view')).firedTags.length,
    1
  );
  await assert.rejects(
    a.runtime.createAstag()('event', 'bad event', {}),
    TypeError
  );
});

test('publishing refuses unresolved external sinks and prevents IPv6/local webhook targets', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Expected optimistic revision returned by a fixture draft save. */
  const rev = await draft(a, (c) =>
    c.tags.push({
      id: 'external',
      name: 'External',
      type: 'webhook',
      destinationRef: 'absent',
      triggerIds: ['all_events'],
    })
  );
  /** Fixed dispatch/HTTP outcome checked without echoing private backend data. */
  const outcome = await a.call('admin/publish', 'POST', {
    expectedVersion: rev,
  });
  assert.equal(outcome.status, 422);
  assert.equal((await a.runtime.published()).tags.length, 1);
  assert.throws(
    () => app({ destinations: { blocked: { url: 'https://[::1]/event' } } }),
    /public HTTPS DNS/
  );
  assert.throws(
    () =>
      app({ destinations: { blocked: { url: 'https://localhost./event' } } }),
    /public HTTPS DNS/
  );
});

test('retained release history is bounded and stale revision cannot overwrite published state', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  // Exceed retained history deliberately while checking every explicit CAS publication.
  for (let i = 0; i < 15; i++) {
    /** Current optimistic revision required for explicit publish/rollback. */
    const revision = await draft(a, (c) => (c.name = 'Release ' + i));
    assert.equal(
      (await a.call('admin/publish', 'POST', { expectedVersion: revision }))
        .status,
      200
    );
  }
  /** Validated bounded live/draft metadata, never full recipient/event payloads. */
  const summary = releaseSummary(await a.store.load());
  assert.ok(summary.history.length <= 12);
  assert.equal(summary.history.at(-1).id, summary.publishedRelease);
  assert.equal(
    (
      await a.call('admin/rollback', 'POST', {
        expectedVersion: 31,
        releaseId: 1,
      })
    ).status,
    422,
    'evicted history cannot be restored'
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(await a.store.load()), 'utf8') < 58_000
  );
});

test('registered variables interpolate bounded destination parameters without evaluating script', async (t) => {
  /** Synthetic analytics observations; no live database/provider acceptance is inferred. */
  const hits = [];
  /** Injected transport call log; no real Google/webhook/browser delivery occurs. */
  const calls = [];
  /** Independent bounded synthetic definition; mutations are explicit fixture setup only. */
  const container = emptyTagContainer();
  container.variables = [
    { id: 'cart_total', name: 'Cart total', type: 'event', key: 'total' },
    { id: 'channel', name: 'Channel', type: 'constant', value: 'web' },
  ];
  container.tags[0].parameters = {
    revenue: '{{cart_total}}',
    channel: '{{channel}}',
  };
  container.tags.push({
    id: 'hook',
    name: 'CRM',
    type: 'webhook',
    destinationRef: 'crm',
    triggerIds: ['all_events'],
    parameters: { total: '{{cart_total}}' },
  });
  /** Owned synthetic tag runtime; stores and analytics remain borrowed. */
  const runtime = createTagManager({
    analytics: {
      track: async (ev) => {
        hits.push(ev);
        return true;
      },
    },
    requestIds: createMemoryRequestIdStore(),
    container,
    destinations: { crm: { url: 'https://hooks.example.com/tag' } },
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    },
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await runtime.close();
  });
  /** Bounded declared dispatch/HTTP result whose fields are compared explicitly. */
  const result = await runtime.createAstag()('event', 'checkout', {
    total: 42,
  });
  assert.deepEqual(result.firedTags, ['internal_analytics', 'hook']);
  assert.equal(hits[0].properties.revenue, 42);
  assert.equal(hits[0].properties.channel, 'web');
  assert.equal(calls[0].parameters.total, 42);
  /** Deliberately malformed independent definition rejected before any write. */
  const invalid = structuredClone(container);
  invalid.tags[0].parameters.revenue = '{{not_registered}}';
  assert.throws(() => validateContainer(invalid), /parameter variable/);
  invalid.tags[0].parameters.revenue = '{{cart_total}}';
  invalid.tags[0].parameters.secret = '{{channel}};process.exit(1)';
  assert.throws(() => validateContainer(invalid), /parameter variable/);
});
