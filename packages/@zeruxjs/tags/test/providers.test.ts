import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTagManager,
  createTagProviderRegistry,
  createMemoryTagStore,
  emptyTagContainer,
  validateContainer,
  saveTagDraft,
  publishTagDraft,
  exportTagDefinition,
  importTagDefinition,
} from '../dist/index.js';
import {
  createMemoryRequestIdStore,
  createRequestId,
  requestUtcDay,
} from '@zeruxjs/analytics';
/** Synthetic bounded event with freshly generated opaque correlation ID.
 * @returns {object} Fresh bounded server event with opaque correlation ID.
 */
const event = () => ({
  name: 'purchase',
  site: 'shop',
  source: 'server',
  requestId: createRequestId(),
  requestUtcDay: requestUtcDay(),
  properties: { value: 10 },
});
/** Build a fresh explicit provider/group fixture without registration or dispatch.
 * @returns {object} Independent public definition with supported provider reference/version.
 */
function container() {
  /** Independent candidate definition validated before any draft or publish transition. */
  const c = emptyTagContainer();
  c.triggers.push(
    {
      id: 'sale',
      name: 'Sale',
      type: 'event',
      event: 'purchase',
      schemaVersion: 1,
    },
    {
      id: 'group',
      name: 'Purchase group',
      type: 'group',
      schemaVersion: 1,
      composition: { mode: 'all', triggerIds: ['all_events', 'sale'] },
    }
  );
  c.tags = [
    {
      id: 'plugin',
      name: 'Trusted plugin',
      type: 'provider',
      providerRef: 'crm',
      providerVersion: 1,
      publicConfig: { category: 'sale' },
      triggerIds: ['group'],
    },
  ];
  return c;
}
/** Register trusted synthetic provider code and create an owned manager over isolated stores.
 * @param {Function} dispatch - Trusted synthetic handler; not code from a saved definition.
 * @param {object} extra - Explicit fixture policy/transport overrides.
 * @returns {object} Owned manager/registry plus borrowed synthetic store and route helpers.
 */
