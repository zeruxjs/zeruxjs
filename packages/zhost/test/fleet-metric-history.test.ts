import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FleetMetricHistory,
  readFleetMetricHistory,
  fleetMetricHistoryPath,
} from '../dist/portless/fleet-metric-history.js';
/** Create a private synthetic state directory; each caller removes it in finally.
 * @returns {string} Owned temporary directory path. */
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-history-'));
test('metrics persist privately, survive restarts, and throttle writes', () => {
  /** Owned private temporary state directory removed in the fixture cleanup. */
  const dir = temp();
  /** Fixed synthetic metric namespace, excluding subject identifiers. */
  const hostname = 'history.localhost';
  try {
    /** Controlled observation clock sufficiently old to permit two known throttled writes. */
    const now = Date.now() - 35000;
    /** Valid fixed CPU aggregate without user/request dimensions. */
    const point = {
      sampledAt: now,
      metric: 'cpu',
      value: 35,
      desiredReplicas: 2,
      downscaleAllowed: true,
    };
    /** Single-writer private history fixture, with no background timer. */
    const writer = new FleetMetricHistory(dir, hostname);
    assert.equal(writer.record(point, now), true);
    assert.equal(
      writer.record({ ...point, sampledAt: now + 1000 }, now + 1000),
      false
    );
    assert.equal(
      new FleetMetricHistory(dir, hostname).record(
        { ...point, sampledAt: now + 31000 },
        now + 31000
      ),
      true
    );
    assert.equal(readFleetMetricHistory(dir, hostname, now + 31000).length, 2);
    assert.equal(
      fs.statSync(fleetMetricHistoryPath(dir, hostname)).mode & 0o077,
      0
    );
    assert.deepEqual(
      readFleetMetricHistory(dir, hostname, now + 2 * 24 * 60 * 60 * 1000),
      []
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('symlinks and invalid metric history are refused rather than overwritten', () => {
  /** Owned private temporary state directory removed in the fixture cleanup. */
  const dir = temp();
  /** Fixed synthetic metric namespace, excluding subject identifiers. */
  const hostname = 'history.localhost';
  try {
    /** Hashed fixture history destination used for corruption/symlink denial assertions. */
    const file = fleetMetricHistoryPath(dir, hostname);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.symlinkSync('/etc/passwd', file);
    assert.throws(() => readFleetMetricHistory(dir, hostname), /Unsafe/);
    assert.throws(() => new FleetMetricHistory(dir, hostname), /Unsafe/);
    fs.unlinkSync(file);
    fs.writeFileSync(file, 'not JSON', { mode: 0o600 });
    assert.throws(() => readFleetMetricHistory(dir, hostname));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
