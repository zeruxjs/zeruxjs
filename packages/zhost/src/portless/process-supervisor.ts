/** Reliable direct-exec child supervision for local application servers.
 * No command string is passed through a shell, and listeners are released on exit.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  probeApplicationHealth,
  validateHealthCheck,
  type HealthCheckOptions,
} from './health.js';

export interface ProcessExit {
  /** Native numeric exit code, or null for signal/spawn failure. */
  code: number | null;
  /** Native terminating signal, or null when unavailable. */
  signal: NodeJS.Signals | null;
  /** Private native spawn failure retained for the host, not serialized into public status. */
  error?: Error;
}
export interface SupervisorOptions {
  /** Host-controlled child environment overrides; never browser configuration. */
  env?: NodeJS.ProcessEnv;
  /** Trusted child working directory. */
  cwd?: string;
  /** Optional application readiness port, checked for an already occupied listener before spawning. */
  port?: number;
  /** Readiness deadline for a TCP listener, milliseconds; ignored if port is unset. */
  readyTimeoutMs?: number;
  /** Deadline to give the child for graceful termination before SIGKILL. */
  shutdownTimeoutMs?: number;
  /** Called exactly once when the child exits or fails to spawn. */
  onExit?: (result: ProcessExit) => void;
  /** Called immediately after spawn, before readiness, to persist child identity. */
  onSpawn?: (child: ChildProcess) => void;
  /** Explicit child stdio mode; defaults to inheriting the host streams. */
  stdio?: 'inherit' | 'ignore' | 'pipe';
  /** Install SIGINT/SIGTERM forwarding from this process (default true). */
  forwardSignals?: boolean;
  /** Use an HTTP endpoint for readiness instead of only testing an open TCP port. */
  health?: HealthCheckOptions;
}
export interface SupervisedProcess {
  /** Owned native child process; not an existing user-managed process. */
  readonly child: ChildProcess;
  /** Observed terminal process outcome shared by stop and startup monitoring. */
  readonly completed: Promise<ProcessExit>;
  /** Current supervisor state, false after the first terminal observation. */
  readonly running: boolean;
  /** Share one shutdown operation, signal gracefully, escalate after the deadline and await the observed process outcome.
   * @param {NodeJS.Signals} signal - Initial termination signal, defaulting to SIGTERM.
   * @returns {Promise<ProcessExit>} Shared terminal outcome; escalation does not imply arbitrary JavaScript force-cancellation.
   */
  stop(signal?: NodeJS.Signals): Promise<ProcessExit>;
}

/** Conventional shell exit statuses for the explicitly recognized termination signals. */
const SIGNAL_EXIT: Record<string, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGKILL: 137,
};
/** Map an observed process outcome to a CLI exit status without losing a reported numeric exit code.
 * @param {ProcessExit} result - Observed exit, signal or spawn error.
 * @returns {number} One for errors/unknown signals, conventional status for known signals, or the child exit code.
 */
export function exitStatus(result: ProcessExit): number {
  if (result.error) {
    return 1;
  }
  if (result.signal) {
    return SIGNAL_EXIT[result.signal] ?? 1;
  }
  return result.code ?? 1;
}

/** Apply a default and validate a positive integer deadline before acquiring a child process.
 * @param {number | undefined} value - Optional caller deadline in milliseconds.
 * @param {number} fallback - Default deadline used when the option is absent.
 * @param {number} max - Inclusive maximum deadline.
 * @param {string} label - Option label included in validation errors.
 * @returns {number} Validated deadline in milliseconds.
 */
function boundedMs(
  value: number | undefined,
  fallback: number,
  max: number,
  label: string
): number {
  /** Deadline candidate validated before process or timer acquisition. */
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new RangeError(`${label} must be an integer between 1 and ${max}`);
  }
  return n;
}
/** Reject invalid application TCP ports before probing or spawning.
 * @param {number} port - Requested integer application port.
 * @returns {void} Throws unless port is in the inclusive range 1–65535.
 */
export function validateAppPort(port: number): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('Application port must be an integer from 1 to 65535');
  }
}

/** Own one short-lived IPv4 loopback socket and destroy it after the first readiness outcome.
 * @param {number} port - Validated application TCP port.
 * @param {number} timeoutMs - Socket timeout in milliseconds, defaulting to 250.
 * @returns {Promise<boolean>} True on connect; false on refusal, timeout or socket close.
 */
