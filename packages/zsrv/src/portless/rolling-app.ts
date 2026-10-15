/** Overlapping child generations with lease-protected, verified traffic cutovers.
 * Uses the existing loopback proxy and RouteStore; does not require a shell. */
import { launchSupervisedCommand, type SupervisedProcess, type SupervisorOptions } from './process-supervisor.js';
import type { ChildProcess } from 'node:child_process';
import { probeApplicationHealth, validateHealthCheck } from './health.js';
import { validateBackends } from './backend-pool.js';
import type { BackendConnections } from './backend-connections.js';
import type { RouteStore, RouteLease } from './routes.js';

export type RollingPhase = 'running' | 'deploying' | 'draining' | 'stopping' | 'stopped';
export interface RollingStatus {
  phase: RollingPhase;
  generation: number;
  port: number | null;
  pid: number | null;
  previousPort: number | null;
  updatedAt: string;
}
export interface RollingDeployResult {
  fromPort: number;
  toPort: number;
  generation: number;
  /** False when the drain deadline was reached; the old child was still stopped. */
  drained: boolean;
}
export interface RollingAppOptions extends Omit<SupervisorOptions, 'port' | 'onExit' | 'onSpawn'> {
  /** Record each detached generation as soon as it spawns (before readiness). */
  onSpawn?: (child: ChildProcess, port: number) => void;
  /** Persist the initial route lease before returning a published controller. */
  onLease?: (leaseId: string) => void;
  store: RouteStore;
  hostname: string;
  /** Two or more private, distinct loopback ports. Each child receives PORT. */
  ports: readonly number[];
  /** Backend connection tracker of the actual proxy serving this hostname. */
  connections: Pick<BackendConnections, 'waitForIdle'>;
  /** Maximum time to let old HTTP requests and WebSockets finish after cutover. */
  drainTimeoutMs?: number;
  /** Number of post-cutover health probes before retiring the old process. */
  verificationChecks?: number;
  verificationIntervalMs?: number;
  /** Explicitly replace an existing registration; disabled by default. */
  force?: boolean;
  onStatus?: (status: Readonly<RollingStatus>) => void;
}
export interface RollingApplication {
  readonly current: SupervisedProcess | undefined;
  readonly status: Readonly<RollingStatus>;
  readonly lease: RouteLease;
  /** Concurrent deploy calls share one promise. Failed readiness never replaces the old route. */
  deploy(): Promise<RollingDeployResult>;
  /** Idempotent. First withdraws the route, then drains and stops children. */
  stop(): Promise<void>;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`${name} must be ${min}–${max}`);
  return n;
}

