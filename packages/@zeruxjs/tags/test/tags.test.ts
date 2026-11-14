import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import {
  createTagManager,
  createMemoryTagStore,
  emptyTagContainer,
  browserScript,
  validateContainer,
} from '../dist/index.js';
import {
  createMemoryRequestIdStore,
  createRequestId,
  requestUtcDay,
} from '@zeruxjs/analytics';
/** Synthetic analytics recorder; no external provider or personal-data store is contacted.
 * @returns {object} Isolated observation list and borrowed recorder with no native connection.
 */
const analytics = () => {
  /** Synthetic analytics observations; no live database/provider acceptance is inferred. */
  const hits = [];
  return {
    hits,
    manager: {
      track: async (ev) => {
        hits.push(ev);
        return 'persisted';
      },
    },
  };
};
test('default tag container records server events and exposes astag commands', async (t) => {
  /** Isolated synthetic analytics observations and borrowed recorder. */
  const { hits, manager } = analytics();
  /** Owned synthetic tag runtime; stores and analytics remain borrowed. */
  const runtime = createTagManager({
    analytics: manager,
    requestIds: createMemoryRequestIdStore(),
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await runtime.close();
  });
  /** Request-local server state with explicit fixture identity and mutable consent. */
  const astag = runtime.createAstag({ site: 'main', sessionId: 'anon1' });
  assert.equal(await astag('set', 'color', 'blue'), true);
  assert.equal(await astag('get', 'color'), 'blue');
  await astag('config', { pathname: '/test' });
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = await astag('event', 'purchase', { amount: 8 });
  /** Second owned synthetic manager or operation result used to test isolation. */
  const b = await astag('event', 'step', { step: 2 });
  assert.equal(a.requestId, b.requestId);
  assert.equal(a.requestId.length, 16);
  assert.equal(hits[0].properties.amount, 8);
  assert.equal(hits[0].site, 'main');
  assert.equal(hits[0].requestUtcDay, requestUtcDay());
  assert.equal(await astag('consent', 'denied'), true);
  assert.equal(await astag('event', 'blocked'), undefined);
  assert.equal(hits.length, 2);
});
test('collector route fires matching triggers only, echoes ID, and does not store replay', async (t) => {
  /** Isolated synthetic analytics observations and borrowed recorder. */
  const { hits, manager } = analytics();
  /** Independent bounded synthetic definition; mutations are explicit fixture setup only. */
  const container = emptyTagContainer();
  container.triggers = [
    {
      id: 'purchase',
      name: 'Purchase',
      type: 'event',
      event: 'purchase',
      conditions: [{ field: 'value', operator: 'gte', value: 10 }],
    },
  ];
  container.tags[0].triggerIds = ['purchase'];
  /** Owned synthetic tag runtime; stores and analytics remain borrowed. */
  const runtime = createTagManager({
    analytics: manager,
    requestIds: createMemoryRequestIdStore(),
    container,
    allowedOrigins: ['https://host.test'],
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await runtime.close();
  });
  /** Select a fixed declared route without starting a listener. */
  const route = runtime.routes().find((x) => x.pattern === '/_tags/collect');
  /** Fresh synthetic request correlation or local callback identifier. */
  const id = createRequestId();
  /** Construct a synthetic protected request with explicit method/origin/role controls.
   * @param {string} name - Synthetic event name.
   * @param {number} value - Scalar event value used by the comparison condition.
   * @returns {Request} In-memory collector request carrying the chosen fixed correlation ID.
   */
  const req = (name, value) =>
    new Request('https://host.test/_tags/collect', {
      method: 'POST',
      headers: {
        origin: 'https://host.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestId: id, name, properties: { value } }),
    });
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = await route.handler(req('purchase', 12));
  assert.equal(a.status, 204);
  assert.equal(a.headers.get('x-zerux-request-id'), id);
  assert.equal(hits.length, 1);
  /** Repeated synthetic request result checked against durable-reservation semantics. */
  const duplicate = await route.handler(req('purchase', 12));
  assert.equal(duplicate.status, 409);
  assert.equal(hits.length, 1);
  /** Synthetic missing/failed-reservation result, never a fabricated successful event. */
  const missing = await route.handler(
    new Request('https://host.test/_tags/collect', {
      method: 'POST',
      headers: {
        origin: 'https://host.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'purchase', properties: { value: 12 } }),
    })
  );
  assert.equal(missing.status, 422);
});
test('external GA4 and allowlisted webhook tags use server secrets; bad destination isolated', async (t) => {
  /** Isolated synthetic analytics observations and borrowed recorder. */
  const { hits, manager } = analytics();
  /** Independent bounded synthetic definition; mutations are explicit fixture setup only. */
  const container = emptyTagContainer();
  /** Injected transport call log; no real Google/webhook/browser delivery occurs. */
  const calls = [];
  container.tags.push({
    id: 'ga4',
    name: 'GA4',
    type: 'ga4',
    measurementId: 'G-ABC1234',
    credentialRef: 'google',
    triggerIds: ['all_events'],
  });
  container.tags.push({
    id: 'external',
    name: 'Webhook',
    type: 'webhook',
    destinationRef: 'crm',
    triggerIds: ['all_events'],
  });
  container.tags.push({
    id: 'broken',
    name: 'Bad',
    type: 'webhook',
    destinationRef: 'missing',
    triggerIds: ['all_events'],
  });
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: manager,
    requestIds: createMemoryRequestIdStore(),
    container,
    credentials: { google: { secret: 'private-api-secret' } },
    destinations: { crm: { url: 'https://example.com/collect' } },
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await rt.close();
  });
  /** Synthetic route response checked for privacy, status and fixed headers. */
  const res = await rt.createAstag({ sessionId: 'anon123' })(
    'event',
    'purchase',
    { amount: 25 }
  );
  assert.deepEqual(res.firedTags, ['internal_analytics', 'ga4', 'external']);
  assert.deepEqual(res.failures, ['broken']);
  assert.equal(hits.length, 1);
  assert.ok(calls[0].url.includes('api_secret=private-api-secret'));
  assert.equal(calls[0].body.client_id, 'anon123');
  assert.equal(calls[1].url, 'https://example.com/collect');
  assert.equal(
    JSON.stringify(await rt.container()).includes('private-api-secret'),
    false
  );
});
test('tag authorizer required; versioned dashboard editing and CSRF guarded', async (t) => {
  /** Borrowed synthetic analytics recorder with no native connection. */
  const { manager } = analytics();
  /** Borrowed process-local CAS fixture store; memory is not durable cross-replica persistence. */
  const store = createMemoryTagStore(emptyTagContainer());
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: manager,
    requestIds: createMemoryRequestIdStore(),
    store,
    authorizeAdmin: (req) => req.headers.get('x-session') === 'valid',
    dashboardHost: 'tag.example.com',
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await rt.close();
  });
  /** Fixed protected API route selected from the synthetic runtime declarations. */
  const api = rt.routes().find((x) => x.pattern === '/_tags/admin/api');
  /** Construct a synthetic protected request with explicit method/origin/role controls.
   * @param {string} method - Explicit protected operation method.
   * @param {unknown} body - Optional inert candidate definition.
   * @param {string} origin - Explicit synthetic Origin, default configured API origin.
   * @param {string} session - Synthetic host session assertion for this test only.
   * @returns {Request} In-memory protected administration request.
   */
  const req = (
    method,
    body,
    origin = 'https://tag.example.com',
    session = 'valid'
  ) =>
    new Request('https://tag.example.com/_tags/admin/api', {
      method,
      headers: {
        'x-session': session,
        origin,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (await api.handler(req('GET', null, undefined, 'invalid'))).status,
    403
  );
  /** Loaded validated current revision captured before proposing an optimistic edit. */
  const current = await (await api.handler(req('GET'))).json();
  current.version++;
  assert.equal(
    (await api.handler(req('PUT', current, 'https://attacker.com'))).status,
    403
  );
  assert.equal((await api.handler(req('PUT', current))).status, 200);
  assert.equal((await api.handler(req('PUT', current))).status, 409);
  /** Select a fixed declared route without starting a listener. */
  const route = rt.routes().find((x) => x.pattern === '/_tags/admin');
  assert.equal(
    (
      await route.handler(
        new Request('https://elsewhere.com/_tags/admin', {
          headers: { 'x-session': 'valid' },
        })
      )
    ).status,
    404
  );
});
test('browser ttag + dataLayer deliver 16-char IDs via sendBeacon, flush at hidden', async () => {
  /** Synthetic Beacon/Fetch output log; no operating-system/network delivery occurs. */
  const sent = [];
  /** Explicit synthetic event callback registry, not native browser lifecycle qualification. */
  const listeners = {};
  /** Isolated VM window double; no live browser or user application is exercised. */
  const window = {
    dataLayer: [{ event: 'boot', properties: { ready: true } }],
    crypto: webcrypto,
    addEventListener: (e, fn) => (listeners[e] = fn),
    console,
  };
  /** Synthetic DOM/event document owned by this fixture. */
  const document = {
    visibilityState: 'visible',
    addEventListener: (e, fn) => (listeners[e] = fn),
  };
  /** Injected VM/native context exposing only explicit synthetic browser capabilities. */
  const ctx = {
    window,
    document,
    navigator: {
      sendBeacon: (url, blob) => {
        sent.push({ url, blob });
        return true;
      },
    },
    Blob,
    Promise,
    Uint8Array,
    location: { pathname: '/home' },
    console,
  };
  vm.runInNewContext(
    browserScript({ endpoint: '/_tags/collect', site: 'demo', debug: false }),
    ctx
  );
  /** Fresh synthetic request correlation or local callback identifier. */
  const id = window.ttag('event', 'click', { label: 'save' });
  assert.match(id, /^[A-Za-z0-9]{16}$/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 2);
  /** Decoded synthetic Beacon payload, not proof of browser/provider acceptance. */
  const sample = JSON.parse(await sent[1].blob.text());
  assert.equal(sample.requestId, id);
  assert.equal(sample.site, 'demo');
  assert.equal(sample.name, 'click');
  window.ttag('set', 'campaign', 'spring');
  /** Second opaque synthetic event ID used to check independent delivery. */
  const id2 = window.ttag('event', 'view', { a: 2 });
  listeners.pagehide();
  /** Decoded final queued synthetic event used to inspect bounded public state. */
  const last = JSON.parse(await sent[2].blob.text());
  assert.equal(last.requestId, id2);
  assert.equal(last.data.campaign, 'spring');
});
test('rejects duplicate IDs and prohibited/untrusted tag shapes', () => {
  /** Deliberately invalid public definition that must reject before mutation. */
  const bad = emptyTagContainer();
  bad.tags[0].triggerIds = ['missing'];
  assert.throws(() => validateContainer(bad));
  assert.throws(() =>
    createTagManager({
      analytics: analytics().manager,
      requestIds: createMemoryRequestIdStore(),
      destinations: { bad: { url: 'http://127.0.0.1/p' } },
    })
  );
});
test('cross-origin subdomain beacon is CORS-simple text/plain and keeps ID correlation', async (t) => {
  /** Borrowed synthetic analytics recorder and isolated observation log. */
  const { manager, hits } = analytics();
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: manager,
    requestIds: createMemoryRequestIdStore(),
    publicOrigin: 'https://tags.example.com',
    allowedOrigins: ['https://app.example.com'],
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await rt.close();
  });
  /** Generated self-contained script fixture compiled/executed only in isolated VM/jsdom. */
  const js = await rt
    .routes()
    .find((x) => x.pattern === '/_tags/ttag.js')
    .handler(new Request('https://tags.example.com/_tags/ttag.js'));
  assert.match(
    await js.text(),
    /"https:\/\/tags\.example\.com\/_tags\/collect"/
  );
  /** Construct a synthetic protected request with explicit method/origin/role controls. */
  const req = new Request('https://tags.example.com/_tags/collect', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.com',
      'content-type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify({
      name: 'page_view',
      requestId: createRequestId(),
      properties: { name: 'welcome' },
    }),
  });
  /** Synthetic route response checked for privacy, status and fixed headers. */
  const res = await rt
    .routes()
    .find((x) => x.pattern === '/_tags/collect')
    .handler(req);
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    'https://app.example.com'
  );
  assert.equal(hits.length, 1);
});
test('admin dry-run reports trigger matches without recording or firing network tags', async (t) => {
  /** Borrowed synthetic analytics recorder and isolated observation log. */
  const { manager, hits } = analytics();
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: manager,
    requestIds: createMemoryRequestIdStore(),
    authorizeAdmin: () => true,
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await rt.close();
  });
  /** Pure authorized trigger dry-run result; no destinations execute. */
  const preview = rt.routes().find((x) => x.pattern === '/_tags/admin/preview');
  /** Construct a synthetic protected request with explicit method/origin/role controls. */
  const req = new Request('https://app.test/_tags/admin/preview', {
    method: 'POST',
    headers: { origin: 'https://app.test', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'purchase', properties: { value: 123 } }),
  });
  /** Bounded declared dispatch/HTTP result whose fields are compared explicitly. */
  const result = await (await preview.handler(req)).json();
  assert.deepEqual(result.matchedTriggers, ['all_events']);
  assert.equal(result.candidateTags[0].id, 'internal_analytics');
  assert.equal(hits.length, 0);
});
test('published automatic click and pageview triggers use Beacon without extracting form values', async (t) => {
  /** Independent bounded synthetic definition; mutations are explicit fixture setup only. */
  const container = emptyTagContainer();
  container.triggers = [
    { id: 'click_trigger', name: 'Click', type: 'click' },
    { id: 'page_trigger', name: 'Page', type: 'pageview' },
  ];
  container.tags[0].triggerIds = ['click_trigger', 'page_trigger'];
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: analytics().manager,
    requestIds: createMemoryRequestIdStore(),
    container,
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await rt.close();
  });
  /** Generated published-only bootstrap or authored dashboard script checked in isolation. */
  const script = await (
    await rt
      .routes()
      .find((r) => r.pattern === '/_tags/ttag.js')
      .handler(new Request('https://app.test/_tags/ttag.js'))
  ).text();
  /** Synthetic Beacon/Fetch output log; no operating-system/network delivery occurs. */
  const sent = [];
  /** Explicit synthetic event callback registry, not native browser lifecycle qualification. */
  const listeners = {};
  /** Isolated synthetic window with explicitly supplied native capabilities. */
  const win = {
    crypto: webcrypto,
    addEventListener: (k, fn) => (listeners['window:' + k] = fn),
  };
  /** Synthetic document with explicit event listeners; no live browser/AT behavior is implied. */
  const doc = { addEventListener: (k, fn) => (listeners[k] = fn) };
  vm.runInNewContext(script, {
    window: win,
    document: doc,
    navigator: {
      sendBeacon: (url, blob) => {
        sent.push(blob);
        return true;
      },
    },
    location: { pathname: '/home' },
    Uint8Array,
    Blob,
    Promise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(await sent[0].text()).name, 'page_view');
  listeners.click({
    target: {
      closest: () => ({
        tagName: 'A',
        id: 'checkout-link',
        textContent: 'PRIVATE',
      }),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  /** Decoded synthetic click event checked for omission of private text/form content. */
  const click = JSON.parse(await sent[1].text());
  assert.equal(click.name, 'click');
  assert.equal(click.properties.element, 'a');
  assert.ok(!JSON.stringify(click).includes('PRIVATE'));
});
test('default denied telemetry switch suppresses bootstrap events without coupling to marketing consent', async (t) => {
  /** Independent bounded synthetic definition; mutations are explicit fixture setup only. */
  const container = emptyTagContainer();
  container.triggers = [{ id: 'page_trigger', name: 'Page', type: 'pageview' }];
  container.tags[0].triggerIds = ['page_trigger'];
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: analytics().manager,
    requestIds: createMemoryRequestIdStore(),
    container,
    defaultConsent: 'denied',
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await rt.close();
  });
  /** Generated published-only bootstrap or authored dashboard script checked in isolation. */
  const script = await (
    await rt
      .routes()
      .find((r) => r.pattern === '/_tags/ttag.js')
      .handler(new Request('https://app.test/_tags/ttag.js'))
  ).text();
  /** Synthetic Beacon/Fetch output log; no operating-system/network delivery occurs. */
  const sent = [];
  /** Explicit synthetic event callback registry, not native browser lifecycle qualification. */
  const listeners = {};
  /** Isolated synthetic window with explicitly supplied native capabilities. */
  const win = {
    crypto: webcrypto,
    addEventListener: (k, f) => (listeners[k] = f),
  };
  vm.runInNewContext(script, {
    window: win,
    document: { addEventListener: (k, f) => (listeners[k] = f) },
    navigator: {
      sendBeacon: (u, b) => {
        sent.push(b);
        return true;
      },
    },
    location: { pathname: '/' },
    Uint8Array,
    Blob,
    Promise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 0);
  win.ttag('consent', 'granted');
  win.ttag('event', 'custom', { ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
});
