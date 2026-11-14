import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
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

test('WebSocket proxy forwards early tunnel bytes only after successful upgrade', async () => {
  let handshakeBody = '';
  /** Owned synthetic native upstream closed in fixture finally. */
  const upstream = http.createServer();
  /** Owned upstream accepted sockets, explicitly destroyed before server close. */
  const sockets = new Set();
  upstream.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  upstream.on('upgrade', (req, socket, head) => {
    handshakeBody = head.toString();
    /** Standard native WebSocket protocol handshake digest of the fixed fixture nonce. */
    const accept = crypto
      .createHash('sha1')
      .update(
        req.headers['sec-websocket-key'] +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
      )
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.on('data', (bytes) => {
      socket.write(bytes);
    });
  });
  /** Actual owned upstream listener port. */
  const upstreamPort = await listen(upstream);
  /** Owned ephemeral proxy stopped/drained before removing fixture state. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'ws.localhost', port: upstreamPort }],
    proxyPort: 0,
    onError: () => {},
  });
  /** Actual ephemeral proxy listener port. */
  const port = await listen(proxy);
  try {
    await new Promise((resolve, reject) => {
      /** Owned one-shot local HTTP request with observed native errors. */
      const req = http.request({
        host: '127.0.0.1',
        port,
        headers: {
          Host: 'ws.localhost',
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': Buffer.alloc(16, 3).toString('base64'),
          'Sec-WebSocket-Version': '13',
        },
      });
      req.once('upgrade', (res, socket) => {
        assert.equal(res.statusCode, 101);
        socket.once('data', (data) => {
          assert.equal(data.toString(), 'tunnel-data');
          socket.destroy();
          resolve();
        });
        socket.write('tunnel-data');
      });
      req.once('error', reject);
      req.end();
    });
    assert.equal(handshakeBody, '');
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await close(proxy);
    await close(upstream);
  }
});
