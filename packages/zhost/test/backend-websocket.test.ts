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
/** Create an inert synthetic upstream proving which registered backend accepted an actual native upgrade.
 * @param {string} label Fixed inert fixture backend label.
 * @returns {import("node:http").Server} Owned server requiring listen and close. */
const nodeServer = (label) => {
  /** Owned inert synthetic upgrade server. */
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    /** Native standard WebSocket SHA-1 handshake digest; this is protocol framing, not password/security hashing. */
    const accept = crypto
      .createHash('sha1')
      .update(
        req.headers['sec-websocket-key'] +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
      )
      .digest('base64');
    socket.end(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Backend: ${label}\r\n\r\n`
    );
  });
  return server;
};
/** Issue a fixed valid native upgrade to the owned fixture proxy and close the resulting socket.
 * @param {number} port - Actual owned loopback proxy port.
 * @returns {Promise<string>} Observed fixed backend label or explicit HTTP rejection label.
 */
function upgrade(port) {
  return new Promise((resolve, reject) => {
    /** Owned one-shot local HTTP request with observed native errors. */
    const req = http.request({
      host: '127.0.0.1',
      port,
      headers: {
        Host: 'ws.localhost',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.alloc(16, 9).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    req.once('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.headers['x-backend']);
    });
    req.once('response', (res) => {
      res.resume();
      resolve(`error-${res.statusCode}`);
    });
    req.once('error', reject);
    req.end();
  });
}
test('WebSocket upgrades use the same multi-backend selection and health isolation', async () => {
  /** First owned synthetic upgrade backend. */
  const one = nodeServer('one');
  /** Second owned synthetic upgrade backend. */
  const two = nodeServer('two');
  /** Actual first backend port. */
  const a = await listen(one);
  /** Actual second backend port. */
  const b = await listen(two);
  /** Trusted fixed two-backend fixture route. */
  const route = {
    hostname: 'ws.localhost',
    port: a,
    backends: [{ port: a }, { port: b }],
  };
  /** Owned ephemeral proxy stopped/drained before removing fixture state. */
  const proxy = createProxyServer({
    getRoutes: () => [route],
    proxyPort: 0,
    onError: () => {},
  });
  /** Actual ephemeral proxy listener port. */
  const port = await listen(proxy);
  try {
    assert.deepEqual(
      [await upgrade(port), await upgrade(port)],
      ['one', 'two']
    );
    proxy.backendPool.markFailure('ws.localhost', a);
    assert.equal(await upgrade(port), 'two');
    proxy.backendPool.markFailure('ws.localhost', b);
    assert.equal(await upgrade(port), 'error-503');
  } finally {
    await close(proxy);
    await close(one);
    await close(two);
  }
});
