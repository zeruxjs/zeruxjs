import {
  LinuxFleetResourceSampler,
  type FleetResourceMetrics,
} from './fleet-resources.js';
import type { ProxyTelemetry, RouteLoadStatus } from './proxy-telemetry.js';
import type { BackendConnections } from './backend-connections.js';
export interface ApplicationUsage {
  /** Host-authorized bounded operational label, not a marketing/session identity. */
  hostname: string;
  /** Detached recent sampled response metadata from the borrowed telemetry owner. */
  requests: RouteLoadStatus;
  /** Observed accepted sessions summed over the explicitly supplied port entries. */
  activeUpstreamConnections: number;
  /** Explicit native worker observations, or null when not available. */
  processResources: FleetResourceMetrics | null;
  /** Coverage classification; unavailable/warming readings are not zero utilization. */
  resourceStatus: 'available' | 'warming-up' | 'not-requested' | 'unsupported';
}
/** An explicit PID list is required: a proxy route's owning PID might be a supervisor,
 * not the worker serving requests. CPU sampling needs two readings over time. */
export class ApplicationLoadMonitor {
  /** Last requested PID-set baseline only; alternating disjoint groups must prime again. */
  private readonly resourceSampler = new LinuxFleetResourceSampler();
  /** Borrow operational request/session stores and retain only a bounded local native-resource baseline, without starting timers or sockets.
   * @param {ProxyTelemetry} telemetry - Borrowed proxy response observations, kept alive by its host.
   * @param {BackendConnections} backends - Borrowed actual serving-proxy accepted-session tracker.
   */
  constructor(
    private readonly telemetry: ProxyTelemetry,
    private readonly backends: BackendConnections
  ) {}
  /** Combine explicit host-authorized route/port observations with optional native PID readings; unknown resource state never becomes fabricated zero usage.
   * @param {string} hostname - Host-authorized operational route label.
   * @param {readonly number[]} ports - Zero to 32 validated backend ports; this method counts the supplied entries without deduplicating them.
   * @param {readonly number[]} pids - Optional explicit host-owned worker PIDs; never infer workers from a wrapper registration PID.
   * @param {number} windowMs - Host-validated request-report window in milliseconds; legacy telemetry.application does not validate it.
   * @returns {Promise<ApplicationUsage>} Operational metadata with available/warming-up/not-requested/unsupported coverage; warming-up also includes caught native read failures.
   */
  async usage(
    hostname: string,
    ports: readonly number[],
    pids?: readonly number[],
    windowMs = 30_000
  ): Promise<ApplicationUsage> {
    if (
      !hostname ||
      hostname.length > 253 ||
      !Array.isArray(ports) ||
      ports.length > 32 ||
      ports.some((p) => !Number.isSafeInteger(p) || p < 1 || p > 65535)
    ) {
      throw new TypeError('Invalid application usage query');
    }
    let resourceStatus: ApplicationUsage['resourceStatus'] = 'not-requested';
    let processResources: FleetResourceMetrics | null = null;
    if (pids?.length) {
      if (process.platform !== 'linux') {
        resourceStatus = 'unsupported';
      } else {
        try {
          processResources = this.resourceSampler.sample(pids);
          resourceStatus = 'available';
        } catch {
          resourceStatus = 'warming-up';
        }
      }
    }
    return {
      hostname,
      requests: this.telemetry.application(hostname, windowMs),
      activeUpstreamConnections: ports.reduce(
        (count, port) => count + this.backends.active(hostname, port),
        0
      ),
      processResources,
      resourceStatus,
    };
  }
}
