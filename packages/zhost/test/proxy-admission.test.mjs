import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ProxyAdmission } from '../dist/portless/proxy-admission.js';
import { createProxyServer } from '../dist/portless/proxy.js';

test('bounded token bucket rejects bursts and releases concurrent permits only once', () => {
  let time = 0;
  /** Process-local limiter with injected deterministic clock; no native resources acquired. */
  const admission = new ProxyAdmission(
    { ratePerSecond: 2, burst: 2, maxActiveRequests: 1 },
    () => time
  );
  /** First owned synthetic capacity receipt, released twice to prove idempotence. */
  const first = admission.acquire('127.0.0.1');
  assert.equal(first.status, 200);
  assert.equal(admission.acquire('127.0.0.1').status, 503);
  first.release();
  first.release();
  assert.equal(admission.activeRequests, 0);
  /** Second accepted synthetic receipt consuming the remaining burst token. */
  const second = admission.acquire('127.0.0.1');
  second.release();
  assert.equal(admission.acquire('127.0.0.1').status, 429);
  time += 500;
  assert.equal(admission.acquire('127.0.0.1').status, 200);
  assert.throws(() => new ProxyAdmission({ burst: 1 }), /requires/);
  assert.throws(() => new ProxyAdmission({ maxBodyBytes: -1 }), /body/);
});

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
/** Send one bounded synthetic fixture request, optionally with explicit chunked writes.
 * @param {number} port Owned ephemeral loopback proxy port.
 * @param {object} headers Synthetic header overrides.
 * @param {string | undefined} body Fixed small optional request bytes.
 * @param {boolean} chunked Whether to split the fixed body across writes.
 * @returns {Promise<{status: number, body: string}>} Captured bounded fixture response. */
const request = (port, headers = {}, body, chunked = false) =>
  new Promise((resolve, reject) => {
    /** Owned one-shot native fixture request; native errors reject its promise. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: body ? 'POST' : 'GET',
        headers: { Host: 'api.localhost', ...headers },
      },
      (res) => {
        let content = '';
        res.on('data', (b) => (content += b));
        res.on('end', () => resolve({ status: res.statusCode, body: content }));
      }
    );
    req.on('error', reject);
    if (chunked) {
      req.write(body.slice(0, 5));
      req.end(body.slice(5));
    } else {
      req.end(body);
    }
  });

test('HTTP proxy can reject excess rates and declared/streamed oversized bodies', async () => {
  /** Owned loopback synthetic upstream returning one fixed response after request end. */
  const backend = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end('ok'));
  });
  /** Actual synthetic upstream port used only by these fixture proxies. */
  const backendPort = await listen(backend);
  /** Owned ephemeral proxy configured with explicit admission budgets. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'api.localhost', port: backendPort }],
    proxyPort: 0,
    limits: {
      ratePerSecond: 20,
      burst: 2,
      maxActiveRequests: 2,
      maxBodyBytes: 10,
    },
    onError: () => {},
  });
  try {
    /** Actual proxy port used for the deterministic request burst. */
    const port = await listen(proxy);
    assert.equal((await request(port)).status, 200);
    assert.equal((await request(port)).status, 200);
    assert.equal((await request(port)).status, 429);
    // Another proxy, so the rate limiter doesn't prevent size assertions.
    /** Separate owned proxy isolating byte-limit assertions from rate accounting. */
    const sizes = createProxyServer({
      getRoutes: () => [{ hostname: 'api.localhost', port: backendPort }],
      proxyPort: 0,
      limits: { maxBodyBytes: 10 },
      onError: () => {},
    });
    try {
      /** Actual size-only proxy port, closed by its native connection tracker. */
      const p = await listen(sizes);
      assert.equal((await request(p, {}, '01234567890')).status, 413);
      assert.equal(
        (
          await request(
            p,
            { 'transfer-encoding': 'chunked' },
            '01234567890',
            true
          )
        ).status,
        413
      );
      assert.equal((await request(p, {}, 'short')).status, 200);
    } finally {
      await sizes.connectionTracker.drain({ timeoutMs: 1000 });
    }
  } finally {
    await proxy.connectionTracker.drain({ timeoutMs: 1000 });
    await close(backend);
  }
});
