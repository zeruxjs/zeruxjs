import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LinuxFleetResourceSampler,
  parseLinuxProcessStat,
} from '../dist/portless/fleet-resources.js';
/** Render fixed inert /proc stat text with a tricky comm name for parser qualification.
 * @param {number} pid - Expected fixture PID.
 * @param {number} cpu - Fixture user CPU ticks.
 * @param {number} start - Fixture start identity, default 99.
 * @returns {string} Synthetic stat record; never executed as source.
 */
const fakeStat = (pid, cpu, start = 99) =>
  `${pid} (my) tricky name) S ${Array.from({ length: 20 }, (_, i) => {
    if (i === 10) {
      return cpu;
    }
    if (i === 11) {
      return 0;
    }
    if (i === 18) {
      return start;
    }
    return 0;
  }).join(' ')}`;

test('Linux stat parser handles spaces and parentheses, rejects malformed counters', () => {
  assert.deepEqual(parseLinuxProcessStat(fakeStat(4242, 150), 4242), {
    cpuTicks: 150n,
    startTicks: 99n,
  });
  assert.throws(
    () => parseLinuxProcessStat(fakeStat(4242, 150), 4243),
    /Malformed/
  );
  assert.throws(
    () => parseLinuxProcessStat('4242 (bad) S 1', 4242),
    /Incomplete/
  );
  assert.throws(
    () =>
      parseLinuxProcessStat(fakeStat(4242, 150).replace('150', 'oops'), 4242),
    /Invalid/
  );
});

test('resource monitor samples mean CPU and RSS and refuses unwarmed or reused PIDs', () => {
  let time = 0n;
  /** Trusted synthetic child readings used to control CPU, RSS and PID-reuse scenarios. */
  const counters = new Map([
    [
      123,
      { pid: 123, startTicks: 11n, cpuTicks: 0n, rssBytes: 64 * 1024 * 1024 },
    ],
    [
      124,
      { pid: 124, startTicks: 22n, cpuTicks: 0n, rssBytes: 128 * 1024 * 1024 },
    ],
  ]);
  /** Inert injected-reader sampler with bounded baseline state and no timers. */
  const sampler = new LinuxFleetResourceSampler(
    (pid) => counters.get(pid),
    () => time
  );
  assert.throws(() => sampler.sample([123, 124]), /warming/);
  time = 1000000000n;
  counters.get(123).cpuTicks = 100n;
  /** Observed mean per-process resource metrics from fixed counters and clock. */
  const result = sampler.sample([123, 124]);
  assert.equal(result.cpuPercent, 50);
  assert.equal(result.memoryMiB, 96);
  assert.equal(result.maxMemoryMiB, 128);
  assert.throws(() => sampler.sample([123, 123]), /Invalid monitored/);
  time += 1000000000n;
  counters.get(124).startTicks = 33n;
  assert.throws(() => sampler.sample([123, 124]), /identity changed/);
});

test(
  'resource monitor reads real Linux PID without claiming fabricated usage',
  { skip: process.platform !== 'linux' },
  () => {
    /** Native sampler restricted to this test process’s own PID; no operator child is signaled or managed. */
    const monitor = new LinuxFleetResourceSampler();
    assert.throws(() => monitor.sample([process.pid]), /warming/);
    let checksum = 0;
    for (let i = 0; i < 1000000; i++) {
      checksum += i;
    }
    /** Native current-test-process resource observation after baseline priming. */
    const sample = monitor.sample([process.pid]);
    assert.equal(sample.processCount, 1);
    assert.ok(sample.memoryMiB > 0);
    assert.ok(sample.cpuPercent >= 0);
  }
);
