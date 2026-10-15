/** Operator diagnostics from durable state, without mutating live services. */
import { readFleetCheckpoint } from './fleet-state.js';
import { readControlDescriptor } from './local-control.js';
import { processIdentity } from './lifecycle.js';
import { RouteStore } from './routes.js';
import { readGenerationRecord } from './generation-registry.js';
export interface FleetDiagnostics {
  hostname: string;
  checkpointPresent: boolean;
  online: boolean;
  phase: string | null;
  desiredReplicas: number;
  readyReplicas: number;
  routedReplicas: number;
  routePresent: boolean;
  routeMatchesCheckpoint: boolean;
  budgetUsed: number;
  autoscalingPaused: boolean | null;
  recoveryRequired: boolean;
  warnings: readonly string[];
}
export function inspectFleetState(stateDir: string, hostname: string, now = Date.now()): FleetDiagnostics {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Invalid diagnostic timestamp');
  const checkpoint = readFleetCheckpoint(stateDir, hostname);
  const descriptor = readControlDescriptor(stateDir, hostname);
  const online = !!checkpoint && !!descriptor && descriptor.pid === checkpoint.owner.pid &&
    descriptor.identity === checkpoint.owner.identity && processIdentity(descriptor.pid) === descriptor.identity;
  const members = checkpoint?.status.members ?? [];
  const ready = members.filter(m => m.healthy && m.routed).length;
  const routed = members.filter(m => m.routed).map(m => m.port).sort((a,b)=>a-b);
  const route = new RouteStore(stateDir).loadRoutes().find(route => route.hostname === hostname);
  const expected = (route?.backends?.map(b=>b.port) ?? (route ? [route.port] : [])).slice().sort((a,b)=>a-b);
  const routeMatchesCheckpoint = !!route && routed.length === expected.length && routed.every((port,i)=>port===expected[i]);
  const pending = readGenerationRecord(stateDir, hostname);
  const warnings: string[] = [];
  if (!checkpoint) warnings.push('Fleet checkpoint is missing');
  if (checkpoint && !online) warnings.push('Fleet controller is offline or unverifiable');
  if (pending && !online) warnings.push(`${pending.children.length} recorded generations require recovery inspection`);
  if (checkpoint && ready < checkpoint.status.desiredReplicas) warnings.push('Fleet is below desired healthy capacity');
  if (checkpoint && !routeMatchesCheckpoint) warnings.push('Route backends differ from checkpoint');
  if (checkpoint && now - Date.parse(checkpoint.updatedAt) > 120000) warnings.push('Fleet status checkpoint is stale');
  if (checkpoint?.status.lastError) warnings.push(`Last failure: ${checkpoint.status.lastError.slice(0,180)}`);
  return Object.freeze({ hostname, checkpointPresent: !!checkpoint, online, phase: checkpoint?.status.phase ?? null,
    desiredReplicas: checkpoint?.status.desiredReplicas ?? 0,
    readyReplicas: ready, routedReplicas: routed.length, routePresent: !!route, routeMatchesCheckpoint,
    budgetUsed: checkpoint?.status.budgetUsed ?? 0, autoscalingPaused: checkpoint?.autoscale?.paused ?? null,
    recoveryRequired: !!pending && !online, warnings: Object.freeze(warnings) });
}