export function canConnect(port: number, timeoutMs = 250): Promise<boolean> {
  validateAppPort(port);
  return new Promise((resolve) => {
    /** Owned loopback readiness socket, destroyed on its first terminal event. */
    const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    /** Resolve a socket probe once and destroy its native handle.
     * @param {boolean} connected - Whether the loopback connection succeeded.
     * @returns {void} Ignores subsequent socket events.
     */
    const settle = (connected: boolean) => {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.once('close', () => settle(false));
  });
}

/** Find existing node_modules/.bin directories from the trusted working directory up to its filesystem root.
 * @param {string} cwd - Host-controlled working directory.
 * @returns {string[]} Nearest-first local executable directories; no packages are loaded or executed.
 */
function resolveBins(cwd: string): string[] {
  /** Existing local executable directories collected from the nearest project outward. */
  const bins: string[] = [];
  let dir = path.resolve(cwd);
  while (true) {
    /** Candidate node_modules/.bin directory; existence alone does not execute anything. */
    const bin = path.join(dir, 'node_modules', '.bin');
    if (fs.existsSync(bin)) {
      bins.push(bin);
    }
    /** Parent directory used to stop traversal at the filesystem root. */
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return bins;
}

/** Copy host environment and explicit overrides, prepending local executable directories for direct child execution.
 * @param {string} cwd - Trusted working directory used to locate node_modules/.bin.
 * @param {NodeJS.ProcessEnv} overrides - Explicit host environment overrides; values may contain secrets and must not be logged.
 * @returns {NodeJS.ProcessEnv} Detached child environment; does not mutate process.env.
 */
export function childEnvironment(
  cwd: string,
  overrides?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  /** Detached host environment plus explicit overrides; private values stay out of diagnostics. */
  const env = { ...process.env, ...overrides };
  /** Original platform PATH before adding local command directories. */
  const basePath = env.PATH ?? env.Path ?? '';
  /** Existing local executable directories collected from the nearest project outward. */
  const bins = resolveBins(cwd);
  if (bins.length) {
    env.PATH = `${bins.join(path.delimiter)}${path.delimiter}${basePath}`;
  }
  return env;
}

/** Own a short bounded readiness-poll timer.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Resolves when the timer elapses; no command is replayed.
 */
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Directly execute a trusted host command and optionally await local readiness; failure stops the owned child before rejecting.
 * @param {readonly string[]} argv - Nonempty trusted command and argument tokens; never supplied by untrusted request data.
 * @param {SupervisorOptions} options - Child environment, lifecycle callbacks, readiness policy and signal ownership.
 * @returns {Promise<SupervisedProcess>} Owned process handle; call stop and await its result during teardown.
 */
export async function launchSupervisedCommand(
  argv: readonly string[],
  options: SupervisorOptions = {}
): Promise<SupervisedProcess> {
  if (
    !argv.length ||
    argv.some((arg) => typeof arg !== 'string' || !arg || arg.includes('\0'))
  ) {
    throw new TypeError('A command and nonempty string arguments are required');
  }
  /** Resolved trusted working directory for child startup and executable resolution. */
  const cwd = path.resolve(options.cwd ?? process.cwd());
  /** Validated maximum startup-readiness wait in milliseconds. */
  const readyMs = boundedMs(
    options.readyTimeoutMs,
    15_000,
    300_000,
    'readyTimeoutMs'
  );
  /** Validated graceful-termination wait before escalation. */
  const stopMs = boundedMs(
    options.shutdownTimeoutMs,
    5_000,
    120_000,
    'shutdownTimeoutMs'
  );
  if (options.health) {
    if (options.port === undefined) {
      throw new Error('HTTP health checks require an application port');
    }
    validateHealthCheck(options.health);
  }
  if (options.port !== undefined) {
    validateAppPort(options.port);
    if (await canConnect(options.port)) {
      throw new Error(
        `Application port ${options.port} is already accepting connections`
      );
    }
  }

  /** Owned direct-exec child; argument validation proves its executable token exists. */
  const child = spawn(argv[0]!, argv.slice(1), {
    cwd,
    env: childEnvironment(cwd, options.env),
    shell: false,
    stdio: options.stdio ?? 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let running = true;
  let stopPromise: Promise<ProcessExit> | undefined;
  let finalExit: ProcessExit | undefined;
  let resolveExit!: (result: ProcessExit) => void;
  /** Shared terminal promise resolved once by native error or close observation. */
  const completed = new Promise<ProcessExit>((resolve) => {
    resolveExit = resolve;
  });
  /** Forward host SIGINT only to this owned child shutdown path.
   * @returns {void} Starts or reuses the shared stop operation.
   */
  const onSigInt = () => {
    void stop('SIGINT');
  };
  /** Forward host SIGTERM only to this owned child shutdown path.
   * @returns {void} Starts or reuses the shared stop operation.
   */
  const onSigTerm = () => {
    void stop('SIGTERM');
  };
  /** Remove only this supervisor’s process signal listeners.
   * @returns {void} Leaves unrelated host listeners untouched.
   */
  const dispose = () => {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
  };
  /** Record the first native terminal outcome, release forwarding listeners and isolate the host exit callback.
   * @param {ProcessExit} result - Observed child exit or spawn error.
   * @returns {void} Ignores duplicate terminal events.
   */
  const finish = (result: ProcessExit) => {
    if (!running) {
      return;
    }
    running = false;
    finalExit = result;
    dispose();
    resolveExit(result);
    try {
      options.onExit?.(result);
    } catch (error) {
      console.error('Application exit callback failed:', error);
    }
  };
  child.once('error', (error) => finish({ code: null, signal: null, error }));
  child.once('close', (code, signal) => finish({ code, signal }));
  if (options.forwardSignals !== false) {
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);
  }

  /** Signal only this owned child or its detached POSIX group, tolerating an already exited process.
   * @param {NodeJS.Signals} signal - Host-selected termination signal.
   * @returns {void} Logs unexpected signaling failures without changing process ownership.
   */
  function sendSignal(signal: NodeJS.Signals): void {
    try {
      // POSIX process groups ensure `npm run dev` grandchildren also receive the
      // signal. Never target the current process group: spawn uses detached=true.
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.error('Failed to signal child:', error);
      }
    }
  }

  /** Share one shutdown operation, signal gracefully, escalate after the deadline and await the observed process outcome.
   * @param {NodeJS.Signals} signal - Initial termination signal, defaulting to SIGTERM.
   * @returns {Promise<ProcessExit>} Shared terminal outcome; escalation does not imply arbitrary JavaScript force-cancellation.
   */
  function stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<ProcessExit> {
    if (stopPromise) {
      return stopPromise;
    }
    if (!running) {
      return completed;
    }
    stopPromise = (async () => {
      sendSignal(signal);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      /** Owned graceful-stop deadline raced against the child’s actual observed terminal outcome. */
      const timed = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, stopMs);
        timeout.unref?.();
      });
      await Promise.race([completed, timed]);
      if (timeout) {
        clearTimeout(timeout);
      }
      if (running) {
        sendSignal('SIGKILL');
      }
      return await completed;
    })();
    return stopPromise;
  }
  /** Public owned-process handle; callers must stop it during application teardown. */
  const handle: SupervisedProcess = {
    child,
    completed,
    get running() {
      return running;
    },
    stop,
  };
  try {
    options.onSpawn?.(child);
  } catch (error) {
    await handle.stop();
    throw error;
  }

  // Even without a readiness port, ensure spawn errors on the next event-loop
  // turn are observed before reporting that the command launched successfully.
  if (options.port === undefined) {
    await Promise.race([delay(20), completed]);
    if (!running) {
      /** Observed terminal outcome retained before cleanup so original spawn/exit errors survive. */
      const result = finalExit!;
      if (result.error) {
        throw result.error;
      }
      throw new Error(`Command exited before startup (${exitStatus(result)})`);
    }
    return handle;
  }

  /** Absolute readiness deadline used to bound repeated loopback probes. */
  const deadline = Date.now() + readyMs;
  while (running && Date.now() < deadline) {
    if (await probeApplicationHealth(options.port, options.health)) {
      if (running) {
        return handle;
      }
      break;
    }
    await Promise.race([
      delay(Math.min(100, Math.max(1, deadline - Date.now()))),
      completed,
    ]);
  }
  /** Observed terminal outcome retained before cleanup so original spawn/exit errors survive. */
  const result = finalExit;
  if (running) {
    await stop();
  }
  if (result?.error) {
    throw result.error;
  }
  if (result) {
    throw new Error(
      `Application exited before listening on port ${options.port} (exit ${exitStatus(result)})`
    );
  }
  throw new Error(
    `Application did not listen on port ${options.port} within ${readyMs}ms`
  );
}
