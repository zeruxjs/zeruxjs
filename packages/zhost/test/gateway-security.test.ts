import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createProxyServer } from '../dist/portless/proxy.js';
import { sanitizeForwardedRequestHeaders } from '../dist/portless/proxy-headers.js';
import { parseRollingRunArguments } from '../dist/bin/parse-rolling.js';

/** Bind only an owned synthetic listener on an ephemeral IPv4-loopback port.
 * @param {import("node:net").Server} server - Owned fixture server.
 * @returns {Promise<number>} Actual native fixture port.
 */
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
/** Close fixture HTTP connections and await actual listener shutdown.
 * @param {import("node:http").Server} server - Owned native fixture server.
 * @returns {Promise<void>} Native close settlement.
 */
async function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}
/** Send one fixed local GET and capture the synthetic response for security assertions.
 * @param {number} port - Owned ephemeral loopback proxy port.
 * @param {string} path - Fixed synthetic path, default root.
 * @param {object} headers - Explicit malicious/safe header fixture overrides.
 * @returns {Promise<{status: number, headers: object, body: string}>} Bounded synthetic response receipt.
 */
function request(port, path = '/', headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: '127.0.0.1',
          port,
          path,
          headers: { host: 'app.localhost', connection: 'close', ...headers },
        },
        (res) => {
          /** Small synthetic response accumulator for the loopback assertion. */
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
      )
      .on('error', reject);
  });
}

test('proxy identity removes caller forwarding chains and vendor IP aliases', async () => {
  assert.deepEqual(
    sanitizeForwardedRequestHeaders({
      'x-forwarded-for': 'spoof',
      'x-real-ip': 'spoof',
      'x-safe': 'kept',
    }),
    { 'x-safe': 'kept' }
  );
  let observed;
  /** Owned synthetic native upstream; no operator endpoint is reused. */
  const backend = http.createServer((req, res) => {
    observed = req.headers;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.headers));
  });
  /** Actual owned upstream listener port. */
  const target = await listen(backend);
  /** Owned loopback proxy under test, always closed in finally. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'app.localhost', port: target }],
    proxyPort: 0,
    onError: () => {},
  });
  try {
    /** Actual owned ephemeral proxy port. */
    const port = await listen(proxy);
    /** Captured malicious-request response checked against actual upstream observations. */
    const reply = await request(port, '/', {
      'x-forwarded-for': '203.0.113.1',
      'x-forwarded-proto': 'https',
      'x-real-ip': '203.0.113.2',
      forwarded: 'for=evil',
      'cf-connecting-ip': '203.0.113.4',
      'true-client-ip': '203.0.113.3',
      'x-client-ip': '203.0.113.5',
      'x-forwarded-prefix': '/admin',
    });
    assert.equal(reply.status, 200);
    /** Synthetic upstream-observed fields decoded only for assertions. */
    const headers = JSON.parse(reply.body);
    assert.equal(headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(headers['x-forwarded-proto'], 'http');
    assert.equal(headers['x-forwarded-host'], 'app.localhost');
    assert.equal(headers['x-forwarded-prefix'], undefined);
    assert.equal(headers.forwarded, undefined);
    for (const header of [
      'x-real-ip',
      'cf-connecting-ip',
      'true-client-ip',
      'x-client-ip',
    ]) {
      assert.equal(headers[header], undefined);
    }
    assert.equal(observed['x-portless-hops'], '1');
  } finally {
    await close(proxy);
    await close(backend);
  }
});