function app(dispatch, extra = {}) {
  /** Owned explicit trusted-code registry; drain all borrowers before disposal. */
  const providers = createTagProviderRegistry();
  providers.register({
    id: 'crm',
    version: 1,
    config: { category: { type: 'string', required: true, values: ['sale'] } },
    destinations: ['crm'],
    dispatch,
  });
  /** Borrowed process-local CAS fixture store; memory is not durable cross-replica persistence. */
  const store = createMemoryTagStore(container());
  /** Owned synthetic tag runtime with explicit teardown after observations. */
  const rt = createTagManager({
    analytics: { track: async () => true },
    requestIds: createMemoryRequestIdStore(),
    site: 'shop',
    store,
    providers,
    ownProviders: true,
    destinations: { crm: { url: 'https://hooks.example.com/events' } },
    authorizeAdmin: (r) => r.headers.get('role') === 'editor',
    authorizePublish: (r) => r.headers.get('role') === 'editor',
    onWarning: () => {},
    ...extra,
  });
  /** In-memory exact-path route map; no dynamic endpoint discovery. */
  const routes = new Map(rt.routes().map((r) => [r.pattern, r.handler]));
  /** Invoke a declared in-memory route; synthetic role headers are fixture-only trusted host policy.
   * @param {string} path - Fixed declared fixture route suffix.
   * @param {unknown} body - Optional inert request body; presence selects POST.
   * @param {string} role - Fixture-only trusted role label, default editor.
   * @returns {Promise<Response>} Observed synthetic protected response.
   */
  const request = (path, body, role = 'editor') =>
    routes.get('/_tags/' + path)(
      new Request('https://host/_tags/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          role,
          origin: 'https://host',
          'content-type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    );
  return { providers, store, rt, request };
}
test('typed providers/groups resolve deterministic conditions with server-only code and public config', async (t) => {
  /** Explicit synthetic provider callback observations; configuration remains public scalar data. */
  const seen = [];
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app((ctx) => {
    seen.push(ctx.config.category);
    assert(Object.isFrozen(ctx.event.properties));
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.rt.close();
  });
  /** Bounded declared dispatch/HTTP result whose fields are compared explicitly. */
  const result = await a.rt.evaluate(event());
  assert.deepEqual(result.firedTags, ['plugin']);
  assert.deepEqual(seen, ['sale']);
  /** Generated published-only bootstrap or authored dashboard script checked in isolation. */
  const script = await (await a.request('ttag.js')).text();
  assert(!script.includes('dispatch('));
  assert(!script.includes('publicConfig'));
  /** Versioned inert transfer envelope; import alone cannot publish. */
  const envelope = exportTagDefinition(await a.store.load(), a.providers);
  assert.equal(
    importTagDefinition(envelope, a.providers).tags[0].providerVersion,
    1
  );
  await a.rt.close();
});
test('recursive/group complexity and executable or incompatible imports reject before publication changes', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app(() => {});
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.rt.close();
  });
  /** Independent candidate definition validated before any draft or publish transition. */
  const c = container();
  c.triggers[2].composition.triggerIds = ['group'];
  assert.throws(() => validateContainer(c), /Cyclic/);
  /** Independent malformed-version definition used for rejection assertions. */
  const v = container();
  v.triggers[0].schemaVersion = 2;
  assert.throws(() => validateContainer(v));
  assert.throws(() =>
    validateContainer({ ...container(), javascript: 'alert(1)' })
  );
  /** Deliberately invalid public definition that must reject before mutation. */
  const bad = container();
  bad.tags[0].providerVersion = 2;
  assert.throws(
    () =>
      importTagDefinition(
        JSON.stringify({
          format: 'zerux-tags',
          schemaVersion: 1,
          container: bad,
        }),
        a.providers
      ),
    /Unsupported/
  );
  assert.equal(
    (
      await a.request('admin/import', {
        expectedVersion: 1,
        definition: JSON.stringify({
          format: 'zerux-tags',
          schemaVersion: 1,
          container: bad,
        }),
      })
    ).status,
    422
  );
  assert.equal((await a.rt.published()).version, 1);
  assert.equal((await a.store.load()).version, 1);
  await a.rt.close();
});
test('draft import does not publish, is CAS/origin/tenant authorized, and preview never dispatches', async (t) => {
  let calls = 0;
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app(() => {
    calls++;
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.rt.close();
  });
  /** Independent draft candidate with explicit optimistic next revision. */
  const candidate = container();
  candidate.tags[0].enabled = false;
  /** Bounded inert exported definition, never an executable callback or publication command. */
  const definition = exportTagDefinition(candidate, a.providers);
  assert.equal(
    (
      await a.request(
        'admin/import',
        { expectedVersion: 1, definition },
        'visitor'
      )
    ).status,
    403
  );
  assert.equal(
    (await a.request('admin/import', { expectedVersion: 1, definition }))
      .status,
    200
  );
  assert.equal((await a.store.load()).version, 2);
  assert.equal((await a.rt.published()).tags[0].enabled, undefined);
  /** Pure authorized trigger dry-run result; no destinations execute. */
  const preview = await a.request('admin/preview', {
    name: 'purchase',
    mode: 'draft',
  });
  assert.equal((await preview.json()).candidateTags.length, 0);
  assert.equal(calls, 0);
  assert.equal(
    (await a.request('admin/publish', { expectedVersion: 2 })).status,
    200
  );
  assert.equal((await a.rt.evaluate(event())).firedTags.length, 0);
  /** Denied synthetic scope/identity request result. */
  const forged = await a.request('admin/preview', {
    name: 'purchase',
    site: 'other',
  });
  assert.equal(forged.status, 422);
  await a.rt.close();
});
test('fresh consent changes stop later tags and fixed site cannot be forged through server calls', async (t) => {
  let ready,
    finish,
    calls = 0;
  /** Synthetic handshake promise ensuring assertions occur after native work begins. */
  const started = new Promise((r) => (ready = r));
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app(async () => {
    ready();
    await new Promise((r) => (finish = r));
  });
  /** Independent candidate definition validated before any draft or publish transition. */
  const c = container();
  c.tags.push({
    id: 'after',
    name: 'After consent',
    type: 'analytics',
    triggerIds: ['all_events'],
  });
  await saveTagDraft(a.store, { ...c, version: 2 }, 1, a.providers);
  await publishTagDraft(a.store, 2, a.providers);
  /** Second owned synthetic manager or operation result used to test isolation. */
  const b = createTagManager({
    analytics: { track: async () => calls++ },
    requestIds: createMemoryRequestIdStore(),
    site: 'shop',
    store: a.store,
    providers: a.providers,
  });
  // Release deliberately held synthetic dependencies before draining on failed assertions.
  t.after(async () => {
    finish?.();
    try {
      await b.close();
    } finally {
      await a.rt.close();
    }
  });
  assert.throws(() => b.createAstag({ site: 'forged' }), /site mismatch/);
  /** Request-local server state with explicit fixture identity and mutable consent. */
  const astag = b.createAstag();
  await assert.rejects(astag('config', { site: 'forged' }), /site mismatch/);
  /** Observed in-flight synthetic event held while consent is revoked. */
  const sending = astag('event', 'purchase');
  await started;
  await astag('consent', 'denied');
  finish();
  await sending;
  assert.equal(calls, 0);
  await b.close();
  await a.rt.close();
});
test('approved destinations only, no retry on outage, fresh host consent gates preview', async (t) => {
  let sends = 0;
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app(
    async (ctx) => {
      await ctx.send('crm', { count: 1 });
    },
    {
      fetch: async () => {
        sends++;
        throw Error('private token and URL');
      },
    }
  );
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.rt.close();
  });
  /** Fixed dispatch/HTTP outcome checked without echoing private backend data. */
  const outcome = await a.rt.evaluate(event());
  assert.deepEqual(outcome.failures, ['plugin']);
  assert.equal(sends, 1);
  await a.rt.close();
  /** Second owned synthetic manager or operation result used to test isolation. */
  const b = app((ctx) => ctx.send('unapproved', { count: 1 }), {
    fetch: async () => {
      throw Error('must not open');
    },
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await b.rt.close();
  });
  assert.deepEqual((await b.rt.evaluate(event())).failures, ['plugin']);
  await b.rt.close();
  /** Independent candidate definition validated before any draft or publish transition. */
  const c = app(
    () => {
      throw Error('must not dispatch');
    },
    { allowDispatch: () => false }
  );
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await c.rt.close();
  });
  assert.equal(
    (await (await c.request('admin/preview', { name: 'purchase' })).json())
      .candidateTags.length,
    0
  );
  assert.equal((await c.rt.evaluate(event())).firedTags.length, 0);
  await c.rt.close();
});
test('deadline retains native capacity, reentrant calls reject, close drains detached sends and disposes', async (t) => {
  let ready,
    finish,
    closed = 0;
  /** Synthetic handshake promise ensuring assertions occur after native work begins. */
  const started = new Promise((r) => (ready = r));
  /** Owned explicit trusted-code registry; drain all borrowers before disposal. */
  const providers = createTagProviderRegistry();
  providers.register({
    id: 'crm',
    version: 1,
    config: { category: { type: 'string' } },
    destinations: ['crm'],
    dispose() {
      closed++;
    },
    async dispatch(ctx) {
      assert.deepEqual((await rt.evaluate(event())).failures, [
        'recursive_dispatch',
      ]);
      void ctx.send('crm', { count: 1 });
    },
  });
  /** Owned runtime initialized before the registered callback can dispatch. */
  const rt = createTagManager({
    analytics: { track: async () => true },
    requestIds: createMemoryRequestIdStore(),
    providers,
    ownProviders: true,
    container: container(),
    site: 'shop',
    maxConcurrentDispatches: 1,
    dispatchTimeoutMs: 10,
    destinations: { crm: { url: 'https://hooks.example.com/events' } },
    fetch: async () => {
      ready();
      await new Promise((r) => (finish = r));
      return new Response(null, { status: 204 });
    },
    onWarning: () => {},
  });
  // Release deliberately held synthetic dependencies before draining on failed assertions.
  t.after(async () => {
    finish?.();
    await rt.close();
  });
  /** Observed synthetic dispatch result whose timeout does not free native capacity. */
  const dispatch = rt.evaluate(event());
  await started;
  assert.deepEqual((await dispatch).failures, ['dispatch_cancelled']);
  assert.equal(rt.status().pending, 1);
  assert.deepEqual((await rt.evaluate(event())).failures, [
    'dispatch_overload',
  ]);
  /** Observed close promise retained until deliberately held native work is released. */
  const closing = rt.close();
  assert.equal(closed, 0);
  finish();
  await closing;
  assert.equal(closed, 1);
  assert.equal(rt.status().pending, 0);
  assert.deepEqual((await rt.evaluate(event())).failures, ['closed']);
});
test('provider sends are capped and schema fields/secrets/accessors fail at direct boundaries', async (t) => {
  let sends = 0;
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app(
    (ctx) => {
      // Attempt one send beyond the configured per-provider cap; excess must not open transport.
      for (let i = 0; i < 5; i++) {
        void ctx.send('crm', { count: i });
      }
    },
    {
      fetch: async () => {
        sends++;
        return new Response(null, { status: 204 });
      },
    }
  );
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.rt.close();
  });
  assert.deepEqual((await a.rt.evaluate(event())).failures, ['plugin']);
  assert.equal(sends, 4);
  await a.rt.close();
  /** Owned standalone provider registry; explicit versions and cleanup remain application responsibilities. */
  const registry = createTagProviderRegistry();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await registry.close();
  });
  assert.throws(
    () =>
      registry.register({
        id: 'unsafe',
        version: 1,
        config: { apiSecret: { type: 'string' } },
        dispatch() {},
      }),
    /public provider/
  );
  let read = false;
  /** Independent candidate definition validated before any draft or publish transition. */
  const c = container();
  Object.defineProperty(c.tags[0].publicConfig, 'category', {
    enumerable: true,
    get() {
      read = true;
      return 'sale';
    },
  });
  assert.throws(() => validateContainer(c), /accessors/);
  assert.equal(read, false);
  await registry.close();
});
test('provider/group editor script remains syntactically valid and public controls are explicit', async () => {
  /** Native VM parser used only to compile the emitted fixture script. */
  const { Script } = await import('node:vm');
  /** Direct authored dashboard fixture serializer, not a running admin server. */
  const { dashboard } = await import('../dist/dashboard.js');
  /** Serialized authenticated dashboard fixture; assertions check safe stored text and explicit mount. */
  const html = dashboard('/_tags');
  /** Script body extracted from the emitted dashboard markup for parser validation. */
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch?.[1]);
  new Script(scriptMatch[1]);
  assert(html.includes('Provider schema version'));
  assert(html.includes('Composition (JSON)'));
});
