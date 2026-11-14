import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { RouteStore } from '../dist/portless/routes.js';
import { createProxyServer } from '../dist/portless/proxy.js';
import { launchRollingApplication } from '../dist/portless/rolling-app.js';
import { BackendConnections } from '../dist/portless/backend-connections.js';

/** Pace only synthetic readiness and assertion polling.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves when the bounded fixture timer elapses.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Bind a fixture-owned listener to an ephemeral loopback port.
 * @param {import("node:net").Server} server - Owned listener.
 * @returns {Promise<number>} Actual fixture port.
 */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
/** Await native close of a fixture listener.
 * @param {import("node:net").Server} server - Owned listener to release.
 * @returns {Promise<void>} Listener close settlement.
 */
const close = (server) => new Promise((resolve) => server.close(resolve));
/** Request fixed synthetic loopback content.
 * @param {number} port - Fixture proxy port.
 * @param {string} host - Synthetic route hostname.
 * @param {string} pathname - Fixed fixture path, default slash.
 * @returns {Promise<object>} Small response status and body.
 */
const get = (port, host, pathname = '/') =>
  new Promise((resolve, reject) => {
    /** Owned HTTP fixture request or pending held response; errors remain visible to the assertion. */
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        headers: { Host: host, Connection: 'close' },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body })
        );
      }
    );
    request.on('error', reject);
  });
/** Allocate then close a temporary loopback listener for a fixture child.
 * @returns {Promise<number>} Previously free test port; not a cross-process reservation.
 */
async function freePort() {
  /** Temporary loopback listener closed before returning its port. */
  const s = net.createServer();
  /** Allocated fixture port or shared controller operation under test. */
  const p = await listen(s);
  await close(s);
  return p;
}
/** Find two distinct ephemeral fixture ports without selecting operator application ports.
 * @returns {Promise<number[]>} Distinct test port pair, with temporary listeners already closed.
 */
