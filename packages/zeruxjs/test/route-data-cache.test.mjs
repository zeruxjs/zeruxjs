import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryCacheHelper,
  createCacheManagerWithHelper,
} from '@zeruxjs/cache';
import {
  createRouteDataCache,
  routeDataCacheKey,
} from 'zeruxjs/route-data-cache';
/** Create an explicit tenant/principal route-data key.
 * @param {string} [tenant] - Verified synthetic tenant scope.
 * @param {string} [principal] - Synthetic principal scope.
 * @returns {object} Route, locale, parameters and authorization scope.
 */
const key = (tenant = 'a', principal = 'one') => ({
  route: 'product',
  path: '/products/1',
  params: { id: '1' },
  locale: 'en',
  scope: { tenant, principal },
});
/** Short synthetic fresh/stale windows and invalidation tag; no durable cache claim is made. */
const policy = { freshMs: 100, staleMs: 100, tags: ['products'] };
/** Create a process-local cache and its route-data coordinator with explicit ownership.
 * @param {object} extra - Optional synthetic clock and coordinator limits.
 * @returns {object} Borrowed-cache pair; close route before closing cache.
 */
function fixture(extra = {}) {
  /** Isolated memory cache owner closed after the route-cache coordinator drains. */
  const cache = createCacheManagerWithHelper(createMemoryCacheHelper());
  return {
    cache,
    route: createRouteDataCache({ application: 'test', cache, ...extra }),
  };
}
test('stable scoped keys, private response, fresh data copies and bounded lifecycle', async () => {
  /** Fixed clock keeps freshness assertions independent of wall time. */
  const now = 0;
  /** Paired fixture owners disposed in route-before-cache order. */
  const { cache, route } = fixture({ now: () => now });
  try {
    assert.equal(
      routeDataCacheKey('a', { ...key(), params: { b: '2', a: '1' } }),
      routeDataCacheKey('a', { ...key(), params: { a: '1', b: '2' } })
    );
    assert.notEqual(
      routeDataCacheKey('a', key()),
      routeDataCacheKey('a', key('b'))
    );
    let calls = 0;
    /** Produce a distinct load receipt for miss/coalescing assertions.
     * @returns {{n: number}} Incremented synthetic load count.
     */
    const load = () => ({ n: ++calls });
    /** Returned data clone deliberately mutated to prove stored cache values remain isolated. */
    const a = await route.load(key(), policy, load);
    a.value.n = 90;
    assert.equal((await route.load(key(), policy, load)).value.n, 1);
    assert.equal(a.response().policy.visibility, 'no-store');
    await route.load(key('b'), policy, load);
    assert.equal(calls, 2);
    assert.equal(route.invalidate({ tenant: 'a', tag: 'products' }), 1);
    assert.equal((await route.load(key('b'), policy, load)).state, 'fresh');
    await assert.rejects(route.load(key(), { ...policy, public: true }, load));
    assert.throws(() =>
      createRouteDataCache({
        application: 'x',
        cache,
        coordination: 'distributed',
      })
    );
  } finally {
    await route.close();
    await cache.close();
  }
  await assert.rejects(route.load(key(), policy, () => 1));
});
test('stale failure preserves stale until window closes; invalidation fences pending refresh', async () => {
  let now = 0;
  /** Paired fixture owners disposed in route-before-cache order. */
  const { cache, route } = fixture({ now: () => now });
  try {
    await route.load(key(), policy, () => 1);
    now = 100;
    assert.equal(
      (
        await route.load(key(), policy, () => {
          throw Error('backend');
        })
      ).state,
      'stale'
    );
    await new Promise((r) => setImmediate(r));
    now = 200;
    let release;
    /** In-flight refresh whose eventual result must be fenced by invalidation. */
    const pending = route.load(
      key(),
      policy,
      () => new Promise((r) => (release = r))
    );
    await new Promise((r) => setImmediate(r));
    route.invalidate({ tenant: 'a', path: '/products/1' });
    release(2);
    await assert.rejects(pending, /invalidated/);
    assert.equal((await route.load(key(), policy, () => 3)).value, 3);
  } finally {
    await route.close();
    await cache.close();
  }
});
test('coalescing, cancellation, refresh budget, outage and cleanup retain actual work', async () => {
  /** Paired fixture owners disposed in route-before-cache order. */
  const { cache, route } = fixture({ maxPending: 2 });
  let release;
  /** Original pending load retained until its ignored cancellation actually settles. */
  const first = route.load(
    key(),
    policy,
    () => new Promise((r) => (release = r))
  );
  await new Promise((r) => setImmediate(r));
  /** Caller cancellation controller that must not release another shared loader early. */
  const abort = new AbortController();
  /** Coalesced caller promise cancelled independently from the underlying load. */
  const second = route.load(key(), policy, () => 99, abort.signal);
  abort.abort();
  await assert.rejects(second);
  let drained = false;
  /** Drain promise checked before releasing the pending underlying loader. */
  const close = route.close().then(() => (drained = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(drained, false);
  release(1);
  await assert.rejects(first);
  await close;
  await cache.close();
  /** Coordinator over an injected unavailable cache, proving no silent bypass load occurs. */
  const broken = createRouteDataCache({
    application: 'x',
    cache: {
      /** Fail the injected cache read to verify outage behavior.
       * @returns {never} Throws the deliberate unavailable-cache failure.
       */
      get() {
        throw Error('offline');
      },
      /** Inert cache write unreachable after the deliberate read failure.
       * @returns {void} No storage mutation is performed.
       */
      set() {},
    },
  });
  let called = false;
  await assert.rejects(
    broken.load(key(), policy, () => {
      called = true;
      return 1;
    })
  );
  assert.equal(called, false);
  await broken.close();
});
test('public response ETags preserve conditional GET and anonymous opt-in', async () => {
  /** Public validator helper checked against the route-cache response projection. */
  const { conditionalEtag } = await import('zeruxjs/response');
  /** Paired fixture owners disposed in route-before-cache order. */
  const { cache, route } = fixture();
  try {
    /** Explicit tenant-only public key; no authenticated principal is serialized publicly. */
    const anonymous = { ...key(), scope: { tenant: 'a' } };
    /** Loaded public data and response policy used for conditional validator checks. */
    const data = await route.load(
      anonymous,
      { ...policy, public: true },
      () => ({ ok: true })
    );
    assert.equal(data.response().policy.visibility, 'public');
    /** Synthetic response header map preserving the generated representation validator. */
    const headers = new Map();
    /** Minimal response fixture recording the conditional 304 termination. */
    const res = {
      setHeader: (k, v) => headers.set(k, v),
      removeHeader: (k) => headers.delete(k),
      /** Record the synthetic conditional response termination.
       * @returns {void} Marks this response fixture ended.
       */
      end() {
        this.ended = true;
      },
    };
    /** Exact JSON representation bytes used consistently for both validator requests. */
    const body = Buffer.from(JSON.stringify(data.value));
    assert.equal(
      conditionalEtag({ method: 'GET', headers: {} }, res, body),
      false
    );
    assert.equal(
      conditionalEtag(
        { method: 'GET', headers: { 'if-none-match': headers.get('ETag') } },
        res,
        body
      ),
      true
    );
    assert.equal(res.statusCode, 304);
  } finally {
    await route.close();
    await cache.close();
  }
});
