/** Prometheus/OpenMetrics-compatible text for authenticated fleet CLI output.
 * This formatter does not expose a network endpoint or process identifiers.
 */
import type { FleetStatus } from './fleet-types.js';
import type { FleetLoadMetrics, FleetAutoscaleObservation } from './fleet-autoscaler.js';

export interface FleetMetricsExport {
  status: Readonly<FleetStatus>;
  metrics: FleetLoadMetrics;
  observation?: FleetAutoscaleObservation | null;
}
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}
export function renderFleetPrometheus(input: FleetMetricsExport): string {
  const { status, metrics } = input;
  if (metrics.hostname !== status.hostname || !Number.isFinite(metrics.requestsPerSecond) || metrics.requestsPerSecond < 0) {
    throw new TypeError('Invalid fleet metrics export');
  }
  const label = `{fleet="${escapeLabel(status.hostname)}"}`;
  const rows: string[] = [];
  const metric = (key: string, help: string, value: number, suffix = '') => {
    if (!Number.isFinite(value)) throw new TypeError('Invalid Prometheus metric');
    rows.push(`# HELP ${key} ${help}`, `# TYPE ${key} gauge`, `${key}${label}${suffix} ${value}`);
  };
  metric('zerux_fleet_desired_replicas', 'Desired fleet replica count.', status.desiredReplicas);
  metric('zerux_fleet_healthy_replicas', 'Healthy routed replicas.', status.members.filter(m => m.healthy && m.routed).length);
  metric('zerux_fleet_active_connections', 'Active proxy connections.', metrics.activeConnections);
  metric('zerux_fleet_requests_per_second', 'Requests arriving per second.', metrics.requestsPerSecond);
  metric('zerux_fleet_replacement_attempts', 'Replacement attempts since controller launch.', status.replacementAttempts);
  if (metrics.errorRate !== null && metrics.errorRate !== undefined) {
    metric('zerux_fleet_http_error_ratio', 'Recent HTTP 5xx response ratio.', metrics.errorRate);
  }
  if (metrics.p95LatencyMs !== null && metrics.p95LatencyMs !== undefined) {
    metric('zerux_fleet_http_p95_duration_seconds', 'Approximate recent HTTP p95 latency in seconds.', metrics.p95LatencyMs / 1000);
  }
  if (input.observation) {
    const { metric: mode, value } = input.observation;
    if (!['rps', 'cpu', 'memory'].includes(mode)) throw new TypeError('Invalid autoscale observation');
    const unit = mode === 'memory' ? 'mib' : mode === 'cpu' ? 'percent' : 'rps';
    const key = `zerux_fleet_autoscale_observed_${unit}`;
    metric(key, `Latest autoscaling ${mode} observation.`, value);
  }
  return rows.join('\n') + '\n';
}