async function twoPorts() {
  /** First fixture port or owned active-session release used to prove idempotency. */
  const a = await freePort();
  let b = await freePort();
  while (a === b) {
    b = await freePort();
  }
  return [a, b];
}
/** Fixed trusted synthetic child program; preserved byte-for-byte and never derived from request data. */
const serverCode = `
const http=require('node:http');
const port=Number(process.env.PORT);
const slowFailure=process.env.FAIL_PORT===String(port);
if (slowFailure && process.env.FAIL_MODE==='exit') process.exit(7);
let healthRequests=0;
const server=http.createServer((req,res)=>{
 if(req.url==='/health') {const bad=slowFailure && process.env.FAIL_MODE==='late' && ++healthRequests>=3;res.statusCode=bad?503:200;res.end(bad?'bad':'ok');return;}
 if(req.url==='/hold'){setTimeout(()=>res.end('held-'+port),300);return;}
 res.end('port-'+port);
});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
/** Explicit direct-exec command for the synthetic fixture child only. */
const argv = [process.execPath, '-e', serverCode];

/** Own private route state, a proxy and any launched test child around one assertion callback.
 * @param {(context: object) => Promise<void>} fn - Assertions borrowing the synthetic route store, proxy and launch helper.
 * @returns {Promise<void>} Awaits assertions, stops fixture children, closes the proxy and removes private temporary state.
 */
async function fixture(fn) {
  /** Owned private temporary route-state directory, removed after process/proxy cleanup. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-rolling-'));
  /** Fixture route store confined to the owned temporary directory. */
  const store = new RouteStore(dir);
  /** Owned synthetic proxy whose actual connection tracker drives drain assertions. */
  const proxy = createProxyServer({
    getRoutes: () => store.loadRoutes(),
    proxyPort: 0,
    onError: () => {},
  });
  /** Ephemeral fixture proxy port. */
  const proxyPort = await listen(proxy);
  /** Distinct ephemeral generation ports selected only for these synthetic children. */
  const ports = await twoPorts();
  let app;
  /** Start an owned fixture controller using the real fixture proxy’s drain tracker.
   * @param {object} extra - Explicit synthetic supervisor policy overrides.
   * @returns {Promise<object>} Owned rolling controller, stopped by fixture teardown.
   */
  const launch = async (extra) => {
    app = await launchRollingApplication(argv, {
      store,
      hostname: 'rolling.localhost',
      ports,
      connections: proxy.backendConnections,
      health: { path: '/health', timeoutMs: 300 },
      readyTimeoutMs: 2000,
      shutdownTimeoutMs: 2000,
      stdio: 'ignore',
      ...extra,
    });
    return app;
  };
  try {
    await fn({
      store,
      proxy,
      proxyPort,
      ports,
      launch,
      get app() {
        return app;
      },
    });
  } finally {
    if (app) {
      await app.stop().catch(() => {});
    }
    await close(proxy);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('connection tracker handles overlapping sessions, releases once, and times out', async () => {
  /** In-memory accepted-session accounting fixture. */
  const tracker = new BackendConnections();
  assert.throws(() => tracker.waitForIdle('x', 1, -1), RangeError);
  /** First fixture port or owned active-session release used to prove idempotency. */
  const a = tracker.track('x', 1);
  /** Second owned active-session release, retained until its explicit completion. */
  const b = tracker.track('x', 1);
  /** Pending drain observation resolved only after both owned sessions release. */
  const idle = tracker.waitForIdle('x', 1, 500);
  a();
  a();
  assert.equal(tracker.active('x', 1), 1);
  b();
  assert.equal(await idle, true);
  assert.equal(tracker.active('x', 1), 0);
  /** Owned session release held to prove deadline expiry is not idle. */
  const blocked = tracker.track('x', 2);
  assert.equal(await tracker.waitForIdle('x', 2, 20), false);
  blocked();
  assert.equal(await tracker.waitForIdle('x', 2, 0), true);
});

test('rolling deployment retains in-flight requests and safely retires old generation', () =>
  fixture(async ({ store, proxy, proxyPort, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch();
    assert.equal(
      (await get(proxyPort, 'rolling.localhost')).body,
      `port-${ports[0]}`
    );
    /** Owned HTTP fixture request or pending held response; errors remain visible to the assertion. */
    const request = get(proxyPort, 'rolling.localhost', '/hold');
    for (
      let i = 0;
      i < 80 && !proxy.backendConnections.active('rolling.localhost', ports[0]);
      i++
    ) {
      await delay(5);
    }
    assert.equal(
      proxy.backendConnections.active('rolling.localhost', ports[0]),
      1
    );
    let finished = false;
    /** Pending replacement operation observed while an old request remains active. */
    const rolling = app.deploy().then((result) => {
      finished = true;
      return result;
    });
    for (let i = 0; i < 100 && store.loadRoutes()[0].port !== ports[1]; i++) {
      await delay(5);
    }
    assert.equal(store.loadRoutes()[0].port, ports[1]);
    assert.equal(
      (await get(proxyPort, 'rolling.localhost')).body,
      `port-${ports[1]}`
    );
    assert.equal(finished, false, 'should still be waiting for old request');
    assert.equal((await request).body, `held-${ports[0]}`);
    assert.deepEqual(await rolling, {
      fromPort: ports[0],
      toPort: ports[1],
      generation: 2,
      drained: true,
    });
    assert.equal(app.status.phase, 'running');
    assert.equal(app.status.generation, 2);
    await app.stop();
    assert.deepEqual(store.loadRoutes(), []);
    assert.equal(app.status.phase, 'stopped');
    assert.equal((await get(proxyPort, 'rolling.localhost')).status, 404);
  }));

test('failed startup leaves original route and process healthy', () =>
  fixture(async ({ store, proxyPort, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch({
      env: { FAIL_PORT: String(ports[1]), FAIL_MODE: 'exit' },
    });
    await assert.rejects(app.deploy());
    assert.equal(store.loadRoutes()[0].port, ports[0]);
    assert.equal(
      (await get(proxyPort, 'rolling.localhost')).body,
      `port-${ports[0]}`
    );
    assert.equal(app.status.generation, 1);
  }));

test('failed post-cutover verification rolls traffic back to original', () =>
  fixture(async ({ store, proxyPort, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch({
      env: { FAIL_PORT: String(ports[1]), FAIL_MODE: 'late' },
      verificationChecks: 3,
      verificationIntervalMs: 95,
    });
    await assert.rejects(app.deploy(), /unhealthy/);
    assert.equal(store.loadRoutes()[0].port, ports[0]);
    assert.equal(app.status.generation, 1);
    assert.equal(
      (await get(proxyPort, 'rolling.localhost')).body,
      `port-${ports[0]}`
    );
  }));

test('concurrent deploy requests share an operation and subsequent deploy reuses spare port', () =>
  fixture(async ({ proxyPort, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch();
    /** Allocated fixture port or shared controller operation under test. */
    const p = app.deploy();
    assert.equal(app.deploy(), p);
    /** Observed cutover receipt or small fixture response under assertion. */
    const result = await p;
    assert.equal(result.toPort, ports[1]);
    assert.equal(
      (await get(proxyPort, 'rolling.localhost')).body,
      `port-${ports[1]}`
    );
    /** Second cutover receipt, proving cyclic spare-port reuse. */
    const next = await app.deploy();
    assert.equal(next.toPort, ports[0]);
    assert.equal(
      (await get(proxyPort, 'rolling.localhost')).body,
      `port-${ports[0]}`
    );
  }));

test('stop is idempotent and rejects deployments after shutdown', () =>
  fixture(async ({ store, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch();
    /** Allocated fixture port or shared controller operation under test. */
    const p = app.stop();
    assert.equal(app.stop(), p);
    await p;
    assert.equal(app.status.phase, 'stopped');
    assert.deepEqual(store.loadRoutes(), []);
    await assert.rejects(app.deploy(), /stopping/);
  }));

test('a replaced route lease cannot be overwritten during a deployment', () =>
  fixture(async ({ store, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch({
      verificationChecks: 4,
      verificationIntervalMs: 100,
    });
    /** Pending cutover deliberately raced with a new route owner. */
    const running = app.deploy();
    // Either generation may be serving when another route owner supersedes this lease.
    for (let i = 0; i < 100 && store.loadRoutes()[0].port !== ports[1]; i++) {
      await delay(5);
    }
    /** Replacement fixture route lease, released explicitly after proving the old controller cannot overwrite it. */
    const other = store.registerRoute(
      'rolling.localhost',
      ports[0],
      process.pid,
      true
    );
    await running.catch(() => {});
    await app.stop();
    assert.equal(store.loadRoutes()[0].leaseId, other.leaseId);
    other.release();
  }));

test('WebSocket sessions count as in-flight connections until their tunnel closes', async () => {
  /** Owned synthetic WebSocket upgrade listener. */
  const backend = http.createServer();
  /** Accepted fixture sockets destroyed explicitly before backend listener close. */
  const sockets = new Set();
  backend.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  backend.on('upgrade', (req, socket) => {
    /** Protocol-required synthetic WebSocket handshake digest. */
    const accept = awaitAccept(req.headers['sec-websocket-key']);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n'
    );
  });
  /** Compute the protocol-mandated WebSocket handshake digest for a fixed synthetic client key.
   * @param {string} key - Fixture Sec-WebSocket-Key header.
   * @returns {string} Base64 WebSocket accept value; this legacy protocol hash is not password hashing.
   */
  function awaitAccept(key) {
    return crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
  }
  /** Ephemeral fixture upgrade-backend port. */
  const upstream = await listen(backend);
  /** Owned synthetic proxy whose actual connection tracker drives drain assertions. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'ws.localhost', port: upstream }],
    proxyPort: 0,
    onError: () => {},
  });
  /** Ephemeral fixture proxy port. */
  const port = await listen(proxy);
  let tunnel;
  try {
    tunnel = await new Promise((resolve, reject) => {
      /** Owned synthetic WebSocket upgrade request; never an arbitrary external destination. */
      const req = http.request({
        host: '127.0.0.1',
        port,
        headers: {
          Host: 'ws.localhost',
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': Buffer.alloc(16, 7).toString('base64'),
          'Sec-WebSocket-Version': '13',
        },
      });
      req.once('upgrade', (_res, socket) => resolve(socket));
      req.once('error', reject);
      req.end();
    });
    assert.equal(proxy.backendConnections.active('ws.localhost', upstream), 1);
    assert.equal(
      await proxy.backendConnections.waitForIdle('ws.localhost', upstream, 30),
      false
    );
    tunnel.destroy();
    assert.equal(
      await proxy.backendConnections.waitForIdle('ws.localhost', upstream, 500),
      true
    );
  } finally {
    tunnel?.destroy();
    for (const socket of sockets) {
      socket.destroy();
    }
    await close(proxy);
    await close(backend);
  }
});

test('shutdown during replacement startup cancels publication and removes its lease', () =>
  fixture(async ({ store, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch();
    /** Pending owned replacement operation deliberately raced with shutdown or health failure. */
    const deploying = app.deploy();
    /** Shared owned controller shutdown operation, awaited before reading final route state. */
    const stopping = app.stop();
    await assert.rejects(deploying, /cancelled|stopping/);
    await stopping;
    assert.deepEqual(store.loadRoutes(), []);
    assert.equal(app.status.phase, 'stopped');
  }));

test('drain deadlines are reported rather than falsely claiming idle backends', () =>
  fixture(async ({ proxy, proxyPort, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch({ drainTimeoutMs: 10 });
    /** Pending slow synthetic response used to verify truthful drain deadline reporting. */
    const held = get(proxyPort, 'rolling.localhost', '/hold');
    for (
      let i = 0;
      i < 100 &&
      !proxy.backendConnections.active('rolling.localhost', ports[0]);
      i++
    ) {
      await delay(5);
    }
    assert.equal(
      proxy.backendConnections.active('rolling.localhost', ports[0]),
      1
    );
    /** Observed cutover receipt or small fixture response under assertion. */
    const result = await app.deploy();
    assert.equal(result.drained, false);
    // The child handles graceful SIGTERM; it may still finish the held response.
    await held.catch(() => {});
  }));

test('pre-cutover verification prevents a failing candidate from ever receiving traffic', () =>
  fixture(async ({ store, proxyPort, ports, launch }) => {
    /** Owned synthetic rolling controller, stopped by the shared fixture. */
    const app = await launch({
      env: { FAIL_PORT: String(ports[1]), FAIL_MODE: 'late' },
      preCutoverChecks: 2,
      verificationChecks: 1,
      verificationIntervalMs: 20,
    });
    /** Observed fixture route ports while the candidate health gate fails. */
    const seen = [];
    let stopPolling = false;
    /** Owned asynchronous fixture sampler, stopped and awaited in finally. */
    const poll = (async () => {
      while (!stopPolling) {
        seen.push(store.loadRoutes()[0]?.port);
        await delay(2);
      }
    })();
    /** Small observed fixture responses proving traffic stayed on the healthy generation. */
    const serving = [];
    try {
      /** Pending owned replacement operation deliberately raced with shutdown or health failure. */
      const deploying = app.deploy();
      for (let i = 0; i < 18; i++) {
        /** Observed cutover receipt or small fixture response under assertion. */
        const result = await get(proxyPort, 'rolling.localhost');
        serving.push(result);
        await delay(4);
      }
      await assert.rejects(deploying, /unhealthy before traffic cutover/);
      assert.equal(store.loadRoutes()[0].port, ports[0]);
      assert.equal(app.status.generation, 1);
      assert.ok(serving.length > 0);
      assert.ok(
        serving.every((r) => r.status === 200 && r.body === `port-${ports[0]}`)
      );
    } finally {
      stopPolling = true;
      await poll;
    }
    assert.ok(
      seen.every((port) => port === ports[0]),
      'route was never published to unhealthy candidate'
    );
  }));
