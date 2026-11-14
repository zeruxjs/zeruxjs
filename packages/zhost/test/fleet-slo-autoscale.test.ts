import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AutoscalePolicy,
  validateAutoscaleConfig,
  DEFAULT_AUTOSCALE,
} from '../dist/portless/autoscale-policy.js';
import { createFleetAutoscaler } from '../dist/portless/fleet-autoscaler.js';
import { parseFleetRunArguments } from '../dist/bin/parse-fleet.js';
/** Explicit deterministic enabled policy fixture shared by resource/safety checks. */
const base = {
  ...DEFAULT_AUTOSCALE,
  enabled: true,
  minReplicas: 2,
  maxReplicas: 4,
  consecutiveSamples: 1,
  cooldownMs: 0,
  sampleIntervalMs: 300000,
  windowMs: 30000,
};

test('CPU and memory policy use measured per-child usage rather than dividing by replica count', () => {
  /** Local policy fixture for known metric thresholds and safety guards. */
  const p = new AutoscalePolicy({
    ...base,
    metric: 'cpu',
    scaleUpThreshold: 70,
    scaleDownThreshold: 20,
  });
  assert.equal(p.observe(80, 2), 3);
  assert.equal(p.observe(10, 3), 2);
  /** Separate memory-mode policy proving values are not divided by replica count. */
  const rss = new AutoscalePolicy({
    ...base,
    metric: 'memory',
    scaleUpThreshold: 512,
    scaleDownThreshold: 100,
  });
  assert.equal(rss.observe(600, 2), 3);
  assert.equal(rss.observe(50, 3), 2);
  assert.throws(
    () =>
      validateAutoscaleConfig(
        {
          ...base,
          metric: 'memory',
          scaleUpThreshold: 5,
          scaleDownThreshold: 6,
        },
        5,
        2
      ),
    /threshold/
  );
});

test('scale-down safety guards block unhealthy service without consuming cooldown', () => {
  /** Local policy fixture for known metric thresholds and safety guards. */
  const p = new AutoscalePolicy({
    ...base,
    maxErrorRate: 0.05,
    maxP95LatencyMs: 500,
  });
  assert.equal(p.observe(0, 3, 100, true), 2);
  assert.equal(p.observe(0, 3, 101, false), null);
  assert.match(p.snapshot.lastDecision, /blocked/);
  assert.equal(p.observe(0, 3, 102, true), 2);
});

test('CPU autoscaler reads member PIDs and validates resource timestamps before changing capacity', async () => {
  /** Recorded synthetic capacity requests from the injected controller. */
  const changes = [];
  let desired = 2;
  /** Synthetic native-PID observations; resource reads are injected and never target these PIDs. */
  const members = Array.from({ length: 3 }, (_, i) => ({
    pid: 321 + i,
    port: 4400 + i,
    healthy: true,
    routed: true,
  }));
  /** Injected controller recording requested target changes without launching children. */
  const fleet = {
    get status() {
      return {
        phase: 'running',
        hostname: 'api.localhost',
        desiredReplicas: desired,
        members: members.slice(0, desired),
      };
    },
    async scaleTo(n) {
      changes.push(n);
      desired = n;
    },
  };
  /** Injected bounded fresh native-resource result with matching process count. */
  const resource = {
    sample(pids) {
      assert.equal(pids.length, desired);
      return {
        sampledAt: Date.now(),
        processCount: pids.length,
        cpuPercent: 90,
        memoryMiB: 100,
        maxMemoryMiB: 100,
      };
    },
  };
  /** Injected telemetry source proving when traffic sampling is required. */
  const source = {
    metrics() {
      throw Error('no traffic fetch needed');
    },
  };
  /** Explicit CPU-mode fixture with known upper/lower thresholds. */
  const config = {
    ...base,
    metric: 'cpu',
    scaleUpThreshold: 70,
    scaleDownThreshold: 20,
  };
  /** Owned sampling timer stopped in finally; tests invoke sample directly. */
  const auto = createFleetAutoscaler(
    fleet,
    [4400, 4401, 4402, 4403, 4404],
    source,
    config,
    undefined,
    undefined,
    resource
  );
  try {
    await auto.sample();
    assert.deepEqual(changes, [3]);
    assert.equal(auto.lastObservation.metric, 'cpu');
  } finally {
    auto.stop();
  }
});

test('high error rate blocks scale-down, while healthy request metrics permit it', async () => {
  let desired = 3,
    errorRate = 0.25;
  /** Recorded synthetic scale requests under changing HTTP quality coverage. */
  const calls = [];
  /** Injected controller recording requested target changes without launching children. */
  const fleet = {
    get status() {
      return {
        phase: 'running',
        hostname: 'api.localhost',
        desiredReplicas: desired,
        members: Array.from({ length: desired }, (_, i) => ({
          pid: 123 + i,
          port: 4400 + i,
          healthy: true,
          routed: true,
        })),
      };
    },
    async scaleTo(n) {
      calls.push(n);
      desired = n;
    },
  };
  /** Injected telemetry source proving when traffic sampling is required. */
  const source = {
    metrics: (host, ports, windowMs) => ({
      hostname: host,
      requests: 0,
      requestsPerSecond: 0,
      activeConnections: 0,
      windowMs,
      sampledAt: Date.now(),
      completedRequests: 20,
      serverErrors: Math.round(errorRate * 20),
      errorRate,
      p95LatencyMs: 120,
    }),
  };
  /** Owned sampling timer stopped in finally; tests invoke sample directly. */
  const auto = createFleetAutoscaler(
    fleet,
    [4400, 4401, 4402, 4403, 4404],
    source,
    { ...base, maxErrorRate: 0.1 }
  );
  try {
    await auto.sample();
    assert.deepEqual(calls, []);
    assert.equal(auto.lastObservation.downscaleAllowed, false);
    errorRate = 0;
    await auto.sample();
    assert.deepEqual(calls, [2]);
  } finally {
    auto.stop();
  }
});

test('CLI validates resource thresholds and optional error/latency guards', () => {
  /** Literal trusted CLI argument fixture; no command or server is executed. */
  const run = [
    '--name',
    'api',
    '--ports',
    '4400,4401,4402,4403',
    '--replicas',
    '2',
    '--autoscale',
    '--scale-mode',
    'memory',
    '--scale-up',
    '512',
    '--scale-down',
    '256',
    '--scale-max-error-rate',
    '0.1',
    '--scale-max-p95',
    '900',
    '--',
    'node',
    'server.js',
  ];
  /** Parsed public CLI options checked against declared host policy. */
  const options = parseFleetRunArguments(run);
  assert.equal(options.autoscale.metric, 'memory');
  assert.equal(options.autoscale.maxErrorRate, 0.1);
  assert.throws(
    () =>
      parseFleetRunArguments(
        run.filter(
          (x, i) => x !== '--scale-down' && run[i - 1] !== '--scale-down'
        )
      ),
    /requires/
  );
  assert.throws(
    () => parseFleetRunArguments(run.map((x) => (x === '512' ? 'no' : x))),
    /Invalid/
  );
});
