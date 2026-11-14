import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createProxyServer } from '../dist/portless/proxy.js';

/** Bind an owned fixture server on an ephemeral IPv4 loopback port.
 * @param {import("node:net").Server} server Owned native fixture listener.
 * @returns {Promise<number>} Actual bound port; no operator listener is reused. */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
/** Await native close of an owned fixture server.
 * @param {import("node:net").Server} server Owned fixture listener.
 * @returns {Promise<void>} Actual native close settlement. */
const close = (server) => new Promise((resolve) => server.close(resolve));

test('drain waits for an in-flight proxied request and is idempotent', async () => {
  let release;
  /** Explicit synthetic upstream gate proving accepted requests retain drain ownership. */
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  /** Owned loopback native upstream held only by the fixture gate. */
  const upstream = http.createServer(async (_req, res) => {
    await blocked;
    res.end('complete');
  });
  await listen(upstream);
  /** Owned ephemeral proxy listener stopped by the drain under test. */
  const proxy = createProxyServer({
    getRoutes: () => [
      { hostname: 'app.localhost', port: upstream.address().port },
    ],
    proxyPort: 0,
  });
  /** Actual bound owned proxy port. */
  const port = await listen(proxy);
  try {
    /** Native upstream request receipt, awaited before initiating the drain. */
    const started = new Promise((resolve) => upstream.once('request', resolve));
    /** Owned local request promise capturing only the fixed small synthetic response. */
    const response = new Promise((resolve, reject) => {
      http
        .get(
          { host: '127.0.0.1', port, headers: { host: 'app.localhost' } },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve(body));
          }
        )
        .on('error', reject);
    });
    await started;
    /** Shared actual native listener/socket drain promise under test. */
    const draining = proxy.connectionTracker.drain({ timeoutMs: 2000 });
    assert.strictEqual(proxy.connectionTracker.drain(), draining);
    release();
    assert.equal(await response, 'complete');
    await draining;
    assert.equal(proxy.connectionTracker.activeConnections, 0);
  } finally {
    release();
    await close(upstream);
  }
});

test('drain forcibly closes idle raw TCP connections at the configured deadline', async () => {
  /** Owned ephemeral proxy listener stopped by the drain under test. */
  const proxy = createProxyServer({ getRoutes: () => [], proxyPort: 0 });
  /** Actual bound owned proxy port. */
  const port = await listen(proxy);
  /** Owned synthetic idle TCP connection destroyed by the declared drain deadline. */
  const socket = net.connect({ host: '127.0.0.1', port });
  await new Promise((resolve) => socket.once('connect', resolve));
  assert.equal(proxy.connectionTracker.activeConnections, 1);
  /** Native fixture client close receipt, not just an abort-signal observation. */
  const closed = new Promise((resolve) => socket.once('close', resolve));
  await proxy.connectionTracker.drain({ timeoutMs: 30 });
  await closed;
  assert.equal(proxy.connectionTracker.activeConnections, 0);
});

test('invalid shutdown timeout does not close the server', async () => {
  /** Owned ephemeral proxy listener stopped by the drain under test. */
  const proxy = createProxyServer({ getRoutes: () => [], proxyPort: 0 });
  await listen(proxy);
  await assert.rejects(
    proxy.connectionTracker.drain({ timeoutMs: -1 }),
    RangeError
  );
  assert.equal(proxy.listening, true);
  await proxy.connectionTracker.drain({ timeoutMs: 0 });
});