test('malformed WebSocket upgrade never reaches upstream', async () => {
  let upgrades = 0;
  /** Owned synthetic native upstream; no operator endpoint is reused. */
  const backend = http.createServer();
  backend.on('upgrade', (_req, socket) => {
    upgrades++;
    socket.destroy();
  });
  /** Actual owned upstream listener port. */
  const backendPort = await listen(backend);
  /** Owned loopback proxy under test, always closed in finally. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'app.localhost', port: backendPort }],
    proxyPort: 0,
  });
  try {
    /** Actual owned ephemeral proxy port. */
    const port = await listen(proxy);
    /** Fixed malformed upgrade headers; these are inert protocol test bytes. */
    const bad = [
      'Connection: Upgrade\r\nUpgrade: h2c\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: AAAA',
      'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13',
      'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 12\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==',
    ];
    for (const raw of bad) {
      /** Complete bounded raw fixture handshake response, not a live external request. */
      const response = await new Promise((resolve, reject) => {
        /** Owned raw fixture TCP client; timeout/error/close is explicitly observed. */
        const socket = net.connect(port, '127.0.0.1');
        let result = '';
        socket.setTimeout(1500, () =>
          socket.destroy(new Error('socket timeout'))
        );
        socket.on('connect', () =>
          socket.write(
            `GET / HTTP/1.1\r\nHost: app.localhost\r\n${raw}\r\n\r\n`
          )
        );
        socket.on('data', (chunk) => (result += chunk.toString()));
        socket.on('close', () => resolve(result));
        socket.on('error', reject);
      });
      assert.match(response, /^HTTP\/1\.1 400 Bad Request/);
    }
    assert.equal(upgrades, 0);
  } finally {
    await close(proxy);
    await close(backend);
  }
});

test('rolling CLI exposes bounded pre-cutover health gate without parsing child flags', () => {
  /** Parsed trusted CLI fixture; no supplied executable is started. */
  const args = parseRollingRunArguments([
    '--name',
    'app',
    '--ports',
    '4000,4001',
    '--precutover-checks',
    '3',
    '--verify-checks',
    '4',
    '--',
    'node',
    'app.mjs',
    '--precutover-checks',
    '99',
  ]);
  assert.equal(args.preCutoverChecks, 3);
  assert.equal(args.verificationChecks, 4);
  assert.deepEqual(args.command, [
    'node',
    'app.mjs',
    '--precutover-checks',
    '99',
  ]);
  for (const value of ['0', '21', '1.5', '900000']) {
    assert.throws(() =>
      parseRollingRunArguments([
        '--name',
        'app',
        '--ports',
        '4000,4001',
        '--precutover-checks',
        value,
        '--',
        'node',
        'app.mjs',
      ])
    );
  }
});

test('oversized chunked upload aborts an already-streaming response without killing the gateway', async () => {
  /** Owned synthetic native upstream; no operator endpoint is reused. */
  const backend = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.end('healthy');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('started');
    req.resume();
  });
  /** Actual owned upstream listener port. */
  const backendPort = await listen(backend);
  /** Owned loopback proxy under test, always closed in finally. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'app.localhost', port: backendPort }],
    proxyPort: 0,
    limits: { maxBodyBytes: 8 },
    onError: () => {},
  });
  try {
    /** Actual owned ephemeral proxy port. */
    const port = await listen(proxy);
    /** Captured malicious-request response checked against actual upstream observations. */
    const reply = await new Promise((resolve, reject) => {
      /** Owned raw fixture TCP client; timeout/error/close is explicitly observed. */
      const socket = net.connect(port, '127.0.0.1');
      let received = '';
      let advanced = false;
      /** Owned finite fixture timeout, cleared on terminal raw-client events. */
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('upload did not terminate'));
      }, 2500);
      socket.on('connect', () =>
        socket.write(
          'POST /upload HTTP/1.1\r\nHost: app.localhost\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\ntest\r\n'
        )
      );
      socket.on('data', (chunk) => {
        received += chunk.toString();
        if (!advanced && received.includes('started')) {
          advanced = true;
          socket.write('10\r\n0123456789abcdef\r\n0\r\n\r\n');
        }
      });
      socket.on('close', () => {
        clearTimeout(timer);
        resolve({ received, advanced });
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.equal(
      reply.advanced,
      true,
      'backend began streaming before request limit was exceeded'
    );
    assert.match(reply.received, /^HTTP\/1\.1 200/);
    /** Follow-up synthetic GET proving the proxy remains usable after aborting an oversized stream. */
    const healthy = await request(port, '/health');
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body, 'healthy');
  } finally {
    await close(proxy);
    await close(backend);
  }
});
