/** Prometheus/OpenMetrics-compatible text for authenticated fleet CLI output.
 * This formatter does not expose a network endpoint or process identifiers.
 */
import type { FleetStatus } from './fleet-types.js';
import type {
  FleetLoadMetrics,
  FleetAutoscaleObservation,
} from './fleet-autoscaler.js';

export interface FleetMetricsExport {
  /** Borrowed published controller observation. */
  status: Readonly<FleetStatus>;
  /** Borrowed same-fleet aggregate proxy telemetry. */
  metrics: FleetLoadMetrics;
  /** Optional latest supported autoscale aggregate, excluding request/user labels. */
  observation?: FleetAutoscaleObservation | null;
}
/** Escape only Prometheus label-string metacharacters; this is not an HTML encoder.
 * @param {string} value - Trusted host operational label.
 * @returns {string} Backslash, newline and quote escaped label value.
 */
function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}
/** Render fixed aggregate gauge names from matching host-authorized observations; no HTTP endpoint or native sampling is created.
 * @param {FleetMetricsExport} input - Host-owned status and aggregate telemetry for the same fleet.
 * @returns {string} Deterministically ordered text exposition ending with one newline.
 */
export function renderFleetPrometheus(input: FleetMetricsExport): string {
  /** Borrowed matching host operational observations validated before rendering. */
  const { status, metrics } = input;
  if (
    metrics.hostname !== status.hostname ||
    !Number.isFinite(metrics.requestsPerSecond) ||
    metrics.requestsPerSecond < 0
  ) {
    throw new TypeError('Invalid fleet metrics export');
  }
  /** One escaped fleet label; never add private subject or request dimensions. */
  const label = `{fleet="${escapeLabel(status.hostname)}"}`;
  /** Per-call fixed-metric text accumulator. */
  const rows: string[] = [];
  /** Append one finite gauge under the fixed host label.
   * @param {string} key Internal fixed metric name.
   * @param {string} help Internal fixed explanation, never request content.
   * @param {number} value Finite aggregate measurement.
   * @param {string} suffix Internal fixed suffix, empty for current callers.
   * @returns {void} Adds HELP, TYPE and sample rows or throws for a nonfinite value. */
  const metric = (key: string, help: string, value: number, suffix = '') => {
    if (!Number.isFinite(value)) {
      throw new TypeError('Invalid Prometheus metric');
    }
    rows.push(
      `# HELP ${key} ${help}`,
      `# TYPE ${key} gauge`,
      `${key}${label}${suffix} ${value}`
    );
  };
  metric(
    'zerux_fleet_desired_replicas',
    'Desired fleet replica count.',
    status.desiredReplicas
  );
  metric(
    'zerux_fleet_healthy_replicas',
    'Healthy routed replicas.',
    status.members.filter((m) => m.healthy && m.routed).length
  );
  metric(
    'zerux_fleet_active_connections',
    'Active proxy connections.',
    metrics.activeConnections
  );
  metric(
    'zerux_fleet_requests_per_second',
    'Requests arriving per second.',
    metrics.requestsPerSecond
  );
  metric(
    'zerux_fleet_replacement_attempts',
    'Replacement attempts since controller launch.',
    status.replacementAttempts
  );
  if (metrics.errorRate !== null && metrics.errorRate !== undefined) {
    metric(
      'zerux_fleet_http_error_ratio',
      'Recent HTTP 5xx response ratio.',
      metrics.errorRate
    );
  }
  if (metrics.p95LatencyMs !== null && metrics.p95LatencyMs !== undefined) {
    metric(
      'zerux_fleet_http_p95_duration_seconds',
      'Approximate recent HTTP p95 latency in seconds.',
      metrics.p95LatencyMs / 1000
    );
  }
  if (input.observation) {
    /** Validated autoscale dimension and its finite aggregate value. */
    const { metric: mode, value } = input.observation;
    if (!['rps', 'cpu', 'memory'].includes(mode)) {
      throw new TypeError('Invalid autoscale observation');
    }
    /** Fixed supported output unit selected from the autoscale dimension. */
    let unit: string;
    if (mode === 'memory') {
      unit = 'mib';
    } else if (mode === 'cpu') {
      unit = 'percent';
    } else {
      unit = 'rps';
    }
    /** Fixed metric family derived only from the allowlisted unit. */
    const key = `zerux_fleet_autoscale_observed_${unit}`;
    metric(key, `Latest autoscaling ${mode} observation.`, value);
  }
  return rows.join('\n') + '\n';
}
