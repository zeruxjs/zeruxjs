import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackendConnections } from '../dist/portless/backend-connections.js';
import {
  createProxyConnectionControl,
  RemoteBackendConnections,
} from '../dist/portless/proxy-control.js';

/** Create an owned private metrics-control fixture directory.
 * @returns {string} Directory removed after control teardown.
 */
const makeState = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-metrics-'));
test('metrics count completed requests and active sessions without inflating duplicates', () => {
  /** In-memory connection accounting fixture; each acquired session is explicitly released. */
  const observer = new BackendConnections();
  /** Idempotent release for the first synthetic active session. */
  const release = observer.track('abc.localhost', 4001);
  /** Release for the second synthetic session, retained to verify active count. */
  const also = observer.track('abc.localhost', 4001);
  observer.track('abc.localhost', 4002)();
  release();
  /** Bounded metrics snapshot under test. */
  const result = observer.metrics('abc.localhost', [4001, 4002], 30000);
  assert.equal(result.requests, 3);
  assert.equal(result.activeConnections, 1);
  assert.equal(result.requestsPerSecond, 0.1);
  assert.ok(Math.abs(result.sampledAt - Date.now()) < 1000);
  also();
  assert.equal(
    observer.metrics('abc.localhost', [4001, 4002]).activeConnections,
    0
  );
});

test('metrics enforce bounded port lists and sample windows', () => {
  /** In-memory connection accounting fixture; each acquired session is explicitly released. */
  const observer = new BackendConnections();
  for (const windowMs of [-1, 100, 60001, NaN]) {
    assert.throws(
      () => observer.metrics('abc.localhost', [4400], windowMs),
      /Invalid/
    );
  }
  assert.throws(() => observer.metrics('abc.localhost', []), /Invalid/);
  assert.throws(
    () =>
      observer.metrics(
        'abc.localhost',
        Array.from({ length: 18 }, (_, i) => 4400 + i)
      ),
    /Invalid/
  );
});

test('authenticated loopback proxy metrics report real request arrivals', async () => {
  /** Private temporary control-state directory owned by this test. */
  const dir = makeState();
  /** In-memory connection accounting fixture; each acquired session is explicitly released. */
  const observer = new BackendConnections();
  let control;
  try {
    control = await createProxyConnectionControl(dir, observer);
    /** Borrowed remote metrics client; the control server owns listener teardown. */
    const client = new RemoteBackendConnections(dir);
    /** Synthetic session release, called after observing its active count. */
    const finish = observer.track('api.localhost', 4200);
    observer.track('api.localhost', 4201)();
    /** Bounded metrics snapshot under test. */
    const result = await client.metrics('api.localhost', [4200, 4201], 10000);
    assert.equal(result.requests, 2);
    assert.equal(result.activeConnections, 1);
    finish();
    await assert.rejects(
      client.metrics('api.localhost', [4200], 100),
      /Invalid/
    );
    await assert.rejects(client.metrics('api.localhost', [0], 10000), /port/i);
  } finally {
    await control?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
