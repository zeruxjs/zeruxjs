import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxyServer } from '../dist/portless/proxy.js';

/** Bind an owned synthetic listener on an ephemeral IPv4-loopback port.
 * @param {import("node:net").Server} server Owned fixture native server.
 * @returns {Promise<number>} Actual native port; no operator listener is reused. */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
/** Await actual native close of an owned fixture server.
 * @param {import("node:net").Server} server Owned native fixture listener.
 * @returns {Promise<void>} Native close completion. */
const close = (server) => new Promise((resolve) => server.close(resolve));
/** Send one fixed local request and capture its synthetic response for forwarding-policy assertions.
 * @param {number} port - Actual owned ephemeral proxy port.
 * @param {string} host - Explicit valid/invalid authority fixture.
 * @param {object} headers - Fixed malicious/safe header overrides.
 * @param {string} body - Small fixed optional fixture body.
 * @returns {Promise<{status: number, headers: object, body: string}>} Native fixture response without any external upstream.
 */
function request(port, host, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    /** Owned one-shot local HTTP request with observed native errors. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: body ? 'POST' : 'GET',
        headers: { Host: host, ...headers },
      },
      (res) => {
        /** Small fixed synthetic byte accumulator, never a remote corpus. */
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('HTTP proxy forwards body and overwrites spoofed forwarding headers', async () => {
  /** Owned synthetic native upstream closed in fixture finally. */
  const upstream = http.createServer((req, res) => {
    /** Small fixed synthetic byte accumulator, never a remote corpus. */
    const chunks = [];
    req.on('data', (x) => chunks.push(x));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          host: req.headers.host,
          forwarded: req.headers['x-forwarded-for'],
          proto: req.headers['x-forwarded-proto'],
          body: Buffer.concat(chunks).toString(),
          hops: req.headers['x-portless-hops'],
        })
      );
    });
  });
  /** Actual owned upstream listener port. */
  const upstreamPort = await listen(upstream);
  /** Owned ephemeral proxy stopped/drained before removing fixture state. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'app.localhost', port: upstreamPort }],
    proxyPort: 0,
    onError: () => {},
  });
  try {
    /** Actual ephemeral proxy listener port. */
    const port = await listen(proxy);
    /** Actual synthetic response receipt checked against known protocol/identity expectations. */
    const result = await request(
      port,
      'app.localhost',
      { 'x-forwarded-for': '8.8.8.8', 'x-forwarded-proto': 'https' },
      'hello'
    );
    assert.equal(result.status, 200);
    /** Decoded upstream-observed synthetic metadata checked for spoofed-header replacement. */
    const payload = JSON.parse(result.body);
    assert.equal(payload.body, 'hello');
    assert.equal(payload.forwarded, '127.0.0.1');
    assert.equal(payload.proto, 'http');
    assert.equal(payload.hops, '1');
    assert.equal(
      (await request(port, 'app.localhost', { 'x-portless-hops': 'invalid' }))
        .status,
      400
    );
    assert.equal(
      (await request(port, 'app.localhost', { 'x-portless-hops': '5' })).status,
      508
    );
    assert.equal((await request(port, 'unknown.localhost')).status, 404);
    assert.equal((await request(port, 'bad host')).status, 400);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
