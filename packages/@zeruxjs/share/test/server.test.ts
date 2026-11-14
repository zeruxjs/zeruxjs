import test from 'node:test';
import assert from 'node:assert/strict';
import { createShortLinkService } from '@zeruxjs/share/server';
/** Construct synthetic verified host context, not a production authenticator.
 * @param {string} tenant - Synthetic tenant label, default t1.
 * @param {string} subject - Synthetic owner label, default u1.
 * @returns {object} Synthetic host context for authorization fixtures.
 */
const context = (tenant = 't1', subject = 'u1') => ({ tenant, subject });
/** Create isolated synthetic dependencies and an owned service wrapper.
 * @param {object} extra - Explicit test overrides for policy and dependency failures.
 * @returns {object} Config, borrowed map/store and owned service requiring close.
 */
function fixture(extra = {}) {
  /** Process-local fixture map implementing reservation/CAS semantics only, never production durability. */
  const data = new Map();
  /** Synthetic store dependency borrowed by each service; map state survives wrapper close. */
  const store = {
    capability: 'short-links-cas-v1',
    durable: true,
    async reserve(key, value) {
      if (data.has(key)) {
        return false;
      }
      data.set(key, structuredClone(value));
      return true;
    },
    async read(key) {
      return structuredClone(data.get(key) ?? null);
    },
    async compareAndSwap(key, revision, next) {
      if (data.get(key)?.revision !== revision) {
        return false;
      }
      data.set(key, structuredClone(next));
      return true;
    },
  };
  /** Explicit synthetic origin, destination allowlist, store and host verifier configuration. */
  const config = {
    origin: 'https://sho.rt',
    allowedOrigins: ['https://example.test'],
    store,
    authorize: async (value) =>
      value?.tenant && value?.subject ? value : null,
    ...extra,
  };
  return { config, store, data, service: createShortLinkService(config) };
}
/** Construct a public request without opening a socket.
 * @param {string} slug - Fixture reservation slug.
 * @returns {Request} In-memory Fetch request at the fixed test origin.
 */
