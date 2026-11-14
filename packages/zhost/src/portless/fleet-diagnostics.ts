/** Operator diagnostics from durable state, without mutating live services. */
import { readFleetCheckpoint } from './fleet-state.js';
import { readControlDescriptor } from './local-control.js';
import { processIdentity } from './lifecycle.js';
import { RouteStore } from './routes.js';
import { readGenerationRecord } from './generation-registry.js';
export interface FleetDiagnostics {
  /** Host-authorized operational route name. */
  hostname: string;
  /** Whether a validated fleet checkpoint exists. */
  checkpointPresent: boolean;
  /** Whether checkpoint, control descriptor and current process identity match. */
  online: boolean;
  /** Persisted lifecycle phase, or null when no checkpoint exists. */
  phase: string | null;
  /** Persisted desired capacity, or zero when no checkpoint exists. */
  desiredReplicas: number;
  /** Persisted healthy routed member count; not a live probe. */
  readyReplicas: number;
  /** Persisted routed member count. */
  routedReplicas: number;
  /** Whether the current route store contains this hostname. */
  routePresent: boolean;
  /** Whether sorted current route ports match persisted routed member ports. */
  routeMatchesCheckpoint: boolean;
  /** Persisted sliding-window restart attempts, or zero without a checkpoint. */
  budgetUsed: number;
  /** Persisted pause state, or null when no autoscale checkpoint exists. */
  autoscalingPaused: boolean | null;
  /** Whether recorded generations remain while controller identity is not verified online. */
  recoveryRequired: boolean;
  /** Frozen host-only operational warnings, potentially including prior failure text. */
  warnings: readonly string[];
}
/** Compare bounded host-private checkpoints, route ownership and current process identity without mutating services; diagnostics do not grant control permission.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Validated host-authorized fleet route name.
 * @param {number} now - Host-supplied epoch milliseconds, defaulting to the current clock.
 * @returns {FleetDiagnostics} Frozen operational findings; missing coverage is represented explicitly.
 */
export function inspectFleetState(
  stateDir: string,
  hostname: string,
  now = Date.now()
): FleetDiagnostics {
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError('Invalid diagnostic timestamp');
  }
  /** Validated private persisted fleet status, if present. */
  const checkpoint = readFleetCheckpoint(stateDir, hostname);
  /** Validated private control endpoint identity, if present. */
  const descriptor = readControlDescriptor(stateDir, hostname);
  /** Current identity agreement, never an authorization bypass. */
  const online =
    !!checkpoint &&
    !!descriptor &&
    descriptor.pid === checkpoint.owner.pid &&
    descriptor.identity === checkpoint.owner.identity &&
    processIdentity(descriptor.pid) === descriptor.identity;
  /** Persisted member observations, not current native process probes. */
  const members = checkpoint?.status.members ?? [];
  /** Persisted healthy routed observations counted for diagnostics. */
  const ready = members.filter((m) => m.healthy && m.routed).length;
  /** Sorted copied checkpoint ports for deterministic route comparison. */
  const routed = members
    .filter((m) => m.routed)
    .map((m) => m.port)
    .sort((a, b) => a - b);
  /** Current matching legacy route record from the host-owned route store. */
  const route = new RouteStore(stateDir)
    .loadRoutes()
    .find((route) => route.hostname === hostname);
  /** Sorted detached actual backend ports, including the legacy single-port form. */
  const expected = (
    route?.backends?.map((b) => b.port) ?? (route ? [route.port] : [])
  )
    .slice()
    .sort((a, b) => a - b);
  /** Port-list agreement only; this does not establish route lease authority. */
  const routeMatchesCheckpoint =
    !!route &&
    routed.length === expected.length &&
    routed.every((port, i) => port === expected[i]);
  /** Private generation ownership journal requiring separate trusted recovery. */
  const pending = readGenerationRecord(stateDir, hostname);
  /** Host-only coverage and inconsistency notices. */
  const warnings: string[] = [];
  if (!checkpoint) {
    warnings.push('Fleet checkpoint is missing');
  }
  if (checkpoint && !online) {
    warnings.push('Fleet controller is offline or unverifiable');
  }
  if (pending && !online) {
    warnings.push(
      `${pending.children.length} recorded generations require recovery inspection`
    );
  }
  if (checkpoint && ready < checkpoint.status.desiredReplicas) {
    warnings.push('Fleet is below desired healthy capacity');
  }
  if (checkpoint && !routeMatchesCheckpoint) {
    warnings.push('Route backends differ from checkpoint');
  }
  if (checkpoint && now - Date.parse(checkpoint.updatedAt) > 120000) {
    warnings.push('Fleet status checkpoint is stale');
  }
  if (checkpoint?.status.lastError) {
    warnings.push(`Last failure: ${checkpoint.status.lastError.slice(0, 180)}`);
  }
  return Object.freeze({
    hostname,
    checkpointPresent: !!checkpoint,
    online,
    phase: checkpoint?.status.phase ?? null,
    desiredReplicas: checkpoint?.status.desiredReplicas ?? 0,
    readyReplicas: ready,
    routedReplicas: routed.length,
    routePresent: !!route,
    routeMatchesCheckpoint,
    budgetUsed: checkpoint?.status.budgetUsed ?? 0,
    autoscalingPaused: checkpoint?.autoscale?.paused ?? null,
    recoveryRequired: !!pending && !online,
    warnings: Object.freeze(warnings),
  });
}
