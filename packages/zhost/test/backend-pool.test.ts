import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  BackendPool,
  validateBackends,
} from '../dist/portless/backend-pool.js';

/** Synthetic weighted route fixture; no route files or operator state are used. */
const route = {
  hostname: 'pool.localhost',
  port: 10001,
  backends: [
    { port: 10001, weight: 1 },
    { port: 10002, weight: 3 },
  ],
};
/** Bind an owned fixture server to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Test-owned server.
 * @returns {Promise<number>} Actual assigned port, or listener failure.
 */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
/** Await closure of a test-owned server.
 * @param {import("node:http").Server} server - Fixture listener to release.
 * @returns {Promise<void>} Resolves when the listener closes.
 */
const close = (server) => new Promise((resolve) => server.close(resolve));

test('validates bounded local backend pool without duplicates', () => {
  assert.deepEqual(validateBackends([{ port: 6000 }]), [{ port: 6000 }]);
  for (const ports of [
    [],
    [{ port: 0 }],
    [{ port: 6000 }, { port: 6000 }],
    [{ port: 6001, weight: 0 }],
    Array.from({ length: 33 }, (_, i) => ({ port: 10000 + i })),
  ]) {
    assert.throws(() => validateBackends(ports));
  }
  assert.deepEqual(validateBackends([{ port: 6001, weight: 10 }]), [
    { port: 6001, weight: 10 },
  ]);
});

test('smooth weighted round-robin honors weights and does not duplicate state', () => {
  /** Owned selector/health timers, closed in the fixture finally block. */
  const pool = new BackendPool(() => [route]);
  try {
    pool.sync([route]);
    /** Deterministic weighted choices used to verify the expected 1:3 allocation. */
    const selections = Array.from(
      { length: 40 },
      () => pool.select(route).port
    );
    assert.equal(selections.filter((p) => p === 10001).length, 10);
    assert.equal(selections.filter((p) => p === 10002).length, 30);
    assert.equal(pool.status().length, 2);
  } finally {
    pool.close();
  }
});

test('failed endpoint is isolated and can recover after cooldown', async () => {
  /** Owned selector/health timers, closed in the fixture finally block. */
  const pool = new BackendPool(() => [route], { cooldownMs: 100 });
  try {
    pool.sync([route]);
    pool.markFailure(route.hostname, 10002);
    for (let i = 0; i < 5; i++) {
      assert.equal(pool.select(route).port, 10001);
    }
    assert.equal(pool.status().find((x) => x.port === 10002).healthy, false);
    await new Promise((r) => setTimeout(r, 115));
    assert.equal(pool.status().find((x) => x.port === 10002).healthy, true);
    assert.ok(
      Array.from({ length: 8 }, () => pool.select(route).port).includes(10002)
    );
  } finally {
    pool.close();
  }
});

test('active probes isolate an offline instance and admit it after recovery', async () => {
  /** Owned loopback HTTP fixture used for active health observations. */
  const live = http.createServer((req, res) => res.end('ok'));
  /** Ephemeral healthy backend port. */
  const livePort = await listen(live);
  /** Temporary listener used only to allocate a port before testing an absent backend. */
  const temp = http.createServer();
  /** Unbound ephemeral port representing a failed backend. */
  const absent = await listen(temp);
  await close(temp);
  /** Synthetic two-backend route with one healthy and one initially absent endpoint. */
  const config = {
    hostname: 'probe.localhost',
    port: livePort,
    backends: [{ port: livePort }, { port: absent }],
  };
  /** Owned selector/health timers, closed in the fixture finally block. */
  const pool = new BackendPool(() => [config], {
    failureThreshold: 2,
    probe: { path: '/health' },
  });
  try {
    await pool.checkNow();
    await pool.checkNow();
    assert.equal(
      pool.status().find((item) => item.port === absent).healthy,
      false
    );
    assert.equal(pool.select(config).port, livePort);
    // Once the instance binds the same port, a successful active probe restores it.
    /** Owned listener bound to the failed port to prove health rehabilitation. */
    const restored = http.createServer((req, res) => res.end('ok'));
    await new Promise((resolve, reject) => {
      restored.once('error', reject);
      restored.listen(absent, '127.0.0.1', resolve);
    });
    try {
      await pool.checkNow();
      assert.equal(
        pool.status().find((item) => item.port === absent).healthy,
        true
      );
    } finally {
      await close(restored);
    }
  } finally {
    pool.close();
    await close(live);
  }
});

test('removed backends and routes disappear from the pool', () => {
  let routes = [route];
  /** Owned selector/health timers, closed in the fixture finally block. */
  const pool = new BackendPool(() => routes);
  try {
    pool.sync(routes);
    assert.equal(pool.status().length, 2);
    routes = [{ hostname: 'pool.localhost', port: 10001 }];
    pool.sync(routes);
    assert.deepEqual(
      pool.status().map((x) => x.port),
      [10001]
    );
    pool.sync([]);
    assert.deepEqual(pool.status(), []);
  } finally {
    pool.close();
  }
});
