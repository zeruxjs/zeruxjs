import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as zlib from 'node:zlib';
import { createProxyServer } from '../dist/portless/proxy.js';
import { ProxyResponseCache } from '../dist/portless/proxy-cache.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const stop = server => new Promise(resolve => server.close(resolve));
async function request(port, url, headers = {}) {
  return await new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port, path: url, headers: { Host: 'cache.localhost', ...headers } }, res => {
    const parts = []; res.on('data', x => parts.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) })); res.on('error', reject);
  }).on('error', reject));
}
test('response cache is opt-in, safe across compression, and invalidatable', async () => {
  let upstreamCalls = 0;
  const upstream = http.createServer((req, res) => {
    upstreamCalls++;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', req.url?.startsWith('/private') ? 'private, max-age=60' : 'public, max-age=60');
    if (req.url === '/cookie') res.setHeader('Set-Cookie', 'sid=secret');
    res.end('A'.repeat(5000) + ':' + upstreamCalls);
  });
  const backend = await listen(upstream);
  const proxy = createProxyServer({ proxyPort: 0, getRoutes: () => [{ hostname: 'cache.localhost', port: backend }], cache: { enabled: true, maxEntryBytes: 10000 }, compression: { enabled: true, minBytes: 128 } });
  const frontend = await listen(proxy);
  try {
    const first = await request(frontend, '/data', { 'Accept-Encoding': 'gzip' });
    assert.equal(first.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(first.body).toString().endsWith(':1'), true);
    const second = await request(frontend, '/data');
    assert.equal(second.headers['content-encoding'], undefined);
    assert.equal(second.body.toString().endsWith(':1'), true);
    assert.equal(upstreamCalls, 1);
    assert.equal(proxy.responseCache.stats().hits, 1);
    assert.equal(proxy.responseCache.invalidate('cache.localhost', '/data'), 1);
    const next = await request(frontend, '/data');
    assert.equal(next.body.toString().endsWith(':2'), true);
    await request(frontend, '/private'); await request(frontend, '/private');
    await request(frontend, '/cookie'); await request(frontend, '/cookie');
    assert.equal(upstreamCalls, 6);
    await request(frontend, '/data', { Cookie: 'sid=user' });
    assert.equal(upstreamCalls, 7);
  } finally { await stop(proxy); await stop(upstream); }
});
test('cache validates limits and rejects unsafe policies', () => {
  assert.throws(() => new ProxyResponseCache({ maxEntryBytes: 20, maxTotalBytes: 1 }), RangeError);
  const cache = new ProxyResponseCache({ enabled: true });
  assert.equal(cache.requestEligible({ method: 'GET', headers: { authorization: 'Bearer token' } }), false);
  assert.equal(cache.requestEligible({ method: 'GET', headers: { 'cache-control': 'no-store' } }), false);
  assert.equal(cache.requestEligible({ method: 'POST', headers: {} }), false);
});
