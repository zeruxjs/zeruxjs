/** Safe application traffic handovers: health-check first, then conditional
 * atomic route swap. Never mutates the route if readiness fails. */
import { probeApplicationHealth, type HealthCheckOptions } from './health.js';
import { validateBackends } from './backend-pool.js';
import type { RouteBackend } from './types.js';
import type { RouteLease } from './routes.js';

export interface HandoverOptions {
  health?: HealthCheckOptions;
  /** Require every target to pass the probe (default true). */
  requireAll?: boolean;
}

export async function handoverBackends(lease: RouteLease, targets: readonly RouteBackend[], options: HandoverOptions = {}): Promise<boolean> {
  const valid = validateBackends(targets);
  const health = await Promise.all(valid.map(backend => probeApplicationHealth(backend.port, options.health)));
  if ((options.requireAll ?? true) ? health.some(ok => !ok) : !health.some(Boolean)) return false;
  const selected = options.requireAll === false ? valid.filter((_, index) => health[index]) : valid;
  return lease.switchBackends(selected);
}
