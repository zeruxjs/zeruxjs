/** Safe application traffic handovers: health-check first, then conditional
 * atomic route swap. Never mutates the route if readiness fails. */
import { probeApplicationHealth, type HealthCheckOptions } from './health.js';
import { validateBackends } from './backend-pool.js';
import type { RouteBackend } from './types.js';
import type { RouteLease } from './routes.js';

export interface HandoverOptions {
  /** Optional local probe policy; individual timeouts belong to the health helper. */
  health?: HealthCheckOptions;
  /** Require every target to pass the probe (default true). */
  requireAll?: boolean;
}

/** Probe the bounded validated target list before one ownership-fenced route cutover, leaving the old route unchanged on failed readiness.
 * @param {RouteLease} lease - Host-owned conditional route lease; the caller separately authorizes this operation.
 * @param {readonly RouteBackend[]} targets - One to 32 distinct local backends validated by the shared owner.
 * @param {HandoverOptions} options - Trusted boolean selection policy and bounded loopback probe configuration.
 * @returns {Promise<boolean>} Whether the conditional cutover succeeded; no business mutation is retried or rolled back.
 */
export async function handoverBackends(
  lease: RouteLease,
  targets: readonly RouteBackend[],
  options: HandoverOptions = {}
): Promise<boolean> {
  /** Detached validated nonempty backend records, bounding this parallel probe batch to 32. */
  const valid = validateBackends(targets);
  /** Ordered parallel loopback results, preserving positional correspondence with validated targets. */
  const health = await Promise.all(
    valid.map((backend) => probeApplicationHealth(backend.port, options.health))
  );
  if (
    (options.requireAll ?? true)
      ? health.some((ok) => !ok)
      : !health.some(Boolean)
  ) {
    return false;
  }
  /** All targets or only successful targets according to the explicit trusted boolean policy. */
  const selected =
    options.requireAll === false
      ? valid.filter((_, index) => health[index])
      : valid;
  return lease.switchBackends(selected);
}
