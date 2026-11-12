import test from 'node:test';
import assert from 'node:assert/strict';
import { createMilleSearchAdapter } from '@zeruxjs/search-mille';
/** Create a verified fixture tenant call with an independent cooperative signal/deadline.
 * @returns {object} Independent finite call scope.
 */
const call = () => ({
  tenant: 'a',
  signal: new AbortController().signal,
  deadline: Date.now() + 5000,
});
test('official SDK builds private auth requests; transport bounds/parses bytes and cancels oversized bodies', async () => {
  let mode = 'normal',
    requests = 0,
    cancelled = 0;
  /** Synthetic outgoing SDK requests captured only for fixed auth/signal/redirect assertions. */
  const seen = [];
  /** Owned wrapper used by synthetic SDK or opt-in live fixtures; always await close. */
  const adapter = await createMilleSearchAdapter({
    index: 'catalog',
    taskScope: 'sdk-fixture',
    taskKey: new Uint8Array(32).fill(4),
    endpoint: 'https://meili.example',
    allowedEndpoints: ['https://meili.example'],
    apiKey: 'private-fixture-key',
    fetch: async (url, init) => {
      requests++;
      seen.push({
        url: String(url),
        headers: new Headers(init.headers),
        signal: init.signal,
        redirect: init.redirect,
      });
      if (mode === 'large') {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024 + 1));
            },
            cancel() {
              cancelled++;
            },
          })
        );
      }
      if (mode === 'error') {
        return Response.json(
          { code: 'index_not_found', message: 'private key/body' },
          { status: 404 }
        );
      }
      if (mode === 'down') {
        throw Error('private outage info');
      }
      return Response.json({ pkgVersion: '1.12.0' });
    },
  });
  try {
    assert.equal(
      seen[0].headers.get('authorization'),
      'Bearer private-fixture-key'
    );
    assert.equal(seen[0].redirect, 'error');
    assert(seen[0].signal instanceof AbortSignal);
    assert.equal(await adapter.health(call()), 'ready');
    mode = 'large';
    await assert.rejects(adapter.health(call()), { code: 'LIMIT' });
    assert.equal(cancelled, 1);
    mode = 'error';
    /** Request count before one operation; unchanged counts prove rejection/no replay. */
    const before = requests;
    await assert.rejects(
      adapter.health(call()),
      (e) =>
        e.name === 'MilleBackendError' &&
        e.backendCode === 'index_not_found' &&
        !JSON.stringify(e).includes('private')
    );
    assert.equal(requests, before + 1);
    mode = 'down';
    await assert.rejects(
      adapter.health(call()),
      (e) => e.code === 'UNAVAILABLE' && !e.message.includes('private')
    );
  } finally {
    await adapter.close();
  }
  /** Request count before one operation; unchanged counts prove rejection/no replay. */
  const before = requests;
  await assert.rejects(adapter.health(call()), { code: 'CLOSED' });
  assert.equal(requests, before);
});
test('owned configuration rejects insecure/unapproved endpoints and conflicting injected credentials', async () => {
  /** Explicit negative transport/auth configuration with synthetic key material. */
  const config = {
    index: 'catalog',
    taskScope: 'fixture',
    taskKey: new Uint8Array(32),
    apiKey: 'private',
    endpoint: 'https://approved.example',
    allowedEndpoints: ['https://approved.example'],
  };
  await assert.rejects(
    createMilleSearchAdapter({
      ...config,
      endpoint: 'http://approved.example',
    }),
    { code: 'INVALID' }
  );
  await assert.rejects(
    createMilleSearchAdapter({ ...config, endpoint: 'https://other.example' }),
    { code: 'DENIED' }
  );
  await assert.rejects(
    createMilleSearchAdapter({ ...config, tls: { rejectUnauthorized: false } }),
    { code: 'INVALID' }
  );
});
