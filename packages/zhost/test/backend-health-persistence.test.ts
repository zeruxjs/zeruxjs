import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BackendPool } from '../dist/portless/backend-pool.js';
import { BackendHealthStore } from '../dist/portless/backend-health-state.js';

/** Create an owned private temporary checkpoint directory.
 * @returns {string} Directory removed by each test’s finally block.
 */
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-health-'));
/** Create a synthetic route generation for persistence and stale-callback checks.
 * @param {string} leaseId - Fixture generation identity.
 * @returns {object} Local route with two backend ports.
 */
const route = (leaseId) => ({
  hostname: 'persist.localhost',
  pid: 1234,
  leaseId,
  port: 4300,
  backends: [{ port: 4300 }, { port: 4301 }],
});
/** First synthetic generation identity; not an operator route lease. */
const leaseA = 'a0000000-0000-4000-8000-000000000001';
/** Replacement synthetic generation identity. */
const leaseB = 'b0000000-0000-4000-8000-000000000002';

test('circuit-breaker checkpoint survives proxy recreation for the same route generation', () => {
  /** Owned private temporary directory removed after all pool cleanup. */
  const dir = fixture();
  try {
    /** First pool generation, flushed and closed before constructing its replacement. */
    const original = new BackendPool(() => [route(leaseA)], {
      stateDir: dir,
      cooldownMs: 300000,
    });
    original.sync([route(leaseA)]);
    original.markFailure('persist.localhost', 4301);
    original.flushHealth();
    original.close();
    /** Detached health checkpoint used to assert persisted failure counters. */
    const saved = new BackendHealthStore(dir).read();
    assert.equal(saved.length, 2);
    assert.ok(saved.find((v) => v.port === 4301).failures >= 1);
    /** Owned restarted pool that must restore only the matching route generation. */
    const reloaded = new BackendPool(() => [route(leaseA)], {
      stateDir: dir,
      cooldownMs: 300000,
    });
    try {
      reloaded.sync([route(leaseA)]);
      assert.equal(
        reloaded.status().find((v) => v.port === 4301).healthy,
        false
      );
      assert.deepEqual(
        Array.from({ length: 3 }, () => reloaded.select(route(leaseA)).port),
        [4300, 4300, 4300]
      );
      reloaded.markSuccess(
        'persist.localhost',
        4301,
        reloaded.signature(route(leaseA))
      );
      reloaded.flushHealth();
    } finally {
      reloaded.close();
    }
    /** Owned pool reopened after successful health clears the persisted isolation. */
    const recovered = new BackendPool(() => [route(leaseA)], { stateDir: dir });
    try {
      recovered.sync([route(leaseA)]);
      assert.equal(
        recovered.status().find((v) => v.port === 4301).healthy,
        true
      );
    } finally {
      recovered.close();
    }
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test('route takeover discards old breaker, late upstream callbacks cannot poison new route', () => {
  /** Owned private temporary directory removed after all pool cleanup. */
  const dir = fixture();
  try {
    let current = route(leaseA);
    /** Owned pool whose timers/state are released in finally. */
    const pool = new BackendPool(() => [current], {
      stateDir: dir,
      cooldownMs: 300000,
    });
    try {
      pool.sync([current]);
      /** Prior generation fingerprint supplied by an intentionally stale callback. */
      const oldKey = pool.signature(current);
      pool.markFailure('persist.localhost', 4301, oldKey);
      current = route(leaseB);
      pool.sync([current]);
      assert.equal(pool.status().find((v) => v.port === 4301).healthy, true);
      pool.markFailure('persist.localhost', 4301, oldKey);
      assert.equal(pool.status().find((v) => v.port === 4301).healthy, true);
      pool.markFailure('persist.localhost', 4301, pool.signature(current));
      assert.equal(pool.status().find((v) => v.port === 4301).healthy, false);
    } finally {
      pool.close();
    }
    /** Owned pool whose generation must not inherit a different lease’s failures. */
    const reopened = new BackendPool(() => [route(leaseA)], { stateDir: dir });
    try {
      reopened.sync([route(leaseA)]);
      assert.equal(
        reopened.status().find((v) => v.port === 4301).healthy,
        true
      );
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test('old snapshots expire, invalid and symlink snapshots fail closed', () => {
  /** Owned private temporary directory removed after all pool cleanup. */
  const dir = fixture();
  try {
    /** Bounded checkpoint store operating only inside this fixture directory. */
    const store = new BackendHealthStore(dir, 1000);
    store.write([], Date.now() - 6000);
    assert.deepEqual(store.read(), []);
    fs.writeFileSync(store.file, '{"version":1,"savedAt":0,"entries":"bad"}', {
      mode: 0o600,
    });
    assert.throws(() => store.read(), /Invalid/);
    fs.rmSync(store.file);
    fs.symlinkSync('/etc/passwd', store.file);
    assert.throws(() => store.read(), /Unsafe/);
    assert.throws(() => store.write([]), /Unsafe/);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test('persistence coalesces writes and validates checkpoint limits', async () => {
  /** Owned private temporary directory removed after all pool cleanup. */
  const dir = fixture();
  try {
    /** Owned pool whose timers/state are released in finally. */
    const pool = new BackendPool(() => [route(leaseA)], {
      stateDir: dir,
      persistDebounceMs: 30,
    });
    try {
      pool.sync([route(leaseA)]);
      for (let n = 0; n < 20; n++) {
        pool.markFailure('persist.localhost', 4301);
      }
      assert.equal(fs.existsSync(path.join(dir, 'backend-health.json')), false);
      await new Promise((r) => setTimeout(r, 85));
      assert.equal(
        new BackendHealthStore(dir).read().find((x) => x.port === 4301)
          .failures,
        20
      );
    } finally {
      pool.close();
    }
    assert.throws(() => new BackendHealthStore(dir, -1), /maxAge/);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});
