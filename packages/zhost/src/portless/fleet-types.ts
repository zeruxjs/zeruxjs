/** Public, framework-neutral runtime and configuration contracts for instance fleets. */
import type { ChildProcess } from 'node:child_process';
import type { SupervisorOptions } from './process-supervisor.js';
import type { BackendConnections } from './backend-connections.js';
import type { RouteLease, RouteStore } from './routes.js';

export type FleetPhase = 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped';
export interface FleetMemberStatus {
  port: number;
  pid: number | null;
  healthy: boolean;
  routed: boolean;
  failures: number;
  generation: number;
}
export interface FleetStatus {
  phase: FleetPhase;
  hostname: string;
  desiredReplicas: number;
  generation: number;
  replacementAttempts: number;
  budgetUsed: number;
  lastError: string | null;
  members: readonly FleetMemberStatus[];
  updatedAt: string;
}
export interface FleetReconcileResult {
  replaced: readonly { fromPort: number; toPort: number; drained: boolean }[];
  failures: readonly { port: number; error: string }[];
  status: Readonly<FleetStatus>;
}
export interface InstanceFleetOptions extends Omit<SupervisorOptions, 'port' | 'onExit' | 'onSpawn'> {
  store: RouteStore;
  hostname: string;
  /** At least replicas + 1 distinct ports, to allow a ready-before-cutover spare. */
  ports: readonly number[];
  /** 2–16 processes; at least one spare port is required. */
  replicas: number;
  connections: Pick<BackendConnections, 'waitForIdle'>;
  healthIntervalMs?: number;
  unhealthyThreshold?: number;
  /** Maximum attempted replacements during restartWindowMs (0 disables recovery). */
  maxReplacements?: number;
  restartWindowMs?: number;
  replacementDelayMs?: number;
  maxReplacementDelayMs?: number;
  drainTimeoutMs?: number;
  /** Permit explicit replacement of an existing route owned by someone else. */
  force?: boolean;
  /** Persist each generation immediately after spawn, before health readiness. */
  onSpawn?: (child: ChildProcess, port: number) => void;
  onLease?: (leaseId: string) => void;
  onStatus?: (status: Readonly<FleetStatus>) => void;
  /** Retry timestamps restored from a private checkpoint; bounded by current policy. */
  restoredAttempts?: readonly number[];
  /** Synchronous durable checkpoint callback, invoked before every replacement. */
  onBudgetAttempt?: (attempts: readonly number[]) => void;
}
export interface InstanceFleet {
  readonly lease: RouteLease;
  readonly status: Readonly<FleetStatus>;
  /** Checks members and repairs unhealthy capacity, with bounded retries. */
  reconcile(): Promise<FleetReconcileResult>;
  /** Increase or decrease the target without restarting the fleet controller. */
  scaleTo(replicas: number): Promise<Readonly<FleetStatus>>;
  /** Idempotently withdraws the owned route, drains and terminates generations. */
  stop(): Promise<void>;
}
