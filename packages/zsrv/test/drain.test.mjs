import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createProxyServer } from '../dist/portless/proxy.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => server.close(resolve));

test('drain waits for an in-flight proxied request and is idempotent', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const upstream = http.createServer(async (_req, res) => { await blocked; res.end('complete'); });
  await listen(upstream);
  const proxy = createProxyServer({getRoutes: () => [{hostname:'app.localhost', port: upstream.address().port}], proxyPort: 0});
  const port = await listen(proxy);
  try {
    const started = new Promise(resolve => upstream.once('request', resolve));
    const response = new Promise((resolve, reject) => {
      http.get({host:'127.0.0.1', port, headers:{host:'app.localhost'}}, res => {
        let body = ''; res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
    await started;
    const draining = proxy.connectionTracker.drain({timeoutMs: 2000});
    assert.strictEqual(proxy.connectionTracker.drain(), draining);
    release();
    assert.equal(await response, 'complete');
    await draining;
    assert.equal(proxy.connectionTracker.activeConnections, 0);
  } finally { release(); await close(upstream); }
});

test('drain forcibly closes idle raw TCP connections at the configured deadline', async () => {
  const proxy = createProxyServer({getRoutes: () => [], proxyPort: 0});
  const port = await listen(proxy);
  const socket = net.connect({host:'127.0.0.1',port});
  await new Promise(resolve => socket.once('connect', resolve));
  assert.equal(proxy.connectionTracker.activeConnections, 1);
  const closed = new Promise(resolve => socket.once('close', resolve));
  await proxy.connectionTracker.drain({timeoutMs: 30});
  await closed;
  assert.equal(proxy.connectionTracker.activeConnections, 0);
});

test('invalid shutdown timeout does not close the server', async () => {
  const proxy = createProxyServer({getRoutes: () => [], proxyPort: 0});
  await listen(proxy);
  await assert.rejects(proxy.connectionTracker.drain({timeoutMs:-1}), RangeError);
  assert.equal(proxy.listening, true);
  await proxy.connectionTracker.drain({timeoutMs:0});
});
