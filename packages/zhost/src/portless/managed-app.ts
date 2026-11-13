/** Restartable, observable child supervision. Route leases exist only for ready
 * children; manual restarts are serialized and do not consume crash budgets. */
import {
  launchSupervisedCommand,
  exitStatus,
  type ProcessExit,
  type SupervisedProcess,
  type SupervisorOptions,
} from './process-supervisor.js';
import { probeApplicationHealth } from './health.js';
import {
  serializeExit,
  type ManagedPhase,
  type ManagedStatus,
  type StatusListener,
} from './managed-status.js';

export type RestartPolicy = 'never' | 'on-failure' | 'always';
export interface ManagedAppOptions extends SupervisorOptions {
  /** Explicit never/on-failure/always automatic restart policy; defaults to never. */
  restartPolicy?: RestartPolicy;
  /** Maximum automatic attempts within the accounting window; manual restarts are separate. */
  maxRestarts?: number;
  /** Sliding automatic-restart window in milliseconds. */
  restartWindowMs?: number;
  /** Initial automatic restart delay in milliseconds. */
  restartDelayMs?: number;
  /** Upper bound on exponential automatic restart delay. */
  maxRestartDelayMs?: number;
  /** Periodic loopback health interval; zero disables the monitor. */
  healthIntervalMs?: number;
  /** Consecutive failed probes before stopping the current owned child. */
  unhealthyThreshold?: number;
  /** Publish the route after readiness; return its cleanup closure. */
  onReady?: (
    process: SupervisedProcess
  ) => void | (() => void) | Promise<void | (() => void)>;
  /** Borrowed optional notification for automatic restart attempts; observer failure is isolated. */
  onRestart?: (attempt: number, delayMs: number, reason: ProcessExit) => void;
  /** Borrowed optional status observer, separate from route publication. */
  onStatus?: StatusListener;
}
export interface ManagedApp {
  /** Current owned child handle, absent between generations or after shutdown. */
  readonly current: SupervisedProcess | undefined;
  /** Whether the manager has not reached its terminal state; not a guarantee a child is currently ready. */
  readonly running: boolean;
  /** Immutable latest manager snapshot, separate from durable deployment history. */
  readonly status: Readonly<ManagedStatus>;
  /** Shared final process outcome after terminal cleanup. */
  readonly completed: Promise<ProcessExit>;
  /** Share a manual restart that waits for the prior child to exit without consuming the automatic crash budget.
   * @returns {Promise<void>} Resolves after replacement readiness/publication, or rejects on failure or shutdown.
   */
  restart(): Promise<void>;
  /** Acquire a manager-local status subscription for subsequent transitions; no initial snapshot is pushed.
   * @param {StatusListener} listener - Trusted observer whose errors cannot change supervision.
   * @returns {() => void} Idempotent listener removal; final shutdown also clears subscribers.
   */
  subscribe(listener: StatusListener): () => void;
  /** Request owned-child shutdown and prevent additional restarts; repeated callers share terminal completion.
   * @param {NodeJS.Signals} signal - Optional initial native termination signal.
   * @returns {Promise<ProcessExit>} Observed final process outcome after manager cleanup.
   */
  stop(signal?: NodeJS.Signals): Promise<ProcessExit>;
}

/** Apply a default and validate one bounded integer policy before child acquisition.
 * @param {number | undefined} value - Optional host-provided policy value.
 * @param {number} fallback - Default when the option is absent.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @param {string} name - Option label used in validation errors.
 * @returns {number} Validated integer policy.
 */
function integer(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string
): number {
  /** Policy candidate checked before resource acquisition. */
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}
/** Validate restart and health-monitor policy without starting children, timers or routes.
 * @param {ManagedAppOptions} options - Host-controlled supervisor options; health monitoring requires an application port.
 * @returns {Required<Pick<ManagedAppOptions, 'restartPolicy' | 'maxRestarts' | 'restartWindowMs' | 'restartDelayMs' | 'maxRestartDelayMs' | 'healthIntervalMs' | 'unhealthyThreshold'>>} Detached validated restart/monitor settings.
 */
