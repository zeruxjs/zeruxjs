import {
  FleetMetricHistory,
  readFleetMetricHistory,
} from './fleet-metric-history.js';
import { evaluateFleetLiveHealth } from './fleet-live-health.js';
import { renderFleetPrometheus } from './fleet-prometheus.js';
/** Fleet CLI wrapper: one authenticated owner, persistent retry budget and
 * generation-based orphan recovery. The proxy provides the real drain observer. */
import type { InstanceFleet, FleetStatus } from './fleet-types.js';
import {
  createFleetAutoscaler,
  type FleetAutoscaler,
} from './fleet-autoscaler.js';
import { launchInstanceFleet } from './instance-fleet.js';
import {
  fingerprintFleetConfig,
  createFleetCheckpointWriter,
  readFleetCheckpoint,
  removeFleetCheckpoint,
} from './fleet-state.js';
import { RemoteBackendConnections } from './proxy-control.js';
import {
  createLocalControl,
  sendLocalControl,
  ensureControlDirectory,
  readControlDescriptor,
  type LocalControl,
} from './local-control.js';
import {
  createGenerationRegistry,
  readGenerationRecord,
  recoverRollingGenerations,
  recoverRollingGenerationsLocked,
} from './generation-registry.js';
import { withOperationLock } from './operation-lock.js';
import { processIdentity, processExists } from './lifecycle.js';
import {
  discoverStateWithRecovery,
  isProxyRunning,
  waitForProxy,
} from './cli-utils.js';
import { portlessProxy } from './portless.js';
import { RouteStore } from './routes.js';
import {
  appendFleetHistory,
  readFleetHistory,
  type FleetEventKind,
} from './fleet-events.js';
import { inspectFleetState } from './fleet-diagnostics.js';
import { formatUrl, parseHostname } from './utils.js';
import type { FleetRunArguments } from '../bin/parse-fleet.js';

/** Start the explicit process-lifetime fleet CLI owner with real proxy drain access, private checkpoints/control and verified generation recovery; this command may start the shared proxy.
 * @param {FleetRunArguments} options - Previously validated CLI host command/inventory/policy, never request-selected executable source.
 * @returns {Promise<void>} Startup receipt only; installed signal/control handlers own eventual process cleanup.
 */
