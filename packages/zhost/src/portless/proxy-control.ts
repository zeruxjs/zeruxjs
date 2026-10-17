/** Cross-process proxy-side drain observations. No route changes or arbitrary
 * operations are exposed through the proxy's local control endpoint. */
import { createLocalControl, sendLocalControl, type LocalControl } from './local-control.js';
import type { BackendConnections } from './backend-connections.js';
import type { FleetLoadMetrics } from './fleet-autoscaler.js';
import type { BackendPool, BackendStatus } from './backend-pool.js';
import { validateAppPort } from './process-supervisor.js';
const NAME = 'proxy-backend-connections';
function parseDrainRequest(data: unknown): { hostname: string; port: number; timeoutMs: number } {
  if (!data || typeof data !== 'object') throw new Error('Invalid drain request');
  const { hostname, port, timeoutMs } = data as Record<string, unknown>;
  if (typeof hostname !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,240}$/.test(hostname) || hostname.includes('..')) throw new Error('Invalid backend hostname');
  validateAppPort(port as number);
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 0 || (timeoutMs as number) > 300000) throw new Error('Invalid drain timeout');
  return { hostname, port: port as number, timeoutMs: timeoutMs as number };
}
export function createProxyConnectionControl(stateDir: string, connections: BackendConnections, pool?: BackendPool): Promise<LocalControl> {
  return createLocalControl(stateDir, NAME, (action, data) => {
    if (action === 'backend-status') {
      if (!pool) throw new Error('Backend status is unavailable');
      if (typeof data !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,240}$/.test(data) || data.includes('..')) {
        throw new Error('Invalid backend hostname');
      }
      // Sync with the live route registry before returning operational status.
      pool.syncCurrentRoutes();
      return pool.status().filter(item => item.hostname === data).slice(0, 32);
    }
    if (action === 'backend-metrics') {
      if (!data || typeof data !== 'object') throw new Error('Invalid metrics request');
      const v = data as Record<string, unknown>;
      if (typeof v.hostname !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,240}$/.test(v.hostname) || v.hostname.includes('..')) throw new Error('Invalid metrics hostname');
      if (!Array.isArray(v.ports) || v.ports.length < 1 || v.ports.length > 17) throw new Error('Invalid metrics ports');
      v.ports.forEach(port => validateAppPort(port));
      return connections.metrics(v.hostname, v.ports as number[], v.windowMs as number);
    }
    if (action !== 'drain') throw new Error('Unknown proxy control action');
    const input = parseDrainRequest(data);
    return connections.waitForIdle(input.hostname, input.port, input.timeoutMs);
  });
}
/** Fail closed when no verified proxy connection tracker is available. */
export class RemoteBackendConnections {
  constructor(private readonly stateDir: string) {}
  async metrics(hostname: string, ports: readonly number[], windowMs = 30000): Promise<FleetLoadMetrics> {
    return sendLocalControl<FleetLoadMetrics>(this.stateDir, NAME, 'backend-metrics', { hostname, ports, windowMs });
  }
  async status(hostname: string): Promise<BackendStatus[]> {
    return sendLocalControl<BackendStatus[]>(this.stateDir, NAME, 'backend-status', hostname);
  }
  async waitForIdle(hostname: string, port: number, timeoutMs = 10000): Promise<boolean> {
    return sendLocalControl<boolean>(this.stateDir, NAME, 'drain', { hostname, port, timeoutMs }, Math.min(timeoutMs + 5000, 310000));
  }
}