const request = (slug) => new Request('https://sho.rt/s/' + slug);
test('create-only races, high entropy, tenant/owner checks, CAS edits and irrevocable tombstones', async () => {
  /** Owned synthetic short-link service fixture; close drains its dependency work. */
  const f = fixture();
  /** Second owned wrapper sharing the same fixture store for reservation/CAS races. */
  const other = createShortLinkService(f.config);
  try {
    /** Settled concurrent reservation outcomes, including the expected conflict. */
    const results = await Promise.allSettled([
      f.service.create(context(), {
        slug: 'shared',
        destination: 'https://example.test/a',
      }),
      other.create(context(), {
        slug: 'shared',
        destination: 'https://example.test/b',
      }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'CONFLICT'
    );
    /** One successfully reserved record selected from the concurrent attempts. */
    const created = results.find((r) => r.status === 'fulfilled').value;
    await assert.rejects(f.service.get(context('t2'), created.slug), {
      code: 'DENIED',
    });
    await assert.rejects(
      f.service.edit(context('t1', 'other'), created.slug, {
        expectedRevision: created.revision,
        destination: 'https://example.test/c',
      }),
      { code: 'DENIED' }
    );
    /** Committed edit revision used to test stale conflicts and revocation. */
    const next = await f.service.edit(context(), created.slug, {
      expectedRevision: created.revision,
      destination: 'https://example.test/c',
    });
    await assert.rejects(
      other.edit(context(), created.slug, {
        expectedRevision: created.revision,
        destination: 'https://example.test/d',
      }),
      { code: 'CONFLICT' }
    );
    await f.service.revoke(context(), created.slug, next.revision);
    assert.equal((await other.handler(request(created.slug))).status, 404);
    await assert.rejects(
      f.service.create(context(), {
        slug: created.slug,
        destination: 'https://example.test/new',
      }),
      { code: 'CONFLICT' }
    );
    /** Committed generated-slug record; assertions check entropy length and default redirect policy. */
    const random = await f.service.create(context(), {
      destination: 'https://example.test/a',
    });
    assert.match(random.slug, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(random.status, 302);
    assert.equal(
      (await f.service.handler(request(random.slug))).headers.get(
        'cache-control'
      ),
      'no-store'
    );
  } finally {
    try {
      await f.service.close();
    } finally {
      await other.close();
    }
  }
});
test('expiry boundary and deliberate permanent caching policy; malicious/reserved destinations and paths deny', async () => {
  let now = 1000;
  /** Owned synthetic short-link service fixture; close drains its dependency work. */
  const f = fixture({ now: () => now, permanentCacheSeconds: 3600 });
  try {
    /** Synthetic-clock reservation with an explicit short lifetime. */
    const expiring = await f.service.create(context(), {
      slug: 'expires',
      destination: 'https://example.test/a',
      expiresAt: 2000,
    });
    now = 2000;
    assert.equal((await f.service.handler(request(expiring.slug))).status, 404);
    await assert.rejects(
      f.service.create(context(), {
        slug: 'cached',
        destination: 'https://example.test/a',
        status: 301,
      }),
      { code: 'DENIED' }
    );
    /** Explicit immutable, nonrevocable, nonexpiring permanent redirect fixture. */
    const permanent = await f.service.create(context(), {
      slug: 'cached',
      destination: 'https://example.test/a',
      status: 308,
      editable: false,
      revocable: false,
      expiresAt: null,
    });
    /** Synthetic handler response checked for status, cache policy or cancellation behavior. */
    const response = await f.service.handler(request(permanent.slug));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    await assert.rejects(
      f.service.edit(context(), permanent.slug, {
        expectedRevision: permanent.revision,
        destination: 'https://example.test/b',
      }),
      { code: 'DENIED' }
    );
    await assert.rejects(
      f.service.revoke(context(), permanent.slug, permanent.revision),
      { code: 'DENIED' }
    );
    // Exercise each reserved or malformed path independently.
    for (const slug of ['admin', 'api', '../secret', 'a%2fb', 'foo/bar']) {
      await assert.rejects(
        f.service.create(context(), {
          slug,
          destination: 'https://example.test/a',
        })
      );
    }
    // Keep destination-policy rejection independent of slug validation.
    for (const destination of [
      'javascript:alert(1)',
      'https://user:pass@example.test/',
      'https://evil.test/',
    ]) {
      await assert.rejects(f.service.create(context(), { destination }));
    }
    assert.equal(
      (
        await f.service.handler(
          new Request('https://evil.test/s/cached', {
            headers: { 'x-forwarded-host': 'sho.rt' },
          })
        )
      ).status,
      421
    );
    assert.equal(
      (
        await f.service.handler(
          new Request('https://sho.rt/s/cached', {
            headers: { host: 'evil.test' },
          })
        )
      ).status,
      421
    );
    assert.equal(
      (
        await f.service.handler(
          new Request('https://sho.rt/s/cached', { method: 'POST' })
        )
      ).status,
      405
    );
  } finally {
    await f.service.close();
  }
  /** Owned root-mounted fixture with explicit application-path reservations. */
  const root = fixture({ prefix: '/', reservedPaths: ['/app'] });
  try {
    await assert.rejects(
      root.service.create(context(), {
        slug: 'app',
        destination: 'https://example.test/a',
      })
    );
    /** Current authorized reservation used by the assertion, not a browser identity claim. */
    const value = await root.service.create(context(), {
      slug: 'short',
      destination: 'https://example.test/a',
    });
    assert.equal(
      (
        await root.service.handler(
          new Request('https://sho.rt/short?next=https://evil.test')
        )
      ).headers.get('location'),
      'https://example.test/a'
    );
    assert.equal(value.url, 'https://sho.rt/short');
  } finally {
    await root.service.close();
  }
});
test('fresh destination policy and consented pseudonymous analytics are isolated from redirect outcome', async () => {
  let allowed = true,
    consent = false;
  /** Consent-gated pseudonymous analytics fixture records; raw destinations must be absent. */
  const events = [];
  /** Owned synthetic short-link service fixture; close drains its dependency work. */
  const f = fixture({
    allowDestination: () => allowed,
    analytics: {
      key: new Uint8Array(32).fill(9),
      consent: () => consent,
      record: (event) => {
        events.push(event);
        throw Error('private backend failure');
      },
    },
  });
  try {
    /** Committed synthetic reservation used for repeated consent and policy checks. */
    const link = await f.service.create(context(), {
      slug: 'clicks',
      destination: 'https://example.test/a',
    });
    assert.equal((await f.service.handler(request(link.slug))).status, 302);
    await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 0);
    consent = true;
    assert.equal((await f.service.handler(request(link.slug))).status, 302);
    await new Promise((r) => setImmediate(r));
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'redirect');
    assert.match(events[0].link, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(Object.keys(events[0]).sort(), [
      'action',
      'day',
      'link',
      'schema',
    ]);
    assert(!JSON.stringify(events[0]).includes('example.test'));
    assert.equal(f.service.status().analyticsErrors, 1);
    allowed = false;
    assert.equal((await f.service.handler(request(link.slug))).status, 503);
  } finally {
    await f.service.close();
  }
});
test('backend failure redaction, unknown reservation acknowledgement, cancellation slots and borrowed cleanup', async (t) => {
  /** Owned synthetic short-link service fixture; close drains its dependency work. */
  const f = fixture();
  f.store.reserve = async () => {
    throw Error('private storage key');
  };
  try {
    await assert.rejects(
      f.service.create(context(), {
        slug: 'unknown',
        destination: 'https://example.test/a',
      }),
      (e) =>
        e.code === 'UNAVAILABLE' &&
        e.outcome === 'unknown' &&
        e.uncertainSlug === 'unknown' &&
        !e.message.includes('private')
    );
  } finally {
    await f.service.close();
  }
  let finish, signal;
  /** Owned deadline-limited wrapper with a deliberately held native read. */
  const b = fixture({ timeoutMs: 10, maxPending: 1 });
  // Release held dependency work even if an assertion fails before the explicit close.
  t.after(async () => {
    finish?.(null);
    await b.service.close();
  });
  b.store.read = async (_key, input) => {
    signal = input;
    return new Promise((r) => (finish = r));
  };
  /** Synthetic handler response checked for status, cache policy or cancellation behavior. */
  const response = await b.service.handler(request('blocked'));
  assert.equal(response.status, 503);
  assert(signal.aborted);
  assert.equal(b.service.status().pending, 1);
  assert.equal((await b.service.handler(request('blocked'))).status, 503);
  let closed = false;
  /** Observed service close promise used to prove actual-settlement drain behavior. */
  const closing = b.service.close().then(() => (closed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  finish(null);
  await closing;
  assert.equal(b.service.status().pending, 0);
});
test('server policy rejects false durable claims/namespace conflicts and getters before invocation', () => {
  /** Owned synthetic short-link service fixture; close drains its dependency work. */
  const f = fixture();
  assert.throws(() =>
    createShortLinkService({
      ...f.config,
      store: { ...f.store, durable: false },
    })
  );
  assert.throws(() =>
    createShortLinkService({ ...f.config, prefix: '/api/s/' })
  );
  let invoked = false;
  /** Accessor-bearing untrusted fixture whose getter must not execute. */
  const analytics = {
    key: new Uint8Array(32),
    consent: () => true,
    get record() {
      invoked = true;
      return () => {};
    },
  };
  assert.throws(() => createShortLinkService({ ...f.config, analytics }));
  assert.equal(invoked, false);
  return f.service.close();
});

test('URL-safe leading underscore/dash slugs remain usable while framework names stay reserved', async () => {
  /** Owned synthetic short-link service fixture; close drains its dependency work. */
  const f = fixture();
  try {
    for (const slug of ['_valid', '-valid']) {
      await f.service.create(context(), {
        slug,
        destination: 'https://example.test/a',
      });
      assert.equal((await f.service.handler(request(slug))).status, 302);
    }
    await assert.rejects(
      f.service.create(context(), {
        slug: '_actions',
        destination: 'https://example.test/a',
      }),
      { code: 'DENIED' }
    );
  } finally {
    await f.service.close();
  }
});
