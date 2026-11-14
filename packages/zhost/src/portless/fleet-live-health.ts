/** Read-only service health evaluation for a live local fleet.
 * Unlike the offline checkpoint doctor, these decisions use current proxy telemetry.
 */
import type { FleetStatus } from './fleet-types.js';
import type { FleetLoadMetrics } from './fleet-autoscaler.js';
export interface LiveFleetHealthOptions {
  /** Maximum allowed HTTP error fraction from zero through one, default 0.05. */
  maxErrorRate?: number;
  /** Maximum acceptable sampled p95 milliseconds, default 2000. */
  maxP95LatencyMs?: number;
  /** Maximum telemetry age in milliseconds, default 15000. */
  maxMetricAgeMs?: number;
}
export interface LiveFleetHealthReport {
  /** Host-authorized operational route label. */
  hostname: string;
  /** True only when no evaluated failure remains; not an authorization decision. */
  healthy: boolean;
  /** Count of members marked both healthy and routed in the supplied snapshot. */
  readyReplicas: number;
  /** Requested capacity copied from the controller snapshot. */
  desiredReplicas: number;
  /** Observed proxy arrival rate for this fleet. */
  requestsPerSecond: number;
  /** Observed HTTP error fraction, or null when unavailable. */
  errorRate: number | null;
  /** Observed approximate p95 latency, or null when unavailable. */
  p95LatencyMs: number | null;
  /** Frozen operational failure explanations; keep host-only. */
  failures: readonly string[];
  /** Frozen coverage and prior-failure warnings; no private request data is included. */
  warnings: readonly string[];
}
/** Evaluate existing fleet and proxy observations against bounded host thresholds; this does not probe processes or authorize requests.
 * @param {Readonly<FleetStatus>} status - Published host controller snapshot.
 * @param {FleetLoadMetrics} metrics - Borrowed proxy aggregate for the same hostname.
 * @param {LiveFleetHealthOptions} config - Optional bounded error, latency and freshness thresholds.
 * @param {number} now - Host-supplied epoch milliseconds, defaulting to the current clock.
 * @returns {LiveFleetHealthReport} Detached quality receipt; absent samples produce warnings rather than invented zero latency.
 */
export function evaluateFleetLiveHealth(
  status: Readonly<FleetStatus>,
  metrics: FleetLoadMetrics,
  config: LiveFleetHealthOptions = {},
  now = Date.now()
): LiveFleetHealthReport {
  /** Validated maximum acceptable HTTP error fraction. */
  const errorLimit = config.maxErrorRate ?? 0.05;
  /** Validated maximum acceptable approximate p95 latency in milliseconds. */
  const latencyLimit = config.maxP95LatencyMs ?? 2000;
  /** Validated maximum clock distance for the telemetry observation. */
  const ageLimit = config.maxMetricAgeMs ?? 15000;
  if (
    metrics.hostname !== status.hostname ||
    !Number.isSafeInteger(now) ||
    !Number.isFinite(errorLimit) ||
    errorLimit < 0 ||
    errorLimit > 1 ||
    !Number.isSafeInteger(latencyLimit) ||
    latencyLimit < 1 ||
    latencyLimit > 300000 ||
    !Number.isSafeInteger(ageLimit) ||
    ageLimit < 1000 ||
    ageLimit > 300000
  ) {
    throw new TypeError('Invalid live fleet health inputs');
  }
  /** Per-evaluation quality failures; no process or route is mutated. */
  const failures: string[] = [];
  /** Coverage notices that do not alone mark quality failed. */
  const warnings: string[] = [];
  /** Supplied snapshot members currently marked healthy and routed. */
  const ready = status.members.filter((m) => m.routed && m.healthy).length;
  if (status.phase !== 'running') {
    failures.push(`Fleet phase is ${status.phase}`);
  }
  if (ready < status.desiredReplicas) {
    failures.push(
      `Only ${ready}/${status.desiredReplicas} replicas are healthy`
    );
  }
  if (
    !Number.isSafeInteger(metrics.sampledAt) ||
    Math.abs(now - metrics.sampledAt) > ageLimit
  ) {
    failures.push('Proxy telemetry is missing or stale');
  }
  if (
    !Number.isFinite(metrics.requestsPerSecond) ||
    metrics.requestsPerSecond < 0
  ) {
    failures.push('Invalid request throughput');
  }
  /** Nullable coverage-aware observed HTTP error ratio. */
  const errorRate = metrics.errorRate ?? null;
  /** Nullable coverage-aware approximate p95 latency. */
  const latency = metrics.p95LatencyMs ?? null;
  if (
    errorRate !== null &&
    (!Number.isFinite(errorRate) || errorRate < 0 || errorRate > 1)
  ) {
    failures.push('Invalid HTTP error ratio');
  } else if (errorRate !== null && errorRate > errorLimit) {
    failures.push(`HTTP error ratio exceeds ${errorLimit}`);
  }
  if (latency !== null && (!Number.isFinite(latency) || latency < 0)) {
    failures.push('Invalid latency sample');
  } else if (latency !== null && latency > latencyLimit) {
    failures.push(`HTTP p95 latency exceeds ${latencyLimit}ms`);
  }
  if (!metrics.completedRequests) {
    warnings.push('Not enough completed requests to evaluate HTTP quality');
  }
  if (status.lastError) {
    warnings.push(`Last process error: ${status.lastError.slice(0, 180)}`);
  }
  return {
    hostname: status.hostname,
    healthy: !failures.length,
    readyReplicas: ready,
    desiredReplicas: status.desiredReplicas,
    requestsPerSecond: metrics.requestsPerSecond,
    errorRate,
    p95LatencyMs: latency,
    failures: Object.freeze(failures),
    warnings: Object.freeze(warnings),
  };
}