export function validateManagedOptions(
  options: ManagedAppOptions
): Required<
  Pick<
    ManagedAppOptions,
    | 'restartPolicy'
    | 'maxRestarts'
    | 'restartWindowMs'
    | 'restartDelayMs'
    | 'maxRestartDelayMs'
    | 'healthIntervalMs'
    | 'unhealthyThreshold'
  >
> {
  /** Validated explicit automatic restart mode. */
  const restartPolicy = options.restartPolicy ?? 'never';
  if (!['never', 'on-failure', 'always'].includes(restartPolicy)) {
    throw new TypeError('Invalid restart policy');
  }
  /** Validated automatic restart count ceiling. */
  const maxRestarts = integer(options.maxRestarts, 3, 0, 100, 'maxRestarts');
  /** Validated sliding accounting window. */
  const restartWindowMs = integer(
    options.restartWindowMs,
    60_000,
    100,
    3_600_000,
    'restartWindowMs'
  );
  /** Validated initial backoff delay. */
  const restartDelayMs = integer(
    options.restartDelayMs,
    250,
    1,
    60_000,
    'restartDelayMs'
  );
  /** Validated backoff cap, required not to precede the initial delay. */
  const maxRestartDelayMs = integer(
    options.maxRestartDelayMs,
    10_000,
    1,
    120_000,
    'maxRestartDelayMs'
  );
  if (maxRestartDelayMs < restartDelayMs) {
    throw new RangeError('maxRestartDelayMs must be >= restartDelayMs');
  }
  /** Validated periodic health interval; zero leaves health monitoring disabled. */
  const healthIntervalMs = integer(
    options.healthIntervalMs,
    options.health?.path ? 10_000 : 0,
    0,
    300_000,
    'healthIntervalMs'
  );
  /** Validated consecutive health-failure threshold. */
  const unhealthyThreshold = integer(
    options.unhealthyThreshold,
    3,
    1,
    20,
    'unhealthyThreshold'
  );
  if (healthIntervalMs && healthIntervalMs < 100) {
    throw new RangeError('healthIntervalMs must be 0 or >=100');
  }
  if (
    (healthIntervalMs || options.health?.path) &&
    options.port === undefined
  ) {
    throw new Error('Health monitoring requires an application port');
  }
  return {
    restartPolicy,
    maxRestarts,
    restartWindowMs,
    restartDelayMs,
    maxRestartDelayMs,
    healthIntervalMs,
    unhealthyThreshold,
  };
}

/** Own serial child supervision, optional readiness publication and bounded automatic restart accounting.
 * @param {readonly string[]} argv - Trusted direct-exec operator command tokens, never request-supplied source.
 * @param {ManagedAppOptions} options - Host environment, readiness/restart policy and explicit route/observer callbacks.
 * @returns {Promise<ManagedApp>} Owned manager after initial readiness; await stop or completed before disposing dependent state.
 */
