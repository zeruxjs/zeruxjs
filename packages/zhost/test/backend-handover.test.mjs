import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { RouteStore } from '../dist/portless/routes.js';
import { handoverBackends } from '../dist/portless/handover.js';
import { createProxyServer } from '../dist/portless/proxy.js';

/** Bind an owned synthetic listener to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Fixture listener.
 * @returns {Promise<number>} Actual assigned fixture port.
 */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
/** Await the owned fixture listener’s native close callback.
 * @param {import("node:http").Server} server - Active fixture listener.
 * @returns {Promise<unknown>} Native close callback settlement.
 */
const close = (server) => new Promise((resolve) => server.close(resolve));
/** Consume one small synthetic response from an owned fixture proxy.
 * @param {number} port - Ephemeral proxy port.
 * @param {string} host - Fixed fixture route hostname.
 * @returns {Promise<object>} Observed status and small body.
 */
const get = (port, host) =>
  new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, headers: { Host: host } }, (res) => {
        let body = '';
        res.on('data', (data) => (body += data));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
/** Own private route-file state around synthetic assertions.
 * @param {(store: RouteStore, dir: string) => unknown} fn - Trusted fixture assertions, optionally returning a promise.
 * @returns {Promise<unknown>} Assertion result after private state removal.
 */
const fixture = async (fn) => {
  /** Owned private temporary route root, removed after the callback’s transport cleanup. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-pool-'));
  try {
    return await fn(new RouteStore(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('pool registration persists validated targets, and lease removal is conditional', () =>
  fixture((store) => {
    /** Owned synthetic registration whose callbacks must not mutate a superseding lease. */
    const lease = store.registerPoolRoute(
      'multi.localhost',
      [{ port: 4500, weight: 2 }, { port: 4501 }],
      process.pid
    );
    assert.deepEqual(store.loadRoutes()[0].backends, [
      { port: 4500, weight: 2 },
      { port: 4501 },
    ]);
    assert.equal(lease.switchBackends([{ port: 4501 }]), true);
    assert.deepEqual(store.loadRoutes()[0].backends, [{ port: 4501 }]);
    assert.equal(store.loadRoutes()[0].port, 4501);
    /** New fixture registration, explicitly released after rejecting stale lease mutation. */
    const successor = store.registerPoolRoute(
      'multi.localhost',
      [{ port: 4502 }],
      process.pid
    );
    assert.equal(lease.switchBackends([{ port: 4503 }]), false);
    assert.equal(lease.release(), false);
    assert.equal(store.loadRoutes()[0].port, 4502);
    assert.equal(successor.release(), true);
  }));

test('invalid on-disk backend pools are rejected without overwriting registry', () =>
  fixture((store, dir) => {
    store.ensureDir();
    /** Fixed routes.json fixture path used only to test corrupt-data rejection. */
    const file = path.join(dir, 'routes.json');
    for (const backends of [
      [{ port: 4001 }, { port: 4001 }],
      [],
      [{ port: 4002 }],
      [{ port: 4001, weight: 200 }],
    ]) {
      /** Inert invalid synthetic registry bytes that must survive a rejected write unchanged. */
      const raw = JSON.stringify([
        { hostname: 'multi.localhost', port: 4001, pid: 0, backends },
      ]);
      fs.writeFileSync(file, raw);
      assert.throws(() => store.addRoute('other.localhost', 4003, process.pid));
      assert.equal(fs.readFileSync(file, 'utf8'), raw);
    }
  }));

test('health-checked handover never switches to an unreachable target', () =>
  fixture(async (store) => {
    /** Owned synthetic old-generation listener. */
    const original = http.createServer((req, res) => res.end('old'));
    /** Owned synthetic healthy replacement listener. */
    const next = http.createServer((req, res) => res.end('new'));
    /** Ephemeral old-generation backend port. */
    const originalPort = await listen(original);
    /** Ephemeral healthy replacement backend port. */
    const nextPort = await listen(next);
    /** Temporary listener closed before probing a deliberately unreachable backend. */
    const empty = http.createServer();
    /** Unbound fixture port representing dependency failure, not an operator application. */
    const deadPort = await listen(empty);
    await close(empty);
    /** Owned synthetic registration whose callbacks must not mutate a superseding lease. */
    const lease = store.registerPoolRoute(
      'multi.localhost',
      [{ port: originalPort }],
      process.pid
    );
    /** Owned synthetic proxy, closed before its upstream fixture listeners. */
    const proxy = createProxyServer({
      getRoutes: () => store.loadRoutes(),
      proxyPort: 0,
      onError: () => {},
    });
    /** Ephemeral proxy listener port. */
    const port = await listen(proxy);
    try {
      assert.equal((await get(port, 'multi.localhost')).body, 'old');
      assert.equal(
        await handoverBackends(lease, [{ port: deadPort }], {
          health: { path: '/health', timeoutMs: 200 },
        }),
        false
      );
      assert.equal(store.loadRoutes()[0].port, originalPort);
      assert.equal(
        await handoverBackends(lease, [{ port: nextPort }], {
          health: { path: '/health', timeoutMs: 500 },
        }),
        true
      );
      assert.equal((await get(port, 'multi.localhost')).body, 'new');
      /** Superseding fixture lease, released after stale-owner cutover rejection. */
      const newer = store.registerRoute(
        'multi.localhost',
        nextPort,
        process.pid
      );
      assert.equal(
        await handoverBackends(lease, [{ port: originalPort }]),
        false
      );
      newer.release();
    } finally {
      await close(proxy);
      await close(original);
      await close(next);
    }
  }));

