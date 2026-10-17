/** Local multi-process application supervision with health-aware backend rotation.
 * One controller owns one route lease; traffic is never published until the
 * initial replica set is ready. All child processes are launched without a shell.
 */
import { validateBackends } from './backend-pool.js';
import { probeApplicationHealth, validateHealthCheck } from './health.js';
import { launchSupervisedCommand, type SupervisedProcess } from './process-supervisor.js';
import type { RouteLease } from './routes.js';
import type { FleetPhase, FleetStatus, FleetReconcileResult, InstanceFleet, InstanceFleetOptions } from './fleet-types.js';
import { SlidingRestartBudget } from './restart-budget.js';
import { availableFleetPort, fleetRetirementCandidate } from './fleet-capacity.js';

interface Member {
  port: number;
  process: SupervisedProcess;
  failures: number;
  healthy: boolean;
  routed: boolean;
  generation: number;
}
function integer(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`${name} must be ${min}–${max}`);
  return n;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export async function launchInstanceFleet(argv: readonly string[], options: InstanceFleetOptions): Promise<InstanceFleet> {
  if (!options.connections || typeof options.connections.waitForIdle !== 'function') {
    throw new TypeError('A real proxy connection drain observer is required');
  }
  const ports = validateBackends(options.ports.map(port => ({ port }))).map(target => target.port);
  const replicas = integer(options.replicas, 2, 2, 16, 'replicas');
  if (ports.length < replicas + 1) throw new RangeError('A fleet requires a spare port beyond its replica count');
  const healthIntervalMs = integer(options.healthIntervalMs, 2000, 100, 3_600_000, 'healthIntervalMs');
  const unhealthyThreshold = integer(options.unhealthyThreshold, 2, 1, 20, 'unhealthyThreshold');
  const maxReplacements = integer(options.maxReplacements, 5, 0, 1000, 'maxReplacements');
  const restartWindowMs = integer(options.restartWindowMs, 60_000, 100, 86_400_000, 'restartWindowMs');
  const replacementDelayMs = integer(options.replacementDelayMs, 100, 0, 60_000, 'replacementDelayMs');
  const maxReplacementDelayMs = integer(options.maxReplacementDelayMs, 5000, 0, 300_000, 'maxReplacementDelayMs');
  const drainTimeoutMs = integer(options.drainTimeoutMs, 10_000, 0, 300_000, 'drainTimeoutMs');
  const health = validateHealthCheck(options.health);
  const { store, hostname, connections, onStatus, onSpawn, onLease, force,
    restoredAttempts, onBudgetAttempt, ports: _ports, replicas: _replicas, healthIntervalMs: _interval,
    unhealthyThreshold: _threshold, maxReplacements: _budget, restartWindowMs: _window,
    replacementDelayMs: _delay, maxReplacementDelayMs: _delayMax, drainTimeoutMs: _drain,
    ...supervisor } = options;
  const members = new Map<number, Member>();
  const budget = new SlidingRestartBudget(maxReplacements, restartWindowMs, replacementDelayMs, maxReplacementDelayMs);
  budget.restore(restoredAttempts ?? []);
  let generation = 0;
  let desiredReplicas = replicas;
  let replacementAttempts = 0;
  let lastError: string | null = null;
  let stopping = false;
  let phase: FleetPhase = 'starting';
  let timer: ReturnType<typeof setInterval> | undefined;
  let operation: Promise<FleetReconcileResult> | undefined;
  let resizeOperation: Promise<Readonly<FleetStatus>> | undefined;
  let stopPromise: Promise<void> | undefined;
  let cancelPause: (() => void) | undefined;
  let lease: RouteLease | undefined;
  let snapshot: Readonly<FleetStatus>;

  const publish = () => {
    snapshot = Object.freeze({ phase, hostname, desiredReplicas, generation,
      replacementAttempts, budgetUsed: budget.used, lastError,
      members: Object.freeze([...members.values()].map(m => Object.freeze({
        port: m.port, pid: m.process.child.pid ?? null, healthy: m.healthy && m.process.running,
        routed: m.routed, failures: m.failures, generation: m.generation,
      }))), updatedAt: new Date().toISOString() });
    try { onStatus?.(snapshot); } catch { /* Reporting must not affect processes. */ }
  };
  const cancellablePause = (ms: number) => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); if (cancelPause === done) cancelPause = undefined; resolve(); };
    const timer = setTimeout(done, ms);
    cancelPause = done;
  });
  const serving = () => [...members.values()].filter(m => m.routed && m.process.running);
  const switchTo = (targets: readonly Member[]) => {
    if (!lease?.switchBackends(targets.map(m => ({ port: m.port })))) throw new Error('Fleet route lease was superseded');
    for (const m of members.values()) m.routed = targets.includes(m);
  };
  const spawn = async (port: number): Promise<Member> => {
    const proc = await launchSupervisedCommand(argv, {
      ...supervisor, port, health, forwardSignals: false,
      env: { ...supervisor.env, PORT: String(port) },
      onSpawn: child => { if (stopping) throw new Error('Fleet is stopping'); onSpawn?.(child, port); },
    });
    const entry: Member = { port, process: proc, healthy: true, routed: false, failures: 0, generation: ++generation };
    // Unexpected process exits trigger a check without requiring an active HTTP probe.
    void proc.completed.then(() => {
      if (members.get(port) === entry && !stopping) {
        entry.healthy = false;
        entry.failures = unhealthyThreshold;
        publish();
        queueMicrotask(() => { if (!stopping) void reconcile().catch(() => {}); });
      }
    });
    return entry;
  };

  // No routes or long-lived listeners are published on partial startup failure.
  try {
    if (!force && store.loadRoutes().some(route => route.hostname === hostname)) {
      throw new Error(`Route already registered: ${hostname}`);
    }
    for (const port of ports.slice(0, replicas)) {
      const member = await spawn(port);
      members.set(port, member);
    }
    lease = store.registerPoolRoute(hostname, [...members.keys()].map(port => ({ port })), process.pid, force ?? false);
    for (const member of members.values()) member.routed = true;
    try { onLease?.(lease.leaseId); }
    catch (error) { lease.release(); throw error; }
  } catch (error) {
    stopping = true;
    await Promise.allSettled([...members.values()].map(member => member.process.stop()));
    throw error;
  }
  phase = 'running';
  publish();

  const runReconcile = async (): Promise<FleetReconcileResult> => {
    const replaced: { fromPort: number; toPort: number; drained: boolean }[] = [];
    const failures: { port: number; error: string }[] = [];
    // Test each process once; never launch concurrent probes from overlapping ticks.
    await Promise.all([...members.values()].map(async member => {
      if (stopping) return;
      const ok = member.process.running && await probeApplicationHealth(member.port, health);
      if (ok) {
        member.failures = 0;
        member.healthy = true;
      } else {
        member.failures = Math.min(unhealthyThreshold, member.failures + 1);
        if (member.failures >= unhealthyThreshold) member.healthy = false;
      }
    }));
    if (stopping) return { replaced, failures, status: snapshot };
    // A previously isolated process can recover before its next replacement
    // attempt. Safely rejoin it if the controller still owns the route.
    for (const recovered of members.values()) {
      if (recovered.healthy && !recovered.routed && serving().length < desiredReplicas) {
        try { switchTo([...serving(), recovered]); }
        catch (error) { lastError = errorMessage(error); failures.push({ port: recovered.port, error: lastError }); }
      }
    }
    for (const old of [...members.values()]) {
      if (stopping) break;
      if (old.healthy || old.failures < unhealthyThreshold) continue;
      // If another backend can serve traffic, isolate the failing generation
      // immediately, without waiting for a new process to become ready.
      const survivors = serving().filter(m => m !== old && m.healthy);
      if (old.routed && survivors.length) {
        try { switchTo(survivors); }
        catch (error) { lastError = errorMessage(error); failures.push({ port: old.port, error: lastError }); break; }
      }
        if (!budget.canAttempt()) {
        lastError = `Replacement budget exhausted (${maxReplacements} per ${restartWindowMs}ms)`;
        failures.push({ port: old.port, error: lastError });
        continue;
      }
      // Preserve one unused port for ready-before-cutover replacement.
      const spare = availableFleetPort(ports, new Set(members.keys()));
      if (spare === undefined) {
        lastError = 'No spare port available for replacement';
        failures.push({ port: old.port, error: lastError });
        continue;
      }
      const backoff = budget.consume();
      // Retry attempts survive controller restarts. Fail closed if persistence fails.
      try { onBudgetAttempt?.(budget.snapshot()); }
      catch (error) {
        lastError = errorMessage(error);
        failures.push({ port: old.port, error: lastError });
        break;
      }
      replacementAttempts++;
      if (backoff) await cancellablePause(backoff);
      if (stopping) break;
      let candidate: Member | undefined;
      try {
        candidate = await spawn(spare);
        if (stopping) throw new Error('Fleet is stopping');
        if (!candidate.process.running) throw new Error('Replacement exited before route publication');
        members.set(spare, candidate);
        // Atomic route publication is protected by the existing lease lock.
        const targets = [...members.values()].filter(m => m !== old && m.routed && m.healthy);
        targets.push(candidate);
        switchTo(targets);
        // Once published, the replacement is committed. Draining or stopping
        // the old child must never destroy a newly published live backend.
        members.delete(old.port);
        let drained = false;
        try { drained = await connections.waitForIdle(hostname, old.port, drainTimeoutMs); }
        catch (error) { lastError = errorMessage(error); failures.push({ port: old.port, error: lastError }); }
        try { await old.process.stop(); }
        catch (error) { lastError = errorMessage(error); failures.push({ port: old.port, error: lastError }); }
        replaced.push({ fromPort: old.port, toPort: spare, drained });
        if (!failures.length) lastError = null;
      } catch (error) {
        lastError = errorMessage(error);
        failures.push({ port: old.port, error: lastError });
        if (candidate) {
          members.delete(candidate.port);
          await candidate.process.stop().catch(() => {});
        }
      }
    }
    // A failed manual scale-up (or a prior incomplete repair) may leave fewer
    // serving members than the desired target. Repair that deficit within the
    // same durable restart budget, never publishing an unready backend.
    if (!stopping && failures.length === 0) {
      while (!stopping && serving().filter(m => m.healthy).length < desiredReplicas) {
        if (!budget.canAttempt()) {
          lastError = 'Replacement budget exhausted while restoring desired capacity';
          failures.push({ port: 0, error: lastError }); break;
        }
        const spare = availableFleetPort(ports, new Set(members.keys()));
        if (spare === undefined) {
          lastError = 'No spare port available while restoring desired capacity';
          failures.push({ port: 0, error: lastError }); break;
        }
        const backoff = budget.consume();
        try { onBudgetAttempt?.(budget.snapshot()); }
        catch (error) { lastError = errorMessage(error); failures.push({ port: spare, error: lastError }); break; }
        replacementAttempts++;
        if (backoff) await cancellablePause(backoff);
        if (stopping) break;
        let candidate: Member | undefined;
        try {
          candidate = await spawn(spare);
          if (stopping) throw new Error('Fleet is stopping');
          members.set(spare, candidate);
          switchTo([...serving(), candidate]);
        } catch (error) {
          lastError = errorMessage(error);
          failures.push({ port: spare, error: lastError });
          if (candidate) { members.delete(spare); await candidate.process.stop().catch(() => {}); }
          break;
        }
      }
    }
    if (!stopping) {
      phase = [...members.values()].filter(m => m.routed && m.healthy && m.process.running).length === desiredReplicas ? 'running' : 'degraded';
      if (phase === 'running' && !failures.length) lastError = null;
      publish();
    }
    return { replaced, failures, status: snapshot };
  };
  function reconcile(): Promise<FleetReconcileResult> {
    if (stopping) return Promise.reject(new Error('Fleet is stopping'));
    if (resizeOperation) return resizeOperation.then(() => reconcile());
    if (!operation) operation = runReconcile().finally(() => { operation = undefined; });
    return operation;
  }

  const scaleTo = (requested: number): Promise<Readonly<FleetStatus>> => {
    if (!Number.isSafeInteger(requested) || requested < 2 || requested > Math.min(16, ports.length - 1)) {
      return Promise.reject(new RangeError('Scale target must be 2–16 and leave at least one spare port'));
    }
    if (stopping) return Promise.reject(new Error('Fleet is stopping'));
    if (resizeOperation) return resizeOperation.then(() => scaleTo(requested));
    resizeOperation = (async () => {
      if (operation) await operation.catch(() => {});
      if (stopping) throw new Error('Fleet is stopping');
      desiredReplicas = requested;
      publish();
      try {
        // Ready-before-cutover. Publish each verified generation atomically;
        // errors retain healthy capacity rather than withdrawing serving routes.
        while (serving().filter(m => m.healthy).length < desiredReplicas) {
          if (stopping) throw new Error('Fleet is stopping');
          const spare = availableFleetPort(ports, new Set(members.keys()));
          if (spare === undefined) throw new Error('No spare port available for scale-up');
          let candidate: Member | undefined;
          try {
            candidate = await spawn(spare);
            if (stopping) throw new Error('Fleet is stopping');
            members.set(spare, candidate);
            switchTo([...serving(), candidate]);
            publish();
          } catch (error) {
            if (candidate) {
              members.delete(candidate.port);
              await candidate.process.stop().catch(() => {});
            }
            throw error;
          }
        }
        while (serving().length > desiredReplicas) {
          if (stopping) throw new Error('Fleet is stopping');
          const candidates = serving();
          // Remove the newest first. Older members remain warm and retain leases.
          const selected = fleetRetirementCandidate(candidates.map(m => ({ ...m, running: m.process.running })));
          const victim = candidates.find(m => m.port === selected?.port)!;
          switchTo(candidates.filter(m => m !== victim));
          members.delete(victim.port);
          publish();
          try { await connections.waitForIdle(hostname, victim.port, drainTimeoutMs); }
          finally { await victim.process.stop(); }
        }
        phase = serving().filter(m => m.healthy).length === desiredReplicas ? 'running' : 'degraded';
        lastError = null;
      } catch (error) {
        lastError = errorMessage(error);
        phase = 'degraded';
        publish();
        throw error;
      }
      publish();
      return snapshot;
    })().finally(() => { resizeOperation = undefined; });
    return resizeOperation;
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    cancelPause?.();
    if (timer) clearInterval(timer);
    phase = 'stopping';
    publish();
    stopPromise = (async () => {
      if (operation) await operation.catch(() => {});
      if (resizeOperation) await resizeOperation.catch(() => {});
      try { lease?.release(); }
      finally {
        await Promise.allSettled([...members.values()].map(async member => {
          try { if (member.routed) await connections.waitForIdle(hostname, member.port, drainTimeoutMs); }
          finally { await member.process.stop(); }
        }));
        members.clear();
        phase = 'stopped';
        publish();
      }
    })();
    return stopPromise;
  };
  timer = setInterval(() => { if (!stopping) void reconcile().catch(error => {
    lastError = errorMessage(error);
    phase = 'degraded';
    publish();
  }); }, healthIntervalMs);
  timer.unref?.();
  return { lease: lease!, get status() { return snapshot; }, reconcile, scaleTo, stop };
}