export async function launchManagedApplication(
  argv: readonly string[],
  options: ManagedAppOptions = {}
): Promise<ManagedApp> {
  /** Detached validated restart and monitor policy. */
  const config = validateManagedOptions(options);
  /** Separate route publication and observation callbacks from the existing child supervisor policy. */
  const { onReady, onRestart, onStatus, ...other } = options;
  let active: SupervisedProcess | undefined;
  let stopping = false;
  let settled = false;
  let resolveDone!: (result: ProcessExit) => void;
  let wakeDelay: (() => void) | undefined;
  let releaseRoute: (() => void) | undefined;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let failingHealth = false;
  let automaticRestarts = 0;
  let generation = 0;
  let lastExit: ManagedStatus['lastExit'] = null;
  /** Manager-local status observers, cleared after terminal settlement. */
  const subscribers = new Set<StatusListener>();
  let snapshot: ManagedStatus = Object.freeze({
    phase: 'starting' as ManagedPhase,
    pid: null,
    generation: 0,
    automaticRestarts: 0,
    lastExit: null,
    updatedAt: new Date().toISOString(),
  });
  let manual:
    | {
        promise: Promise<void>;
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | undefined;
  /** Ordered automatic attempt timestamps; bounded by configured count and sliding expiry. */
  const restartTimes: number[] = [];
  /** One manager terminal promise, shared by all stop callers. */
  const completed = new Promise<ProcessExit>((resolve) => {
    resolveDone = resolve;
  });
  /** Publish an immutable manager snapshot while isolating each trusted observer failure.
   * @param {ManagedPhase} phase - New lifecycle phase.
   * @param {number | null} pid - Explicit or current child PID.
   * @returns {void} Does not authorize route changes.
   */
  const update = (
    phase: ManagedPhase,
    pid: number | null = active?.child.pid ?? null
  ) => {
    snapshot = Object.freeze({
      phase,
      pid,
      generation,
      automaticRestarts,
      lastExit,
      updatedAt: new Date().toISOString(),
    });
    for (const listener of [...subscribers, ...(onStatus ? [onStatus] : [])]) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('Managed app status callback failed:', error);
      }
    }
  };
  /** Stop only this manager’s periodic health timer.
   * @returns {void} Already pending probes may settle and are fenced from acting on stopped children.
   */
  const clearMonitor = () => {
    if (monitor) {
      clearInterval(monitor);
    }
    monitor = undefined;
  };
  /** Clear then invoke the current route cleanup once, isolating its failure from supervisor cleanup.
   * @returns {void} A failed host cleanup is reported, not retried automatically.
   */
  const release = () => {
    /** Current borrowed route cleanup, detached before invocation to prevent repeated release. */
    const fn = releaseRoute;
    releaseRoute = undefined;
    if (fn) {
      try {
        fn();
      } catch (error) {
        console.error('Managed app route cleanup failed:', error);
      }
    }
  };
  /** Reject and clear the outstanding shared manual restart.
   * @param {Error} error - Host-visible restart failure.
   * @returns {void} No-op without a pending manual request.
   */
  const rejectManual = (error: Error) => {
    /** Detached manual-restart completion owner, cleared before resolving or rejecting callbacks. */
    const m = manual;
    manual = undefined;
    m?.reject(error);
  };
  /** Resolve and clear the outstanding manual restart after replacement readiness.
   * @returns {void} No-op without a pending manual request.
   */
  const acceptManual = () => {
    /** Detached manual-restart completion owner, cleared before resolving or rejecting callbacks. */
    const m = manual;
    manual = undefined;
    m?.resolve();
  };
  /** Request managed shutdown on host SIGINT.
   * @returns {void} Reuses the shared terminal completion.
   */
  const onSignalInt = () => {
    void stop('SIGINT');
  };
  /** Request managed shutdown on host SIGTERM.
   * @returns {void} Reuses the shared terminal completion.
   */
  const onSignalTerm = () => {
    void stop('SIGTERM');
  };
  /** Settle the manager once after loop completion, releasing monitors, routes, subscribers and signal forwarding.
   * @param {ProcessExit} result - Final observed child or startup outcome.
   * @returns {void} Isolates the optional final observer.
   */
  const finish = (result: ProcessExit) => {
    if (settled) {
      return;
    }
    settled = true;
    clearMonitor();
    release();
    active = undefined;
    lastExit = serializeExit(result);
    update('stopped', null);
    subscribers.clear();
    process.removeListener('SIGINT', onSignalInt);
    process.removeListener('SIGTERM', onSignalTerm);
    rejectManual(
      new Error('Application stopped before manual restart completed')
    );
    resolveDone(result);
    try {
      options.onExit?.(result);
    } catch (error) {
      console.error('Managed app exit callback failed:', error);
    }
  };
  /** Fence future restarts, wake pending backoff and request the current owned child’s shutdown.
   * @param {NodeJS.Signals} signal - Initial native signal, default SIGTERM.
   * @returns {Promise<ProcessExit>} Shared final manager outcome.
   */
  const stop = (signal: NodeJS.Signals = 'SIGTERM'): Promise<ProcessExit> => {
    if (!stopping && !settled) {
      stopping = true;
      update('stopping');
      rejectManual(new Error('Manual restart cancelled by shutdown'));
      wakeDelay?.();
      if (active?.running) {
        void active
          .stop(signal)
          .catch((error) => console.error('Managed app stop failed:', error));
      }
    }
    return completed;
  };
  /** Share one manual replacement request after the prior generation stops.
   * @returns {Promise<void>} Resolves only after replacement readiness and host publication.
   */
  const restart = (): Promise<void> => {
    if (stopping || settled) {
      return Promise.reject(new Error('Cannot restart a stopped application'));
    }
    if (manual) {
      return manual.promise;
    }
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    /** Shared manual restart receipt settled by the manager loop, not merely by sending a signal. */
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    manual = { promise, resolve, reject };
    update('restarting');
    wakeDelay?.();
    if (active?.running) {
      void active
        .stop('SIGTERM')
        .catch((error) =>
          rejectManual(
            error instanceof Error ? error : new Error(String(error))
          )
        );
    }
    return promise;
  };
  /** Public managed scope; stop/completed own terminal lifecycle, subscriptions return separate release handles. */
  const handle: ManagedApp = {
    get current() {
      return active;
    },
    get running() {
      return !settled;
    },
    get status() {
      return snapshot;
    },
    completed,
    restart,
    stop,
    /** Acquire a manager-local status subscription for subsequent transitions; no initial snapshot is pushed.
     * @param {StatusListener} listener - Trusted observer whose errors cannot change supervision.
     * @returns {() => void} Idempotent listener removal; final shutdown also clears subscribers.
     */
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
  /** Acquire a ready child, then await explicit host route publication; failure stops that child and releases any publication handle.
   * @returns {Promise<SupervisedProcess>} Owned ready/published child.
   */
  const spawn = async () => {
    /** Owned current/replacement child, never an arbitrary existing operator process. */
    const child = await launchSupervisedCommand(argv, {
      ...other,
      forwardSignals: false,
      onExit: undefined,
    });
    active = child;
    if (stopping || !child.running) {
      if (child.running) {
        await child.stop();
      }
      throw new Error('Application exited before route publication');
    }
    try {
      /** Optional host publication cleanup returned after readiness; retained until that generation retires. */
      const disposal = await onReady?.(child);
      releaseRoute = typeof disposal === 'function' ? disposal : undefined;
      if (stopping || !child.running) {
        throw new Error('Application exited while publishing route');
      }
    } catch (error) {
      if (child.running) {
        await child.stop();
      }
      release();
      throw error;
    }
    generation++;
    update('running');
    return child;
  };
  /** Own bounded nonoverlapping periodic loopback probes for the current generation.
   * @param {SupervisedProcess} child - Owned generation whose liveness fences probe results.
   * @returns {void} Unhealthy children are stopped through the native supervisor.
   */
  const monitorHealth = (child: SupervisedProcess) => {
    if (!config.healthIntervalMs || options.port === undefined) {
      return;
    }
    let pending = false;
    let failures = 0;
    monitor = setInterval(() => {
      if (pending || !child.running || stopping || manual) {
        return;
      }
      pending = true;
      void probeApplicationHealth(options.port!, options.health)
        .then((ok) => {
          if (!child.running || stopping || manual) {
            return;
          }
          failures = ok ? 0 : failures + 1;
          if (failures >= config.unhealthyThreshold) {
            failingHealth = true;
            clearMonitor();
            void child.stop();
          }
        })
        .catch(() => {
          if (!child.running || stopping || manual) {
            return;
          }
          if (++failures >= config.unhealthyThreshold) {
            failingHealth = true;
            clearMonitor();
            void child.stop();
          }
        })
        .finally(() => {
          pending = false;
        });
    }, config.healthIntervalMs);
    monitor.unref?.();
  };
  /** Own interruptible automatic-restart pacing; shutdown or a manual restart may wake it early.
   * @param {number} ms - Bounded backoff delay.
   * @returns {Promise<void>} Settles on timeout or explicit wake.
   */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      /** Owned backoff timer, cleared when the manager explicitly wakes pacing early. */
      const timer = setTimeout(() => {
        wakeDelay = undefined;
        resolve();
      }, ms);
      wakeDelay = () => {
        clearTimeout(timer);
        wakeDelay = undefined;
        resolve();
      };
    });
  update('starting', null);
  /** Initial child retained for loop startup and failure receipts; launch already verified readiness. */
  const first = await spawn();
  if (options.forwardSignals !== false) {
    process.on('SIGINT', onSignalInt);
    process.on('SIGTERM', onSignalTerm);
  }
  void (async () => {
    let child = first;
    let finalExit: ProcessExit = {
      code: null,
      signal: null,
      error: new Error('Application stopped'),
    };
    for (;;) {
      failingHealth = false;
      monitorHealth(child);
      /** Observed child terminal outcome, distinct from health-policy interpretation. */
      const result = await child.completed;
      clearMonitor();
      release();
      active = undefined;
      finalExit = failingHealth
        ? { ...result, error: new Error('Application failed health checks') }
        : result;
      lastExit = serializeExit(finalExit);
      if (stopping) {
        break;
      }
      if (manual) {
        update('restarting', null);
        try {
          child = await spawn();
          acceptManual();
          continue;
        } catch (error) {
          finalExit = {
            code: null,
            signal: null,
            error: error instanceof Error ? error : new Error(String(error)),
          };
          rejectManual(finalExit.error!);
          break;
        }
      }
      if (
        config.restartPolicy === 'never' ||
        (config.restartPolicy === 'on-failure' && exitStatus(finalExit) === 0)
      ) {
        break;
      }
      /** Wall-clock accounting observation used to expire automatic restart attempts. */
      const now = Date.now();
      while (
        restartTimes.length &&
        restartTimes[0]! <= now - config.restartWindowMs
      ) {
        restartTimes.shift();
      }
      if (restartTimes.length >= config.maxRestarts) {
        finalExit = {
          ...finalExit,
          error: new Error(
            `Restart budget exhausted (${config.maxRestarts} in ${config.restartWindowMs}ms)`
          ),
        };
        break;
      }
      /** One-based automatic attempt ordinal within the current sliding window. */
      const attempt = restartTimes.length + 1;
      restartTimes.push(now);
      automaticRestarts++;
      /** Capped exponential delay for the accounted automatic attempt. */
      const backoff = Math.min(
        config.maxRestartDelayMs,
        config.restartDelayMs * 2 ** Math.min(attempt - 1, 16)
      );
      update('restarting', null);
      try {
        onRestart?.(attempt, backoff, finalExit);
      } catch (error) {
        console.error('Restart notification failed:', error);
      }
      await pause(backoff);
      if (stopping) {
        break;
      }
      if (manual) {
        try {
          child = await spawn();
          acceptManual();
          continue;
        } catch (error) {
          finalExit = {
            code: null,
            signal: null,
            error: error instanceof Error ? error : new Error(String(error)),
          };
          rejectManual(finalExit.error!);
          break;
        }
      }
      try {
        child = await spawn();
        // A manual restart requested during readiness takes precedence.
        if (manual && child.running) {
          void child.stop();
        }
      } catch (error) {
        finalExit = {
          code: null,
          signal: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
        // Failed launches consume the same automatic restart budget.
        child = {
          child: first.child,
          completed: Promise.resolve(finalExit),
          running: false,
          stop: async () => finalExit,
        };
      }
    }
    finish(finalExit);
  })().catch((error) =>
    finish({
      code: null,
      signal: null,
      error: error instanceof Error ? error : new Error(String(error)),
    })
  );
  return handle;
}
