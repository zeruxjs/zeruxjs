/** Cross-process proxy-side drain observations. No route changes or arbitrary
 * operations are exposed through the proxy's local control endpoint. */
import {
  createLocalControl,
  sendLocalControl,
  type LocalControl,
} from './local-control.js';
import type { BackendConnections } from './backend-connections.js';
import type { FleetLoadMetrics } from './fleet-autoscaler.js';
import type { BackendPool, BackendStatus } from './backend-pool.js';
import { validateAppPort } from './process-supervisor.js';
/** Fixed private endpoint namespace, never selected by a request. */
const NAME = 'proxy-backend-connections';
/** Validate the supported inert drain payload before passing it to the actual proxy connection owner.
 * @param {unknown} data - Unknown parsed control message, never executable configuration.
 * @returns {{ hostname: string; port: number; timeoutMs: number }} Validated local backend drain request.
 */
function parseDrainRequest(data: unknown): {
  hostname: string;
  port: number;
  timeoutMs: number;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid drain request');
  }
  /** Unknown parsed fields awaiting independent runtime validation. */
  const { hostname, port, timeoutMs } = data as Record<string, unknown>;
  if (
    typeof hostname !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,240}$/.test(hostname) ||
    hostname.includes('..')
  ) {
    throw new Error('Invalid backend hostname');
  }
  validateAppPort(port as number);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 0 ||
    (timeoutMs as number) > 300000
  ) {
    throw new Error('Invalid drain timeout');
  }
  return { hostname, port: port as number, timeoutMs: timeoutMs as number };
}
/** Acquire a private authenticated local control endpoint exposing only bounded backend status/metrics/drain operations.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {BackendConnections} connections - Borrowed actual serving-proxy connection tracker.
 * @param {BackendPool} pool - Optional borrowed live backend pool, needed only for status.
 * @returns {Promise<LocalControl>} Owned endpoint handle; await close before disposing borrowed tracker/pool dependencies.
 */
export function createProxyConnectionControl(
  stateDir: string,
  connections: BackendConnections,
  pool?: BackendPool
): Promise<LocalControl> {
  return createLocalControl(stateDir, NAME, (action, data) => {
    if (action === 'backend-status') {
      if (!pool) {
        throw new Error('Backend status is unavailable');
      }
      if (
        typeof data !== 'string' ||
        !/^[a-z0-9][a-z0-9._-]{0,240}$/.test(data) ||
        data.includes('..')
      ) {
        throw new Error('Invalid backend hostname');
      }
      // Sync with the live route registry before returning operational status.
      pool.syncCurrentRoutes();
      return pool
        .status()
        .filter((item) => item.hostname === data)
        .slice(0, 32);
    }
    if (action === 'backend-metrics') {
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid metrics request');
      }
      /** Unknown metrics message viewed through an inert record shape before validation. */
      const v = data as Record<string, unknown>;
      if (
        typeof v.hostname !== 'string' ||
        !/^[a-z0-9][a-z0-9._-]{0,240}$/.test(v.hostname) ||
        v.hostname.includes('..')
      ) {
        throw new Error('Invalid metrics hostname');
      }
      if (
        !Array.isArray(v.ports) ||
        v.ports.length < 1 ||
        v.ports.length > 17
      ) {
        throw new Error('Invalid metrics ports');
      }
      v.ports.forEach((port) => validateAppPort(port));
      return connections.metrics(
        v.hostname,
        v.ports as number[],
        v.windowMs as number
      );
    }
    if (action !== 'drain') {
      throw new Error('Unknown proxy control action');
    }
    /** Fully validated drain request passed only to the borrowed connection owner. */
    const input = parseDrainRequest(data);
    return connections.waitForIdle(input.hostname, input.port, input.timeoutMs);
  });
}
/** Fail closed when no verified proxy connection tracker is available. */
export class RemoteBackendConnections {
  /** Retain only the host-private endpoint namespace; construction opens no connection.
   * @param {string} stateDir - Host-owned private proxy control directory.
   */
  constructor(private readonly stateDir: string) {}
  /** Request same-fleet aggregate telemetry from the authenticated local serving proxy.
   * @param {string} hostname - Host-authorized fleet route name.
   * @param {readonly number[]} ports - Validated backend inventory; server enforces its own bounds.
   * @param {number} windowMs - Trusted telemetry reporting window, default thirty seconds.
   * @returns {Promise<FleetLoadMetrics>} Decoded remote aggregate; missing or unverifiable endpoints fail closed.
   */
  async metrics(
    hostname: string,
    ports: readonly number[],
    windowMs = 30000
  ): Promise<FleetLoadMetrics> {
    return sendLocalControl<FleetLoadMetrics>(
      this.stateDir,
      NAME,
      'backend-metrics',
      { hostname, ports, windowMs }
    );
  }
  /** Read matching backend observations after the serving proxy synchronizes current routes.
   * @param {string} hostname - Host-authorized fleet route name.
   * @returns {Promise<BackendStatus[]>} Bounded remote observations; this does not authorize route mutation.
   */
  async status(hostname: string): Promise<BackendStatus[]> {
    return sendLocalControl<BackendStatus[]>(
      this.stateDir,
      NAME,
      'backend-status',
      hostname
    );
  }
  /** Wait through the authenticated local endpoint for actual serving-proxy connections to drain.
   * @param {string} hostname - Host-authorized fleet route name.
   * @param {number} port - Validated target loopback backend port.
   * @param {number} timeoutMs - Bounded drain deadline in milliseconds, default ten seconds.
   * @returns {Promise<boolean>} Whether observed connections drained before the deadline; native errors reject.
   */
  async waitForIdle(
    hostname: string,
    port: number,
    timeoutMs = 10000
  ): Promise<boolean> {
    return sendLocalControl<boolean>(
      this.stateDir,
      NAME,
      'drain',
      { hostname, port, timeoutMs },
      Math.min(timeoutMs + 5000, 310000)
    );
  }
}
