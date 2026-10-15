import { LinuxFleetResourceSampler, type FleetResourceMetrics } from './fleet-resources.js';
import type { ProxyTelemetry, RouteLoadStatus } from './proxy-telemetry.js';
import type { BackendConnections } from './backend-connections.js';
export interface ApplicationUsage {
  hostname: string;
  requests: RouteLoadStatus;
  activeUpstreamConnections: number;
  processResources: FleetResourceMetrics | null;
  resourceStatus: 'available' | 'warming-up' | 'not-requested' | 'unsupported';
}
/** An explicit PID list is required: a proxy route's owning PID might be a supervisor,
 * not the worker serving requests. CPU sampling needs two readings over time. */
export class ApplicationLoadMonitor {
  private readonly resourceSampler = new LinuxFleetResourceSampler();
  constructor(private readonly telemetry: ProxyTelemetry, private readonly backends: BackendConnections) {}
  async usage(hostname: string, ports: readonly number[], pids?: readonly number[], windowMs = 30_000): Promise<ApplicationUsage> {
    if (!hostname || hostname.length > 253 || !Array.isArray(ports) || ports.length > 32 || ports.some(p => !Number.isSafeInteger(p) || p < 1 || p > 65535)) throw new TypeError('Invalid application usage query');
    let resourceStatus: ApplicationUsage['resourceStatus'] = 'not-requested';
    let processResources: FleetResourceMetrics | null = null;
    if (pids?.length) {
      if (process.platform !== 'linux') resourceStatus = 'unsupported';
      else {
        try { processResources = this.resourceSampler.sample(pids); resourceStatus = 'available'; }
        catch { resourceStatus = 'warming-up'; }
      }
    }
    return { hostname, requests: this.telemetry.application(hostname, windowMs),
      activeUpstreamConnections: ports.reduce((count, port) => count + this.backends.active(hostname, port), 0),
      processResources, resourceStatus };
  }
}