/** Initial publication occurs only after the first application is healthy. */
export async function launchRollingApplication(argv: readonly string[], options: RollingAppOptions): Promise<RollingApplication> {
  if (!options.connections || typeof options.connections.waitForIdle !== 'function') throw new TypeError('A proxy connection-drain observer is required');
  const ports = validateBackends(options.ports.map(port => ({ port }))).map(item => item.port);
  if (ports.length < 2) throw new RangeError('Rolling deployments need at least two distinct ports');
  const drainTimeoutMs = bounded(options.drainTimeoutMs, 10_000, 0, 300_000, 'drainTimeoutMs');
  const verificationChecks = bounded(options.verificationChecks, 1, 1, 20, 'verificationChecks');
  const verificationIntervalMs = bounded(options.verificationIntervalMs, 100, 1, 30_000, 'verificationIntervalMs');
  validateHealthCheck(options.health);
  const { store, hostname, connections, onStatus, onSpawn, onLease, force, ports: _ports, drainTimeoutMs: _drain,
    verificationChecks: _checks, verificationIntervalMs: _interval, ...supervisor } = options;
  const launch = (port: number) => launchSupervisedCommand(argv, {
    ...supervisor, port, forwardSignals: false,
    onSpawn: child => onSpawn?.(child, port),
    env: { ...supervisor.env, PORT: String(port) },
  });
  let active = await launch(ports[0]);
  let lease: RouteLease;
  try {
    // Avoid silently replacing another lease owned by this same operating-system PID.
    if (!force && store.loadRoutes().some(route => route.hostname === hostname)) {
      throw new Error(`Route already registered: ${hostname}`);
    }
    lease = store.registerRoute(hostname, ports[0], process.pid, force ?? false);
    try { onLease?.(lease.leaseId); }
    catch (error) { lease.release(); throw error; }
  } catch (error) {
    await active.stop();
    throw error;
  }

  let generation = 1;
  let stopping = false;
  let deployPromise: Promise<RollingDeployResult> | undefined;
  let stopPromise: Promise<void> | undefined;
  let currentPort = ports[0];
  let snapshot: Readonly<RollingStatus> = Object.freeze({ phase: 'running', generation, port: currentPort,
    pid: active.child.pid ?? null, previousPort: null, updatedAt: new Date().toISOString() });
  const update = (phase: RollingPhase, previousPort: number | null = null) => {
    snapshot = Object.freeze({ phase, generation, port: phase === 'stopped' ? null : currentPort,
      pid: phase === 'stopped' ? null : (active.child.pid ?? null), previousPort,
      updatedAt: new Date().toISOString() });
    try { onStatus?.(snapshot); } catch { /* Telemetry must not break routing. */ }
  };
  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  const deploy = (): Promise<RollingDeployResult> => {
    if (stopping) return Promise.reject(new Error('Cannot deploy a stopping application'));
    if (deployPromise) return deployPromise;
    deployPromise = (async () => {
      if (!active.running) throw new Error('Current application has already exited');
      const old = active;
      const previousPort = currentPort;
      const nextPort = ports[(ports.indexOf(previousPort) + 1) % ports.length];
      update('deploying', previousPort);
      let candidate: SupervisedProcess | undefined;
      let switched = false;
      try {
        candidate = await launch(nextPort);
        if (stopping) throw new Error('Deployment cancelled by shutdown');
        if (!old.running) throw new Error('Current application exited before handover');
        if (!lease.switchBackends([{ port: nextPort }])) throw new Error('Route lease was superseded');
        switched = true;
        // The old process remains alive until the replacement survives the
        // requested post-cutover health verification window.
        for (let i = 0; i < verificationChecks; i++) {
          if (i) await delay(verificationIntervalMs);
          if (stopping || !candidate.running || !(await probeApplicationHealth(nextPort, options.health))) {
            throw new Error('Replacement became unhealthy; rolling back traffic');
          }
        }
        active = candidate;
        currentPort = nextPort;
        generation++;
        update('draining', previousPort);
        const drained = await connections.waitForIdle(hostname, previousPort, drainTimeoutMs);
        await old.stop();
        if (!stopping) update('running');
        return { fromPort: previousPort, toPort: nextPort, generation, drained };
      } catch (error) {
        if (switched && active === old) {
          // Fail closed if our route was taken over; never overwrite a new owner.
          if (!lease.switchBackends([{ port: previousPort }])) {
            // Old process still belongs to this controller but its route is lost.
            update('running');
            await candidate?.stop();
            throw new Error('Rollback failed because route ownership changed', { cause: error });
          }
        }
        if (candidate && candidate !== active) await candidate.stop();
        if (!stopping) update('running');
        throw error;
      }
    })().finally(() => { deployPromise = undefined; });
    return deployPromise;
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    update('stopping');
    stopPromise = (async () => {
      // Wait for an in-flight deployment to roll back or finish before cleanup.
      if (deployPromise) await deployPromise.catch(() => {});
      try { lease.release(); }
      finally {
        await connections.waitForIdle(hostname, currentPort, drainTimeoutMs);
        await active.stop();
        update('stopped');
      }
    })();
    return stopPromise;
  };
  return { get current() { return active; }, get status() { return snapshot; }, lease, deploy, stop };
}