export async function startFleetFromCLI(
  options: FleetRunArguments
): Promise<void> {
  if (
    options.autoscale &&
    options.autoscale.metric &&
    options.autoscale.metric !== 'rps' &&
    process.platform !== 'linux'
  ) {
    throw new Error(
      'CPU and memory autoscaling require Linux /proc resource metrics'
    );
  }
  /** Discovered verified proxy state used by the explicit CLI process owner. */
  const { dir, port, tls, tld } = await discoverStateWithRecovery();
  if (!(await isProxyRunning(port, tls))) {
    if (
      !(await portlessProxy(port, { https: tls, tld })) ||
      !(await waitForProxy(port, undefined, undefined, tls))
    ) {
      throw new Error('Proxy is not ready');
    }
  }
  /** Private authenticated client for actual serving-proxy drain/telemetry, not a synthetic tracker. */
  const connections = new RemoteBackendConnections(dir);
  await connections.waitForIdle('probe.localhost', 1, 0);
  /** Validated route name under the discovered host routing suffix. */
  const hostname = parseHostname(options.name, tld);
  /** Stable command/capacity/restart policy identity required before reusing private checkpoints. */
  const fingerprint = fingerprintFleetConfig(
    options.command,
    options.ports,
    options.replicas,
    options.restartWindowMs,
    options.autoscale
  );
  let fleet: InstanceFleet | undefined;
  let scaler: FleetAutoscaler | undefined;
  let control: LocalControl | undefined;
  let registry: ReturnType<typeof createGenerationRegistry> | undefined;
  let stopping: Promise<void> | undefined;
  let lastRecorded:
    | { phase: string; generation: number; desired: number }
    | undefined;
  /** Append bounded host-only lifecycle facts; diagnostic storage failure must not crash healthy capacity.
   * @param {FleetEventKind} kind Fixed supported event category.
   * @param {string} message Trusted operational summary excluding credentials/request data.
   * @param {Readonly<FleetStatus> | undefined} status Optional captured controller observation.
   * @returns {void} Best-effort history write with explicit private diagnostic failure reporting. */
  const record = (
    kind: FleetEventKind,
    message: string,
    status?: Readonly<FleetStatus>
  ) => {
    /** Supplied or latest controller observation used for a bounded diagnostic event. */
    const current = status ?? fleet?.status;
    if (!current) {
      return;
    }
    try {
      appendFleetHistory(dir, hostname, {
        kind,
        message: message.slice(0, 512),
        desiredReplicas: current.desiredReplicas,
        generation: current.generation,
      });
    } catch (error) {
      console.error('Fleet audit trail failed:', error);
    }
  };
  try {
    await withOperationLock(ensureControlDirectory(dir, true), async () => {
      await recoverRollingGenerations(dir, hostname);
      /** Private prior endpoint owner requiring native identity checks before takeover. */
      const existing = readControlDescriptor(dir, hostname);
      if (
        existing &&
        (processIdentity(existing.pid) === existing.identity ||
          (processIdentity(existing.pid) === null &&
            processExists(existing.pid)))
      ) {
        throw new Error(
          'An application controller is already running or unverifiable'
        );
      }
      /** Owned local checkpoint writer binding this verified controller identity and configuration. */
      const writer = createFleetCheckpointWriter(
        dir,
        hostname,
        fingerprint,
        processIdentity(process.pid) ?? ''
      );
      registry = createGenerationRegistry(dir, hostname);
      fleet = await launchInstanceFleet(options.command, {
        store: new RouteStore(dir),
        hostname,
        ports: options.ports,
        replicas: writer.restoredReplicas ?? options.replicas,
        connections,
        force: options.force,
        health: { path: options.healthPath },
        healthIntervalMs: options.healthIntervalMs,
        unhealthyThreshold: options.unhealthyThreshold,
        maxReplacements: options.maxReplacements,
        restartWindowMs: options.restartWindowMs,
        replacementDelayMs: options.replacementDelayMs,
        maxReplacementDelayMs: options.maxReplacementDelayMs,
        readyTimeoutMs: options.readyTimeoutMs,
        shutdownTimeoutMs: options.shutdownTimeoutMs,
        drainTimeoutMs: options.drainTimeoutMs,
        restoredAttempts: writer.restoredAttempts,
        onBudgetAttempt: (attempts) => {
          writer.attempt(attempts);
          record('budget', `Replacement attempt ${attempts.length}`);
        },
        onStatus: (status) => {
          writer.update(status);
          /** Last recorded transition fields used to avoid event/fsync writes on every observation. */
          const prev = lastRecorded;
          if (
            !prev ||
            prev.phase !== status.phase ||
            prev.desired !== status.desiredReplicas ||
            prev.generation !== status.generation
          ) {
            let kind: FleetEventKind;
            if (!prev) {
              kind = 'start';
            } else if (prev.desired !== status.desiredReplicas) {
              kind = 'scale';
            } else if (prev.generation !== status.generation) {
              kind = 'replacement';
            } else {
              kind = 'phase';
            }
            record(
              kind,
              `${status.phase}, desired=${status.desiredReplicas}, generation=${status.generation}`,
              status
            );
            lastRecorded = {
              phase: status.phase,
              desired: status.desiredReplicas,
              generation: status.generation,
            };
          }
        },
        onLease: (id) => registry!.lease(id),
        onSpawn: (child, childPort) => {
          if (!child.pid || !registry) {
            throw new Error('Cannot track fleet generation');
          }
          /** Actual spawned owned child PID recorded immediately before readiness. */
          const pid = child.pid;
          registry.track(pid, childPort);
          child.once('close', () => {
            try {
              registry?.untrack(pid);
            } catch (error) {
              console.error('Fleet generation bookkeeping failed:', error);
            }
          });
        },
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORTLESS_URL: formatUrl(hostname, port, tls),
        },
      });
      // The fleet source API deliberately treats onStatus as best-effort telemetry.
      // Refuse to publish a control endpoint unless this generation's checkpoint
      // was actually written successfully.
      /** Published private checkpoint receipt required before exposing this controller endpoint. */
      const first = writer.snapshot;
      if (
        !first ||
        first.owner.pid !== process.pid ||
        first.owner.identity !== processIdentity(process.pid)
      ) {
        throw new Error('Fleet status checkpoint was not persisted');
      }
      if (options.autoscale) {
        /** Single-controller private aggregate-history writer; no user-level event payloads are stored. */
        const history = new FleetMetricHistory(dir, hostname);
        scaler = createFleetAutoscaler(
          fleet,
          options.ports,
          connections,
          options.autoscale,
          writer.restoredAutoscale,
          (state) => writer.setAutoscale(state),
          undefined,
          (observation) => {
            history.record(observation);
          }
        );
        writer.setAutoscale(scaler.status);
      }
      control = await createLocalControl(
        dir,
        hostname,
        async (action, data) => {
          if (!fleet) {
            throw new Error('Fleet controller unavailable');
          }
          if (action === 'status') {
            return fleet.status;
          }
          if (action === 'reconcile') {
            return fleet.reconcile();
          }
          if (action === 'scale') {
            if (
              !Number.isSafeInteger(data) ||
              (data as number) < 2 ||
              (data as number) > Math.min(16, options.ports.length - 1)
            ) {
              throw new RangeError('Invalid fleet scale target');
            }
            if (
              options.autoscale &&
              ((data as number) < options.autoscale.minReplicas ||
                (data as number) > options.autoscale.maxReplicas)
            ) {
              throw new RangeError(
                'Target is outside the configured autoscaling bounds'
              );
            }
            scaler?.pause(); // Explicit operator capacity overrides automatic decisions.
            return fleet.scaleTo(data as number);
          }
          if (action === 'pause' || action === 'resume') {
            if (!scaler) {
              throw new Error('Autoscaling was not enabled for this fleet');
            }
            if (action === 'pause') {
              scaler.pause();
            } else {
              scaler.resume();
            }
            record(
              'autoscale',
              `Autoscaling ${action === 'pause' ? 'paused' : 'resumed'}`
            );
            return scaler.status;
          }
          if (action === 'metrics') {
            /** Snapshot healthy routed backend ports used for real proxy telemetry queries. */
            const routed = fleet.status.members
              .filter((m) => m.routed && m.healthy)
              .map((m) => m.port);
            return {
              metrics: await connections.metrics(
                hostname,
                routed,
                options.autoscale?.windowMs ?? 30000
              ),
              status: fleet.status,
              autoscaling: scaler?.status ?? null,
              policy: scaler?.config ?? null,
              observation: scaler?.lastObservation ?? null,
            };
          }
          if (action === 'stop') {
            /** Actual selected controller/action receipt, including explicit partial or failed outcomes. */
            const result = await stop();
            return result;
          }
          throw new Error('Unknown fleet operation');
        }
      );
    });
  } catch (error) {
    scaler?.stop();
    await fleet?.stop().catch(() => {});
    await control?.close().catch(() => {});
    try {
      registry?.close();
    } catch {
      /* Leave generations for verified recovery. */
    }
    throw error;
  }
  /** Stop autosampling, await the fleet’s actual child cleanup and retain failed recovery evidence before removing signal hooks.
   * @returns {Promise<Readonly<FleetStatus>>} Shared terminal controller status; deferred control close allows the remote reply to flush.
   */
  function stop(): Promise<Readonly<FleetStatus>> {
    if (stopping) {
      return stopping.then(() => fleet!.status);
    }
    stopping = (async () => {
      try {
        scaler?.stop();
        await fleet!.stop();
      } finally {
        try {
          registry?.close();
        } catch (error) {
          console.error('Fleet recovery record retained:', error);
        }
        // Allow remote stop response to flush before removing its TCP endpoint.
        setImmediate(() => {
          void control?.close().catch(() => {});
        });
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
    })();
    return stopping.then(() => fleet!.status);
  }
  /** Request controller-owned cleanup from process termination signals.
   * @returns {void} Observes asynchronous shutdown rejection and sets a failing process exit code. */
  const onSignal = () => {
    void stop().catch((error) => {
      console.error('Fleet shutdown failed:', error);
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  console.log(
    `Fleet ready: ${formatUrl(hostname, port, tls)} (${options.replicas} replicas, ${options.ports.length} ports)`
  );
}

/** Perform one explicit authorized local fleet operator action using private identity-verified controls or bounded diagnostic files.
 * @param {'status' | 'reconcile' | 'stop' | 'recover' | 'backends' | 'reset' | 'scale' | 'pause' | 'resume' | 'metrics' | 'history' | 'samples' | 'doctor'} action - Supported fixed CLI operation, never an arbitrary method name.
 * @param {string} name - Validated route label inside the host’s configured namespace.
 * @param {boolean} json - Print structured host-only output instead of text.
 * @param {boolean} dryRun - Explicit read-only preview for generation recovery.
 * @param {number} scaleTarget - Optional validated manual capacity target; operator scale pauses autoscaling.
 * @param {boolean} prometheus - Select fixed metric exposition or the existing live-doctor mode.
 * @returns {Promise<boolean>} Whether the selected operator check/action succeeded; it does not grant browser/admin authorization.
 */
export async function fleetCLIAction(
  action:
    | 'status'
    | 'reconcile'
    | 'stop'
    | 'recover'
    | 'backends'
    | 'reset'
    | 'scale'
    | 'pause'
    | 'resume'
    | 'metrics'
    | 'history'
    | 'samples'
    | 'doctor',
  name: string,
  json = false,
  dryRun = false,
  scaleTarget?: number,
  prometheus = false
): Promise<boolean> {
  /** Verified local proxy namespace for this one explicit operator action. */
  const { dir, tld } = await discoverStateWithRecovery();
  /** Validated route name under the discovered host routing suffix. */
  const hostname = parseHostname(name, tld);
  if (action === 'doctor' && prometheus) {
    /** Validated private persisted fleet observation, never current health evidence alone. */
    const checkpoint = readFleetCheckpoint(dir, hostname);
    if (!checkpoint) {
      throw new Error('Cannot run live doctor without fleet checkpoint');
    }
    /** Actual authenticated controller snapshot obtained through private control. */
    const controllerStatus = await sendLocalControl<FleetStatus>(
      dir,
      hostname,
      'status'
    );
    /** Snapshot healthy routed backend ports used for real proxy telemetry queries. */
    const routed = controllerStatus.members
      .filter((m) => m.routed && m.healthy)
      .map((m) => m.port);
    if (!routed.length) {
      throw new Error('No healthy fleet backends available');
    }
    /** Actual serving-proxy aggregate for the captured healthy routed backend inventory. */
    const metrics = await new RemoteBackendConnections(dir).metrics(
      hostname,
      routed
    );
    /** Coverage-aware live or offline host-only diagnostic findings. */
    const report = evaluateFleetLiveHealth(controllerStatus, metrics);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `${hostname}: ${report.healthy ? 'healthy' : 'unhealthy'} (live)`
      );
      for (const message of [...report.failures, ...report.warnings]) {
        console.log(`  ${message}`);
      }
    }
    return report.healthy;
  }
  if (action === 'doctor') {
    /** Coverage-aware live or offline host-only diagnostic findings. */
    const report = inspectFleetState(dir, hostname);
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `${hostname}: ${report.online ? 'online' : 'offline'} ${report.readyReplicas}/${report.desiredReplicas} ready`
      );
      for (const warning of report.warnings) {
        console.log(`  Warning: ${warning}`);
      }
    }
    return !report.warnings.length;
  }
  if (action === 'samples') {
    /** Bounded private aggregate sample history, excluding request/user labels. */
    const points = readFleetMetricHistory(dir, hostname);
    if (json) {
      console.log(JSON.stringify(points, null, 2));
    } else {
      points.forEach((point) =>
        console.log(
          `${new Date(point.sampledAt).toISOString()} ${point.metric}: ${point.value.toFixed(2)} replicas=${point.desiredReplicas}`
        )
      );
    }
    return true;
  }
  if (action === 'history') {
    /** Bounded private lifecycle event history, not payload or credential logs. */
    const entries = readFleetHistory(dir, hostname);
    if (json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      entries.forEach((entry) =>
        console.log(`${entry.at} ${entry.kind}: ${entry.message}`)
      );
    }
    return true;
  }
  if (action === 'backends') {
    /** Actual serving-proxy backend observations requested for this authorized route. */
    const data = await new RemoteBackendConnections(dir).status(hostname);
    if (json) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!data.length) {
      console.log(`${hostname}: no current backends`);
    } else {
      for (const row of data) {
        console.log(
          `${row.port} ${row.healthy ? 'healthy' : 'isolated'} failures=${row.failures}`
        );
      }
    }
    return true;
  }
  if (action === 'recover') {
    /** Actual selected controller/action receipt, including explicit partial or failed outcomes. */
    const result = await recoverRollingGenerationsLocked(dir, hostname, {
      dryRun,
    });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `${hostname}: ${dryRun ? 'preview' : 'recovery'} terminated=${result.terminated.length} pending=${result.wouldTerminate?.length ?? 0}`
      );
    }
    return true;
  }
  if (action === 'reset') {
    /** Explicit local checkpoint-reset receipt under the shared operation lock. */
    const removed = await withOperationLock(
      ensureControlDirectory(dir, true),
      async () => {
        /** Private current endpoint owner whose native creation identity is checked before mutation. */
        const owner = readControlDescriptor(dir, hostname);
        if (
          owner &&
          (processIdentity(owner.pid) === owner.identity ||
            (processIdentity(owner.pid) === null && processExists(owner.pid)))
        ) {
          throw new Error(
            'Cannot reset checkpoint while an application controller is online or unverifiable'
          );
        }
        if (readGenerationRecord(dir, hostname)) {
          throw new Error(
            'Recover orphan generations before resetting a fleet checkpoint'
          );
        }
        return removeFleetCheckpoint(dir, hostname);
      }
    );
    if (json) {
      console.log(JSON.stringify({ hostname, removed }));
    } else {
      console.log(
        `${hostname}: ${removed ? 'checkpoint reset' : 'no checkpoint exists'}`
      );
    }
    return true;
  }
  if (action === 'status') {
    /** Validated private persisted fleet observation, never current health evidence alone. */
    const checkpoint = readFleetCheckpoint(dir, hostname);
    if (!checkpoint) {
      console.error(`No fleet checkpoint: ${hostname}`);
      return false;
    }
    /** Private current endpoint owner whose native creation identity is checked before mutation. */
    const owner = readControlDescriptor(dir, hostname);
    /** Native owner/checkpoint identity agreement; not a web authorization bypass. */
    const online = !!(
      owner &&
      processIdentity(owner.pid) === owner.identity &&
      owner.pid === checkpoint.owner.pid &&
      owner.identity === checkpoint.owner.identity
    );
    /** Private generation recovery evidence retained when controller identity is offline. */
    const pending = !online ? readGenerationRecord(dir, hostname) : null;
    /** Host-only operational status including coverage/recovery metadata, excluding endpoint tokens. */
    const output = {
      ...checkpoint.status,
      online,
      recoveryRequired: !!pending,
      orphanGenerations: pending?.children.length ?? 0,
      budgetTimestamps: checkpoint.attempts,
      autoscaling: checkpoint.autoscale ?? null,
    };
    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(
        `${hostname}: ${checkpoint.status.phase} ${checkpoint.status.members.filter((m) => m.healthy && m.routed).length}/${checkpoint.status.desiredReplicas} healthy (${online ? 'online' : 'offline'})${pending ? ' recovery required' : ''}`
      );
    }
    return true;
  }
  // Remote owner is authenticated and fingerprint-verified by the control client.
  /** Actual selected controller/action receipt, including explicit partial or failed outcomes. */
  const result = await sendLocalControl(
    dir,
    hostname,
    action,
    action === 'scale' ? scaleTarget : undefined,
    615_000
  );
  if (prometheus && action === 'metrics') {
    console.log(
      renderFleetPrometheus(
        result as Parameters<typeof renderFleetPrometheus>[0]
      )
    );
  } else if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${hostname}: ${action} completed`, result);
  }
  return true;
}
