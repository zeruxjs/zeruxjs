import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable, PassThrough } from 'node:stream';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createCompressionOwner } from 'zhost/compression';
import { forwardPerformanceResponse } from '@zeruxjs/performance/response';
/** Fixed synthetic 1000-record JSON workload, not personal application data. */
const body = Buffer.from(
  JSON.stringify({
    items: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      label: 'repeatable public catalog item',
    })),
  })
);
/** Start one owned ephemeral loopback compression fixture using synthetic bytes only.
 * @returns {Promise<object>} Owner/server/request helpers plus awaited close; no user app is started.
 */
async function fixture() {
  /** Bounded fixture-local compression observations without URLs or private causes. */
  const measurements = [];
  /** Owned compression coordinator; close before the synthetic HTTP server is released. */
  const owner = createCompressionOwner({
    encodings: ['br', 'gzip'],
    maxConcurrent: 1,
    onMeasure: (m) => {
      measurements.push(m);
      throw Error('ignored observation failure');
    },
  });
  let held;
  /** Owned ephemeral loopback server with only synthetic routes; never a user app. */
  const server = http.createServer((req, res) => {
    /** Owned synthetic response stream or emitted JavaScript being inspected, never untrusted executable input. */
    const source =
      req.url === '/hold'
        ? (held = new PassThrough())
        : Readable.from(
            req.url === '/failure'
              ? (async function* () {
                  yield 'first';
                  throw Error('private cause');
                })()
              : [body]
          );
    source.headers = {
      'content-type': 'application/json',
      'content-length': String(body.length),
      etag: '"identity"',
      'content-digest': 'sha-256=:fixture:',
      'cache-control': 'public, max-age=60',
    };
    if (req.url === '/no-transform') {
      source.headers['cache-control'] = 'public, no-transform';
    }
    if (req.url === '/encoded') {
      source.headers['content-encoding'] = 'gzip';
    }
    if (req.url === '/range') {
      source.statusCode = 206;
      source.headers['content-range'] =
        `bytes 0-${body.length - 1}/${body.length}`;
    }
    if (req.url === '/304') {
      source.statusCode = 304;
    }
    forwardPerformanceResponse(owner, req, source, res, {
      authenticated: req.url === '/private',
      public: req.url !== '/private',
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  /** Ephemeral fixture-selected loopback port, unrelated to user-managed services. */
  const port = server.address().port;
  /** Fixed synthetic loopback HTTP helper, without arbitrary external endpoints.
   * @param {string} path - Fixed synthetic route on the owned loopback server.
   * @param {string} encoding - Explicit negotiation fixture header.
   * @param {string} method - Native request method, default GET.
   * @param {object} headers - Explicit synthetic request headers.
   * @returns {Promise<object>} Consumed response bytes, headers and status; errors reject.
   */
  const request = (
    path = '/',
    encoding = 'gzip',
    method = 'GET',
    headers = {}
  ) =>
    new Promise((resolve, reject) => {
      /** Owned fixture HTTP request handle; destroy during teardown on interrupted tests. */
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: { 'accept-encoding': encoding, ...headers },
        },
        (res) => {
          /** Per-response synthetic byte chunks consumed before the fixture assertion. */
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });
  return {
    owner,
    measurements,
    request,
    port,
    get held() {
      return held;
    },
    /** Close the owned compression scope, destroy fixture connections and await server close.
     * @returns {Promise<void>} Resolves after fixture resource settlement.
     */
    async close() {
      try {
        await owner.close();
      } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    },
  };
}
test('gzip/brotli metadata, privacy, range, HEAD/304, refusal and no-transform', async () => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = await fixture();
  try {
    // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
    for (const encoding of ['gzip', 'br']) {
      /** Observed response bytes/headers for the current fixed encoding case. */
      const r = await f.request('/', encoding);
      assert.equal(r.headers['content-encoding'], encoding);
      assert.deepEqual(
        encoding === 'gzip' ? gunzipSync(r.body) : brotliDecompressSync(r.body),
        body
      );
      assert.equal(r.headers.etag, undefined);
      assert.equal(r.headers['content-length'], undefined);
      assert.equal(r.headers['content-digest'], undefined);
      assert.match(r.headers.vary, /Accept-Encoding/);
    }
    /** Synthetic authenticated response checked for private no-store metadata. */
    const privateResult = await f.request('/private');
    assert.equal(privateResult.headers['cache-control'], 'private, no-store');
    /** Synthetic cookie-bearing response; cookies must force private classification. */
    const cookie = await f.request('/', 'gzip', 'GET', {
      cookie: 'session=private',
    });
    assert.equal(cookie.headers['cache-control'], 'private, no-store');
    // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
    for (const path of ['/no-transform', '/range', '/encoded']) {
      /** Observed response bytes/headers for the current fixed encoding case. */
      const r = await f.request(path);
      assert.equal(r.headers.etag, '"identity"');
      assert.equal(r.headers['content-length'], String(body.length));
    }
    assert.equal((await f.request('/range')).status, 206);
    // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
    for (const [path, method] of [
      ['/', 'HEAD'],
      ['/304', 'GET'],
    ]) {
      /** Observed response bytes/headers for the current fixed encoding case. */
      const r = await f.request(path, 'gzip', method);
      assert.equal(r.body.length, 0);
      assert.equal(r.headers.etag, '"identity"');
    }
    assert.equal(
      (await f.request('/no-transform', 'identity;q=0,gzip')).status,
      406
    );
    assert.throws(() => createCompressionOwner({ maxConcurrent: 0 }));
    assert.throws(() =>
      forwardPerformanceResponse(
        f.owner,
        {},
        null,
        {},
        { authenticated: true, public: true }
      )
    );
  } finally {
    await f.close();
  }
});
test('bounded encoders, disconnect and owner close destroy streams; source failure rejects', async () => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = await fixture();
  let req;
  try {
    req = http.get(
      {
        host: '127.0.0.1',
        port: f.port,
        path: '/hold',
        headers: { 'accept-encoding': 'gzip' },
      },
      (res) => res.resume()
    );
    req.on('error', () => {});
    while (!f.held) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(f.owner.status().active, 1);
    /** Observed identity response while the single synthetic encoder is occupied. */
    const overflow = await f.request('/');
    assert.equal(overflow.headers['content-encoding'], undefined);
    assert.match(overflow.headers.vary, /Accept-Encoding/);
    assert.ok(f.owner.status().overloaded >= 1);
    req.destroy();
    while (f.owner.status().active) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(f.held.destroyed, true);
    await assert.rejects(f.request('/failure'));
    await f.owner.close();
    assert.equal(f.owner.status().active, 0);
  } finally {
    req?.destroy();
    await f.close();
  }
});
test('repeatable loopback workload reports bytes and elapsed time without a speed claim', async (t) => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = await fixture();
  try {
    // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
    for (const encoding of ['identity', 'gzip', 'br']) {
      let bytes = 0;
      /** Local monotonic start time for the repeatable synthetic workload. */
      const start = performance.now();
      // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
      for (let i = 0; i < 10; i++) {
        bytes += (await f.request('/', encoding)).body.length;
      }
      t.diagnostic(
        JSON.stringify({
          node: process.version,
          encoding,
          requests: 10,
          inputBytes: body.length * 10,
          outputBytes: bytes,
          elapsedMs: Math.round((performance.now() - start) * 100) / 100,
        })
      );
    }
    assert.ok(f.measurements.length >= 20);
    assert.deepEqual(Object.keys(f.measurements[0]).sort(), [
      'durationMs',
      'encoding',
      'outcome',
      'outputBytes',
    ]);
  } finally {
    await f.close();
  }
});

test('active owner close releases a held source and rejects new work', async () => {
  /** Isolated owned fixture; dependent listeners/transports/sockets are cleaned at teardown. */
  const f = await fixture();
  let req;
  try {
    req = http.get(
      {
        host: '127.0.0.1',
        port: f.port,
        path: '/hold',
        headers: { 'accept-encoding': 'gzip' },
      },
      (res) => res.resume()
    );
    req.on('error', () => {});
    while (!f.held) {
      await new Promise((r) => setImmediate(r));
    }
    await f.owner.close();
    assert.equal(f.held.destroyed, true);
    assert.equal(f.owner.status().active, 0);
    assert.throws(() => f.owner.forward({}, null, {}), /closed/);
  } finally {
    req?.destroy();
    await f.close();
  }
});