test('HTTP traffic distributes over instances and skips a failed instance', async () => {
  /** Owned synthetic old/healthy listener, never a user-managed server. */
  const first = http.createServer((req, res) => res.end('first'));
  /** Owned synthetic second listener, closed deliberately for passive-failure isolation or in final teardown. */
  const second = http.createServer((req, res) => res.end('second'));
  /** Ephemeral first-backend port. */
  const a = await listen(first);
  /** Ephemeral second-backend port. */
  const b = await listen(second);
  /** Fixed synthetic backend inventory for weighted traffic/failure assertions. */
  const route = {
    hostname: 'multi.localhost',
    port: a,
    backends: [{ port: a }, { port: b }],
  };
  /** Owned synthetic proxy, closed before its upstream fixture listeners. */
  const proxy = createProxyServer({
    getRoutes: () => [route],
    proxyPort: 0,
    onError: () => {},
  });
  /** Ephemeral proxy listener port. */
  const port = await listen(proxy);
  try {
    /** Small observed successful fixture responses used to verify deterministic distribution. */
    const replies = await Promise.all(
      Array.from({ length: 10 }, () => get(port, 'multi.localhost'))
    );
    assert.equal(replies.filter((x) => x.body === 'first').length, 5);
    assert.equal(replies.filter((x) => x.body === 'second').length, 5);
    await close(second);
    // First attempt may fail once, but subsequent requests avoid that port.
    /** Observed dependency-failure responses; at least one must reflect the attempted failed backend. */
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => get(port, 'multi.localhost'))
    );
    assert.ok(responses.some((x) => x.status === 502));
    for (let i = 0; i < 6; i++) {
      assert.deepEqual(await get(port, 'multi.localhost'), {
        status: 200,
        body: 'first',
      });
    }
    proxy.backendPool.markFailure(route.hostname, a);
    assert.equal((await get(port, 'multi.localhost')).status, 503);
  } finally {
    await close(proxy);
    await close(first);
  }
});

test('a handover keeps in-flight requests connected to the old application', () =>
  fixture(async (store) => {
    let releaseOld;
    /** Fixture server-allocation promise; actual held-request arrival is checked separately through releaseOld. */
    const oldStarted = new Promise((resolve) => {
      /** Owned synthetic old/healthy listener, never a user-managed server. */
      const first = http.createServer((req, res) => {
        if (req.url === '/hold') {
          releaseOld = () => res.end('old-finished');
          resolve();
        } else {
          res.end('old');
        }
      });
      resolve(first);
    });
    /** Owned synthetic old/healthy listener, never a user-managed server. */
    const first = await oldStarted;
    /** Owned synthetic second listener, closed deliberately for passive-failure isolation or in final teardown. */
    const second = http.createServer((req, res) => res.end('new'));
    /** Ephemeral first-backend port. */
    const a = await listen(first);
    /** Ephemeral second-backend port. */
    const b = await listen(second);
    /** Owned synthetic registration whose callbacks must not mutate a superseding lease. */
    const lease = store.registerRoute('switch.localhost', a, process.pid);
    /** Owned synthetic proxy, closed before its upstream fixture listeners. */
    const proxy = createProxyServer({
      getRoutes: () => store.loadRoutes(),
      proxyPort: 0,
      onError: () => {},
    });
    /** Ephemeral handover fixture proxy port. */
    const proxyPort = await listen(proxy);
    try {
      /** Owned pending old-generation response, completed before native listener teardown. */
      const inFlight = new Promise((resolve, reject) => {
        http
          .get(
            {
              host: '127.0.0.1',
              port: proxyPort,
              path: '/hold',
              headers: { Host: 'switch.localhost' },
            },
            (res) => {
              let body = '';
              res.on('data', (d) => (body += d));
              res.on('end', () => resolve(body));
            }
          )
          .on('error', reject);
      });
      for (let i = 0; i < 100 && !releaseOld; i++) {
        await new Promise((r) => setTimeout(r, 2));
      }
      assert.ok(releaseOld, 'in-flight request reached old app');
      assert.equal(await handoverBackends(lease, [{ port: b }]), true);
      assert.equal((await get(proxyPort, 'switch.localhost')).body, 'new');
      releaseOld();
      assert.equal(await inFlight, 'old-finished');
    } finally {
      releaseOld?.();
      await close(proxy);
      await close(first);
      await close(second);
    }
  }));
