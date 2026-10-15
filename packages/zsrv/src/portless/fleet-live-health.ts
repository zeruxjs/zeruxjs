/** Read-only service health evaluation for a live local fleet.
 * Unlike the offline checkpoint doctor, these decisions use current proxy telemetry.
 */
import type { FleetStatus } from './fleet-types.js';
import type { FleetLoadMetrics } from './fleet-autoscaler.js';
export interface LiveFleetHealthOptions {
  maxErrorRate?: number;
  maxP95LatencyMs?: number;
  maxMetricAgeMs?: number;
}
export interface LiveFleetHealthReport {
  hostname: string;
  healthy: boolean;
  readyReplicas: number;
  desiredReplicas: number;
  requestsPerSecond: number;
  errorRate: number | null;
  p95LatencyMs: number | null;
  failures: readonly string[];
  warnings: readonly string[];
}
export function evaluateFleetLiveHealth(status: Readonly<FleetStatus>, metrics: FleetLoadMetrics,
  config: LiveFleetHealthOptions = {}, now = Date.now()): LiveFleetHealthReport {
  const errorLimit = config.maxErrorRate ?? 0.05;
  const latencyLimit = config.maxP95LatencyMs ?? 2000;
  const ageLimit = config.maxMetricAgeMs ?? 15000;
  if (metrics.hostname !== status.hostname || !Number.isSafeInteger(now) ||
    !Number.isFinite(errorLimit) || errorLimit < 0 || errorLimit > 1 ||
    !Number.isSafeInteger(latencyLimit) || latencyLimit < 1 || latencyLimit > 300000 ||
    !Number.isSafeInteger(ageLimit) || ageLimit < 1000 || ageLimit > 300000) {
    throw new TypeError('Invalid live fleet health inputs');
  }
  const failures: string[] = [];
  const warnings: string[] = [];
  const ready = status.members.filter(m => m.routed && m.healthy).length;
  if (status.phase !== 'running') failures.push(`Fleet phase is ${status.phase}`);
  if (ready < status.desiredReplicas) failures.push(`Only ${ready}/${status.desiredReplicas} replicas are healthy`);
  if (!Number.isSafeInteger(metrics.sampledAt) || Math.abs(now - metrics.sampledAt) > ageLimit) {
    failures.push('Proxy telemetry is missing or stale');
  }
  if (!Number.isFinite(metrics.requestsPerSecond) || metrics.requestsPerSecond < 0) failures.push('Invalid request throughput');
  const errorRate = metrics.errorRate ?? null;
  const latency = metrics.p95LatencyMs ?? null;
  if (errorRate !== null && (!Number.isFinite(errorRate) || errorRate < 0 || errorRate > 1)) failures.push('Invalid HTTP error ratio');
  else if (errorRate !== null && errorRate > errorLimit) failures.push(`HTTP error ratio exceeds ${errorLimit}`);
  if (latency !== null && (!Number.isFinite(latency) || latency < 0)) failures.push('Invalid latency sample');
  else if (latency !== null && latency > latencyLimit) failures.push(`HTTP p95 latency exceeds ${latencyLimit}ms`);
  if (!metrics.completedRequests) warnings.push('Not enough completed requests to evaluate HTTP quality');
  if (status.lastError) warnings.push(`Last process error: ${status.lastError.slice(0, 180)}`);
  return { hostname: status.hostname, healthy: !failures.length, readyReplicas: ready,
    desiredReplicas: status.desiredReplicas, requestsPerSecond: metrics.requestsPerSecond,
    errorRate, p95LatencyMs: latency, failures: Object.freeze(failures), warnings: Object.freeze(warnings) };
}
