/** Public, framework-neutral runtime and configuration contracts for instance fleets. */
import type { ChildProcess } from 'node:child_process';
import type { SupervisorOptions } from './process-supervisor.js';
import type { BackendConnections } from './backend-connections.js';
import type { RouteLease, RouteStore } from './routes.js';

/** Controller lifecycle state; degraded means desired healthy capacity is not currently satisfied. */
export type FleetPhase =
  | 'starting'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped';
/** Detached observations of one owned generation, not a fresh native health probe. */
export interface FleetMemberStatus {
  /** Validated loopback backend port allocated by the host. */
  port: number;
  /** Observed child PID, or null before availability; a PID is not proof of identity. */
  pid: number | null;
  /** Last controller health observation, additionally fenced by observed child liveness. */
  healthy: boolean;
  /** Whether the controller currently includes this member in its owned route. */
  routed: boolean;
  /** Consecutive unsuccessful probes capped at the configured unhealthy threshold. */
  failures: number;
  /** Monotonic generation number within this controller lifetime. */
  generation: number;
}
/** Immutable published controller snapshot; timestamps describe observation time only. */
export interface FleetStatus {
  /** Current controller lifecycle state. */
  phase: FleetPhase;
  /** Host-authorized route name; not an authenticated tenant identifier. */
  hostname: string;
  /** Requested steady-state healthy capacity, including an incomplete scale operation. */
  desiredReplicas: number;
  /** Monotonic generation number within this controller lifetime. */
  generation: number;
  /** Lifetime automated repair attempts consumed by this controller. */
  replacementAttempts: number;
  /** Attempts currently retained in the sliding restart window. */
  budgetUsed: number;
  /** Latest operational failure text; keep this host-only because native causes may contain paths. */
  lastError: string | null;
  /** Frozen member observations captured when this status was published. */
  members: readonly FleetMemberStatus[];
  /** ISO UTC observation timestamp; not a persisted coordination clock. */
  updatedAt: string;
}
/** One serialized repair receipt with explicit failures and the latest controller snapshot. */
export interface FleetReconcileResult {
  /** Committed replacement cutovers and whether old connections drained before the deadline. */
  replaced: readonly { fromPort: number; toPort: number; drained: boolean }[];
  /** Operational failures retained for this reconciliation, including post-cutover drain failures. */
  failures: readonly { port: number; error: string }[];
  /** Latest published status; callers must not treat it as a live native probe. */
  status: Readonly<FleetStatus>;
}
/** Trusted host startup policy; route authorization and durable checkpoint ownership remain with the caller. */
export interface InstanceFleetOptions extends Omit<
  SupervisorOptions,
  'port' | 'onExit' | 'onSpawn'
> {
  /** Borrowed conditional route store; the host owns its filesystem policy. */
  store: RouteStore;
  /** Host-authorized route name; not an authenticated tenant identifier. */
  hostname: string;
  /** At least replicas + 1 distinct ports, to allow a ready-before-cutover spare. */
  ports: readonly number[];
  /** 2–16 processes; at least one spare port is required. */
  replicas: number;
  /** Borrowed serving-proxy drain observer; a timeout does not cancel arbitrary application work. */
  connections: Pick<BackendConnections, 'waitForIdle'>;
  /** Periodic probe interval in milliseconds, validated from 100 through 3600000. */
  healthIntervalMs?: number;
  /** Consecutive failed probes required for isolation, from one through twenty. */
  unhealthyThreshold?: number;
  /** Maximum attempted replacements during restartWindowMs (0 disables recovery). */
  maxReplacements?: number;
  /** Sliding restart-budget window in milliseconds, from 100 through 86400000. */
  restartWindowMs?: number;
  /** Initial cooperative replacement backoff in milliseconds, from zero through 60000. */
  replacementDelayMs?: number;
  /** Maximum cooperative replacement backoff in milliseconds, from zero through 300000. */
  maxReplacementDelayMs?: number;
  /** Bounded connection-drain deadline in milliseconds, from zero through 300000. */
  drainTimeoutMs?: number;
  /** Permit explicit replacement of an existing route owned by someone else. */
  force?: boolean;
  /** Persist each generation immediately after spawn, before health readiness. */
  onSpawn?: (child: ChildProcess, port: number) => void;
  /** Synchronous host checkpoint after route publication; throwing releases the new lease. */
  onLease?: (leaseId: string) => void;
  /** Optional synchronous observation callback; exceptions are isolated from process ownership. */
  onStatus?: (status: Readonly<FleetStatus>) => void;
  /** Retry timestamps restored from a private checkpoint; bounded by current policy. */
  restoredAttempts?: readonly number[];
  /** Synchronous durable checkpoint callback, invoked before every replacement. */
  onBudgetAttempt?: (attempts: readonly number[]) => void;
}
/** Owned children, periodic health checks and conditional route lease; await stop to release them. */
export interface InstanceFleet {
  /** Conditional ownership handle; stop releases only this controller’s lease. */
  readonly lease: RouteLease;
  /** Latest immutable controller observation; no native probe is performed by this getter. */
  readonly status: Readonly<FleetStatus>;
  /**
   * Check members and repair unhealthy capacity within the shared restart budget.
   * @returns {Promise<FleetReconcileResult>} Shared in-flight receipt; rejects once stopping begins.
   */
  reconcile(): Promise<FleetReconcileResult>;
  /**
   * Serialize a host-authorized capacity change with reconciliation.
   * @param {number} replicas Target from two through sixteen, leaving one spare port.
   * @returns {Promise<Readonly<FleetStatus>>} Published status; partial failure preserves healthy capacity.
   */
  scaleTo(replicas: number): Promise<Readonly<FleetStatus>>;
  /**
   * Withdraw the owned route, drain connections and terminate owned generations.
   * @returns {Promise<void>} Shared cleanup promise, settled after owned stop operations finish.
   */
  stop(): Promise<void>;
}
