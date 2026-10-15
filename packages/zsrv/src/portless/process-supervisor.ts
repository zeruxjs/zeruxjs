/** Reliable direct-exec child supervision for local application servers.
 * No command string is passed through a shell, and listeners are released on exit.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { probeApplicationHealth, validateHealthCheck, type HealthCheckOptions } from './health.js';

export interface ProcessExit { code: number | null; signal: NodeJS.Signals | null; error?: Error }
export interface SupervisorOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  port?: number;
  /** Readiness deadline for a TCP listener, milliseconds; ignored if port is unset. */
  readyTimeoutMs?: number;
  /** Deadline to give the child for graceful termination before SIGKILL. */
  shutdownTimeoutMs?: number;
  /** Called exactly once when the child exits or fails to spawn. */
  onExit?: (result: ProcessExit) => void;
  /** Called immediately after spawn, before readiness, to persist child identity. */
  onSpawn?: (child: ChildProcess) => void;
  stdio?: 'inherit' | 'ignore' | 'pipe';
  /** Install SIGINT/SIGTERM forwarding from this process (default true). */
  forwardSignals?: boolean;
  /** Use an HTTP endpoint for readiness instead of only testing an open TCP port. */
  health?: HealthCheckOptions;
}
export interface SupervisedProcess {
  readonly child: ChildProcess;
  readonly completed: Promise<ProcessExit>;
  readonly running: boolean;
  stop(signal?: NodeJS.Signals): Promise<ProcessExit>;
}

const SIGNAL_EXIT: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
export function exitStatus(result: ProcessExit): number {
  return result.error ? 1 : result.signal ? (SIGNAL_EXIT[result.signal] ?? 1) : (result.code ?? 1);
}

function boundedMs(value: number | undefined, fallback: number, max: number, label: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError(`${label} must be an integer between 1 and ${max}`);
  return n;
}
export function validateAppPort(port: number): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new RangeError('Application port must be an integer from 1 to 65535');
}

/** Probe 127.0.0.1 only; connect immediately returns false for connection refusal. */
export function canConnect(port: number, timeoutMs = 250): Promise<boolean> {
  validateAppPort(port);
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const settle = (connected: boolean) => {
      if (done) return;
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

function resolveBins(cwd: string): string[] {
  const bins: string[] = [];
  let dir = path.resolve(cwd);
  while (true) {
    const bin = path.join(dir, 'node_modules', '.bin');
    if (fs.existsSync(bin)) bins.push(bin);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return bins;
}

export function childEnvironment(cwd: string, overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  const basePath = env.PATH ?? env.Path ?? '';
  const bins = resolveBins(cwd);
  if (bins.length) env.PATH = `${bins.join(path.delimiter)}${path.delimiter}${basePath}`;
  return env;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Launch and optionally wait until the app starts accepting TCP connections.
 * Rejects on spawn failure, premature exit, an already-bound port or timeout.
 * A failed readiness check terminates and reaps the child before rejecting.
 */
export async function launchSupervisedCommand(argv: readonly string[], options: SupervisorOptions = {}): Promise<SupervisedProcess> {
  if (!argv.length || argv.some(arg => typeof arg !== 'string' || !arg || arg.includes('\0'))) {
    throw new TypeError('A command and nonempty string arguments are required');
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const readyMs = boundedMs(options.readyTimeoutMs, 15_000, 300_000, 'readyTimeoutMs');
  const stopMs = boundedMs(options.shutdownTimeoutMs, 5_000, 120_000, 'shutdownTimeoutMs');
  if (options.health) {
    if (options.port === undefined) throw new Error('HTTP health checks require an application port');
    validateHealthCheck(options.health);
  }
  if (options.port !== undefined) {
    validateAppPort(options.port);
    if (await canConnect(options.port)) throw new Error(`Application port ${options.port} is already accepting connections`);
  }

  const child = spawn(argv[0], argv.slice(1), {
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
  const completed = new Promise<ProcessExit>(resolve => { resolveExit = resolve; });
  const onSigInt = () => { void stop('SIGINT'); };
  const onSigTerm = () => { void stop('SIGTERM'); };
  const dispose = () => {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
  };
  const finish = (result: ProcessExit) => {
    if (!running) return;
    running = false;
    finalExit = result;
    dispose();
    resolveExit(result);
    try { options.onExit?.(result); }
    catch (error) { console.error('Application exit callback failed:', error); }
  };
  child.once('error', error => finish({ code: null, signal: null, error }));
  child.once('close', (code, signal) => finish({ code, signal }));
  if (options.forwardSignals !== false) {
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);
  }

  function sendSignal(signal: NodeJS.Signals): void {
    try {
      // POSIX process groups ensure `npm run dev` grandchildren also receive the
      // signal. Never target the current process group: spawn uses detached=true.
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error('Failed to signal child:', error);
    }
  }

  function stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<ProcessExit> {
    if (stopPromise) return stopPromise;
    if (!running) return completed;
    stopPromise = (async () => {
      sendSignal(signal);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timed = new Promise<void>(resolve => {
        timeout = setTimeout(resolve, stopMs);
        timeout.unref?.();
      });
      await Promise.race([completed, timed]);
      if (timeout) clearTimeout(timeout);
      if (running) {
        sendSignal('SIGKILL');
      }
      return await completed;
    })();
    return stopPromise;
  }
  const handle: SupervisedProcess = {
    child,
    completed,
    get running() { return running; },
    stop,
  };
  try { options.onSpawn?.(child); }
  catch (error) { await handle.stop(); throw error; }

  // Even without a readiness port, ensure spawn errors on the next event-loop
  // turn are observed before reporting that the command launched successfully.
  if (options.port === undefined) {
    await Promise.race([delay(20), completed]);
    if (!running) {
      const result = finalExit!;
      if (result.error) throw result.error;
      throw new Error(`Command exited before startup (${exitStatus(result)})`);
    }
    return handle;
  }

  const deadline = Date.now() + readyMs;
  while (running && Date.now() < deadline) {
    if (await probeApplicationHealth(options.port, options.health)) {
      if (running) return handle;
      break;
    }
    await Promise.race([delay(Math.min(100, Math.max(1, deadline - Date.now()))), completed]);
  }
  const result = finalExit;
  if (running) await stop();
  if (result?.error) throw result.error;
  if (result) throw new Error(`Application exited before listening on port ${options.port} (exit ${exitStatus(result)})`);
  throw new Error(`Application did not listen on port ${options.port} within ${readyMs}ms`);
}
