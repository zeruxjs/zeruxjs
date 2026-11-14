import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { PORTLESS_HEADER } from './proxy.js';
import {
  readCommittedProxyState,
  PendingStartupTransactionError,
} from './committed-state.js';
import { recoverInterruptedStartup } from './startup-state.js';
import { withOperationLock } from './operation-lock.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** True when running on Windows. */
export const isWindows = process.platform === 'win32';

/** Default proxy port. Uses an unprivileged port so sudo is not required. */
export const DEFAULT_PROXY_PORT = 1355;

/** Preferred HTTPS proxy port for clean localhost URLs. */
export const DEFAULT_HTTPS_PROXY_PORT = 443;

/** Ports below this threshold require root/sudo to bind (Unix only). */
export const PRIVILEGED_PORT_THRESHOLD = 1024;

/**
 * System-wide state directory (used when proxy needs sudo on Unix).
 * Hardcoded to /tmp/portless rather than os.tmpdir() because macOS returns
 * a per-user dir from os.tmpdir() (/var/folders/...) while sudo (root)
 * gets /tmp -- causing the proxy writer and client reader to disagree.
 */
export const SYSTEM_STATE_DIR = isWindows
  ? path.join(os.tmpdir(), 'portless')
  : '/tmp/portless';

/** Per-user state directory (used when proxy runs without sudo). */
export const USER_STATE_DIR = path.join(os.homedir(), '.portless');

/** Minimum app port when finding a free port. */
const MIN_APP_PORT = 4000;

/** Maximum app port when finding a free port. */
const MAX_APP_PORT = 4999;

/** Number of random port attempts before sequential scan. */
const RANDOM_PORT_ATTEMPTS = 50;

/** TCP connect timeout (ms) when checking if something is listening. */
const SOCKET_TIMEOUT_MS = 500;

/** Timeout (ms) for PID lookup when finding a process on a port. */
const PID_LOOKUP_TIMEOUT_MS = 5000;

/** Maximum poll attempts when waiting for the proxy to become ready. */
export const WAIT_FOR_PROXY_MAX_ATTEMPTS = 20;

/** Interval (ms) between proxy readiness polls. */
export const WAIT_FOR_PROXY_INTERVAL_MS = 250;

/** Signal name to signal number mapping for exit code calculation. */
export const SIGNAL_CODES: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGABRT: 6,
  SIGKILL: 9,
  SIGTERM: 15,
};

// ---------------------------------------------------------------------------
// Port configuration
// ---------------------------------------------------------------------------

/** Retain the legacy PORTLESS_PORT parseInt compatibility, falling back to the unprivileged default when outside the TCP range.
 * @returns {number} Observed effective default; strict CLI token validation remains in dedicated parsers.
 */
export function getDefaultPort(): number {
  /** Explicit host environment port text, retaining legacy parseInt conversion. */
  const envPort = process.env.PORTLESS_PORT;
  if (envPort) {
    /** Candidate local port or observed private-state port; no remote destination is accepted. */
    const port = parseInt(envPort, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      return port;
    }
  }
  return DEFAULT_PROXY_PORT;
}

// ---------------------------------------------------------------------------
// State directory resolution
// ---------------------------------------------------------------------------

/** Resolve explicit host state configuration or the existing user/shared path policy without creating directories.
 * @param {number} port - Host-selected proxy listener port.
 * @returns {string} Configured state path; not a filesystem sandbox or management permission.
 */
export function resolveStateDir(port: number): string {
  if (process.env.PORTLESS_STATE_DIR) {
    return process.env.PORTLESS_STATE_DIR;
  }
  if (isWindows) {
    return USER_STATE_DIR;
  }
  return port < PRIVILEGED_PORT_THRESHOLD ? SYSTEM_STATE_DIR : USER_STATE_DIR;
}

/** Read the authoritative/consistent legacy port view without recovering or mutating a pending startup.
 * @param {string} dir - Trusted state root.
 * @returns {number | null} Recorded port or null when absent; corruption/pending-transaction failures propagate.
 */
export function readPortFromDir(dir: string): number | null {
  return readCommittedProxyState(dir)?.port ?? null;
}

/** Name of the marker file that indicates the proxy is running with TLS. */
const TLS_MARKER_FILE = 'proxy.tls';

/** Read TLS mode through the authoritative consistent state view, not an independently mixed compatibility file.
 * @param {string} dir - Trusted state root.
 * @returns {boolean} Recorded TLS flag, or false for no state; inconsistent state throws.
 */
export function readTlsMarker(dir: string): boolean {
  return readCommittedProxyState(dir)?.tls ?? false;
}

/** Explicit legacy compatibility-file writer; coordinated startup publication uses its owning transaction instead.
 * @param {string} dir - Trusted host state root.
 * @param {boolean} enabled - Whether to write the retained TLS compatibility marker.
 * @returns {void} Writes the marker or attempts its removal; removal failures keep the existing nonthrowing behavior.
 */
export function writeTlsMarker(dir: string, enabled: boolean): void {
  /** Fixed legacy TLS compatibility leaf beneath the trusted state root. */
  const markerPath = path.join(dir, TLS_MARKER_FILE);
  if (enabled) {
    fs.writeFileSync(markerPath, '1', { mode: 0o644 });
  } else {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  }
}

/** Default TLD when PORTLESS_TLD is not set. */
export const DEFAULT_TLD = 'localhost';

/** TLDs that work but have known pitfalls worth warning about. */
export const RISKY_TLDS = new Map<string, string>([
  ['local', 'conflicts with mDNS/Bonjour on macOS'],
  ['dev', 'Google-owned; browsers force HTTPS via preloaded HSTS'],
  ['com', 'public TLD -- DNS requests will leak to the internet'],
  ['org', 'public TLD -- DNS requests will leak to the internet'],
  ['net', 'public TLD -- DNS requests will leak to the internet'],
  ['io', 'public TLD -- DNS requests will leak to the internet'],
  ['app', 'public TLD -- DNS requests will leak to the internet'],
  ['edu', 'public TLD -- DNS requests will leak to the internet'],
  ['gov', 'public TLD -- DNS requests will leak to the internet'],
  ['mil', 'public TLD -- DNS requests will leak to the internet'],
  ['int', 'public TLD -- DNS requests will leak to the internet'],
]);

/** Apply the existing lexical lowercase-alphanumeric suffix check; stricter DNS/record length limits remain with their owners.
 * @param {string} tld - Host-supplied suffix candidate.
 * @returns {string | null} Fixed validation text for invalid input, or null; risky suffixes are advisory elsewhere.
 */
export function validateTld(tld: string): string | null {
  if (!tld) {
    return 'TLD cannot be empty';
  }
  if (!/^[a-z0-9]+$/.test(tld)) {
    return `Invalid TLD "${tld}": must contain only lowercase letters and digits`;
  }
  return null;
}

/** Name of the file that stores the proxy's active TLD. */
const TLD_FILE = 'proxy.tld';

/** Read the authoritative suffix view without recovering a pending journal.
 * @param {string} dir - Trusted state root.
 * @returns {string} Recorded suffix or the retained localhost default when absent; corrupt state rejects.
 */
export function readTldFromDir(dir: string): string {
  return readCommittedProxyState(dir)?.tld ?? DEFAULT_TLD;
}

/** Explicit legacy compatibility writer/remover; callers own suffix validation and coordinated publication policy.
 * @param {string} dir - Trusted host state root.
 * @param {string} tld - Host-validated suffix, with the default represented by absence.
 * @returns {void} Writes a nondefault suffix; removal retains legacy best-effort semantics.
 */
export function writeTldFile(dir: string, tld: string): void {
  /** Fixed legacy suffix compatibility leaf beneath the trusted state root. */
  const filePath = path.join(dir, TLD_FILE);
  if (tld === DEFAULT_TLD) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may already be absent; non-fatal
    }
  } else {
    fs.writeFileSync(filePath, tld, { mode: 0o644 });
  }
}

/** Normalize explicit host environment suffix configuration and reject the existing invalid lexical forms.
 * @returns {string} Lowercase explicit suffix or localhost; no DNS resolution or provider lookup occurs.
 */
export function getDefaultTld(): string {
  /** Explicit host environment policy value, normalized only by its owning getter. */
  const val = process.env.PORTLESS_TLD?.trim().toLowerCase();
  if (!val) {
    return DEFAULT_TLD;
  }
  /** Existing lexical suffix validation error, not native/private state. */
  const err = validateTld(val);
  if (err) {
    throw new Error(`PORTLESS_TLD: ${err}`);
  }
  return val;
}

/** Interpret only the existing explicit environment values that enable HTTPS.
 * @returns {boolean} True for 1 or true, false otherwise; does not install certificates or change trust.
 */
export function isHttpsEnvEnabled(): boolean {
  /** Explicit host environment policy value, normalized only by its owning getter. */
  const val = process.env.PORTLESS_HTTPS;
  return val === '1' || val === 'true';
}

/** Read consistent proxy state and fixed loopback liveness evidence in the existing explicit/user/shared/fallback order.
 * @returns {Promise<{dir: string; port: number; tls: boolean; tld: string}>} Observed configuration or a default proposal; liveness headers alone never authorize process signaling.
 */
export async function discoverState(): Promise<{
  dir: string;
  port: number;
  tls: boolean;
  tld: string;
}> {
  // Env var override
  if (process.env.PORTLESS_STATE_DIR) {
    /** Host-selected explicit or discovered state root; read access does not grant management authority. */
    const dir = process.env.PORTLESS_STATE_DIR;
    /** One authoritative consistent state observation; never mix independent compatibility reads. */
    const state = readCommittedProxyState(dir);
    return {
      dir,
      port: state?.port ?? getDefaultPort(),
      tls: state?.tls ?? false,
      tld: state?.tld ?? getDefaultTld(),
    };
  }

  // Check user-level state first (~/.portless)
  /** User-level consistent state candidate, checked before shared/fallback discovery. */
  const userState = readCommittedProxyState(USER_STATE_DIR);
  if (userState) {
    /** Recorded user-level candidate port for fixed loopback liveness only. */
    const userPort = userState.port;
    // Always use plain HTTP for the liveness check. The TLS-enabled proxy
    // accepts plain HTTP via byte-peeking, so this works for both modes and
    // avoids TLS handshake timeouts that can cause false negatives.
    if (await isProxyRunning(userPort)) {
      return {
        dir: USER_STATE_DIR,
        port: userPort,
        tls: userState.tls,
        tld: userState.tld,
      };
    }
  }

  // Check system-level state (/tmp/portless)
  /** Shared consistent state candidate, not permission to manage another OS user’s process. */
  const systemState = readCommittedProxyState(SYSTEM_STATE_DIR);
  if (systemState) {
    /** Recorded shared candidate port for read-only loopback liveness. */
    const systemPort = systemState.port;
    if (await isProxyRunning(systemPort)) {
      return {
        dir: SYSTEM_STATE_DIR,
        port: systemPort,
        tls: systemState.tls,
        tld: systemState.tld,
      };
    }
  }

  // State files didn't help. Probe well-known ports as a last resort --
  // privileged-port proxies store state in /tmp which macOS cleans on reboot,
  // so the daemon may still be alive after the port file is gone.
  /** Existing explicit/default candidate used only when recorded state does not identify a live proxy. */
  const defaultPort = getDefaultPort();
  /** Small fixed deduplicated fallback port set, never arbitrary external hosts. */
  const probePorts = new Set([defaultPort, 443, 80]);
  for (const port of probePorts) {
    if (await isProxyRunning(port)) {
      /** Host-selected explicit or discovered state root; read access does not grant management authority. */
      const dir = resolveStateDir(port);
      /** One authoritative consistent state observation; never mix independent compatibility reads. */
      const state = readCommittedProxyState(dir);
      return {
        dir,
        port: state?.port ?? port,
        tls: state?.tls ?? false,
        tld: state?.tld ?? getDefaultTld(),
      };
    }
  }

  return {
    dir: resolveStateDir(defaultPort),
    port: defaultPort,
    tls: false,
    tld: getDefaultTld(),
  };
}

/** Retry only pending-startup discovery under its required per-directory operation lock, with a finite three-attempt cap.
 * @returns {ReturnType<typeof discoverState>} Consistent discovered state or a failure; ordinary read accessors remain nonmutating.
 */
export async function discoverStateWithRecovery(): ReturnType<
  typeof discoverState
> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await discoverState();
    } catch (error) {
      if (!(error instanceof PendingStartupTransactionError)) {
        throw error;
      }
      await withOperationLock(error.stateDir, async () => {
        recoverInterruptedStartup(error.stateDir);
      });
    }
  }
  // A concurrent writer kept replacing a journal; never guess active state.
  throw new Error('Proxy state remained unstable after recovery attempts');
}

// ---------------------------------------------------------------------------
// Port utilities
// ---------------------------------------------------------------------------

/** Probe trusted host-configured candidate ports, closing each successful reservation before returning; a later bind can still race.
 * @param {number} minPort - Host-validated lower candidate bound, defaulting to 4000.
 * @param {number} maxPort - Host-validated upper candidate bound, defaulting to 4999.
 * @returns {Promise<number>} Previously free candidate port, not a retained reservation or permission to stop another listener.
 */
export async function findFreePort(
  minPort = MIN_APP_PORT,
  maxPort = MAX_APP_PORT
): Promise<number> {
  if (minPort > maxPort) {
    throw new Error(`minPort (${minPort}) must be <= maxPort (${maxPort})`);
  }

  /** Own a temporary native listener to check a trusted candidate, closing it before admitting success.
   * @param {number} port - Host-configured candidate.
   * @returns {Promise<boolean>} Whether binding/close succeeded; no reservation is retained.
   */
  const tryPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      /** Owned temporary candidate listener, closed before successful port return. */
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  };

  // Try random ports first
  for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
    /** Candidate local port or observed private-state port; no remote destination is accepted. */
    const port = minPort + Math.floor(Math.random() * (maxPort - minPort + 1));
    if (await tryPort(port)) {
      return port;
    }
  }

  // Fall back to sequential
  for (let port = minPort; port <= maxPort; port++) {
    if (await tryPort(port)) {
      return port;
    }
  }

  throw new Error(`No free port found in range ${minPort}-${maxPort}`);
}

/** Probe fixed IPv4 loopback with HEAD and the compatibility marker, optionally verifying the configured local CA/hostname.
 * @param {number} port - Host-selected local listener port.
 * @param {boolean} tls - Whether to use verified HTTPS instead of plain HTTP, default false.
 * @returns {Promise<boolean>} Observed proxy-like liveness, false on transport/CA failure; not process-identity authorization.
 */
export function isProxyRunning(port: number, tls = false): Promise<boolean> {
  let secure: https.RequestOptions = {};
  if (tls) {
    try {
      // Public CA material configures local verification; it is not request payload.
      // The network destination stays fixed to loopback, independent of file data.
      /** Trusted CA state root for verified fixed-loopback HTTPS liveness. */
      const stateDir = resolveStateDir(port);
      /** One authoritative consistent state observation; never mix independent compatibility reads. */
      const state = readCommittedProxyState(stateDir);
      /** Owned local CA descriptor, closed on every native verification setup path. */
      const fd = fs.openSync(
        path.join(stateDir, 'ca.pem'),
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          fs.constants.O_NONBLOCK,
        0o600
      );
      try {
        /** Metadata from the opened CA inode, checked before allocating bounded bytes. */
        const info = fs.fstatSync(fd);
        if (!info.isFile() || info.size > 65536) {
          return Promise.resolve(false);
        }
        /** One-byte growth sentinel around the bounded local CA read. */
        const buffer = Buffer.alloc(info.size + 1);
        /** Actual bytes read from the same CA inode, rejecting observed growth. */
        const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (size > info.size) {
          return Promise.resolve(false);
        }
        secure = {
          ca: buffer.subarray(0, size),
          servername: state?.tld ?? DEFAULT_TLD,
        };
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise((resolve) => {
    /** Native HTTP or HTTPS request function selected only by host TLS policy. */
    const requestFn = tls ? https.request : http.request;
    /** Owned short-lived fixed-loopback HEAD request, destroyed on timeout. */
    const req = requestFn(
      {
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'HEAD',
        timeout: SOCKET_TIMEOUT_MS,
        ...secure,
      },
      (res) => {
        res.resume();
        resolve(res.headers[PORTLESS_HEADER.toLowerCase()] === '1');
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Process utilities
// ---------------------------------------------------------------------------

/** Parse supported LISTENING lines from inert native output without executing any line content.
 * @param {string} output - Read-only native listing text or synthetic fixture.
 * @param {number} port - Validated local TCP port to match.
 * @returns {number | null} First supported positive PID, or null; liveness/ownership must still be independently verified.
 */
export function parsePidFromNetstat(
  output: string,
  port: number
): number | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) {
      continue;
    }
    /** Whitespace fields from a supported native LISTENING line, length checked before indexing. */
    const parts = line.trim().split(/\s+/);
    // Format: TCP  0.0.0.0:PORT  0.0.0.0:0  LISTENING  PID
    if (parts.length < 5) {
      continue;
    }
    /** Required local-address field proven present by the five-field line guard. */
    const localAddr = parts[1]!;
    /** Final address delimiter, supporting native IPv6 display forms without evaluating text. */
    const lastColon = localAddr.lastIndexOf(':');
    if (lastColon === -1) {
      continue;
    }
    /** Parsed native local port compared only against the validated requested port. */
    const addrPort = parseInt(localAddr.substring(lastColon + 1), 10);
    if (addrPort === port) {
      /** Positive parsed native process identifier; never a process-ownership proof. */
      const pid = parseInt(parts[parts.length - 1]!, 10);
      if (!isNaN(pid) && pid > 0) {
        return pid;
      }
    }
  }
  return null;
}

/** Validate a primitive TCP port, then use fixed direct native argument arrays for diagnostic lookup; never interpolate a shell command.
 * @param {number} port - Integer TCP port from 1 to 65535; invalid runtime values return null before native execution.
 * @returns {number | null} Observed PID or null for invalid input/unavailable tools; this is never authority to signal that process.
 */
export function findPidOnPort(port: number): number | null {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  try {
    if (isWindows) {
      /** Read-only native tool stdout; lines are parsed as data, never commands. */
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
        encoding: 'utf-8',
        timeout: PID_LOOKUP_TIMEOUT_MS,
      });
      return parsePidFromNetstat(output, port);
    }

    /** Read-only native tool stdout; lines are parsed as data, never commands. */
    const output = execFileSync(
      'lsof',
      ['-ti', `tcp:${port}`, '-sTCP:LISTEN'],
      {
        encoding: 'utf-8',
        timeout: PID_LOOKUP_TIMEOUT_MS,
      }
    );
    // lsof may return multiple PIDs (one per line); take the first
    /** Positive parsed native process identifier; never a process-ownership proof. */
    const pid = parseInt(output.trim().split('\n')[0]!, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Pace a caller-controlled finite sequence of fixed loopback liveness probes; this helper does not extend ownership or stop unrelated services.
 * @param {number} port - Host-selected local proxy port.
 * @param {number} maxAttempts - Host-validated attempt count, defaulting to 20.
 * @param {number} intervalMs - Host-validated pacing delay in milliseconds, defaulting to 250.
 * @param {boolean} tls - Whether each probe verifies the configured local CA, default false.
 * @returns {Promise<boolean>} True on observed liveness, false after the supplied attempts; native probe time is additional to pacing.
 */
export async function waitForProxy(
  port: number,
  maxAttempts = WAIT_FOR_PROXY_MAX_ATTEMPTS,
  intervalMs = WAIT_FOR_PROXY_INTERVAL_MS,
  tls = false
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (await isProxyRunning(port, tls)) {
      return true;
    }
  }
  return false;
}

/** Compatibility wrapper for older applications. New callers should use
 * launchSupervisedCommand(), which reports readiness and exposes stop(). */
import { launchSupervisedCommand, exitStatus } from './process-supervisor.js';
/** Retain the legacy process-lifetime wrapper; scoped callers should retain launchSupervisedCommand’s explicit readiness/stop handle instead.
 * @param {string[]} commandArgs - Trusted direct-exec child command tokens, never model/request-supplied commands.
 * @param {{ env?: NodeJS.ProcessEnv; onCleanup?: () => void }} options - Optional trusted environment and terminal cleanup callback.
 * @param {NodeJS.ProcessEnv | undefined} options.env - Trusted private child environment overrides.
 * @param {(() => void) | undefined} options.onCleanup - Host terminal cleanup callback.
 * @returns {void} Observes native failure and sets process.exitCode; this compatibility API returns no scoped stop handle.
 */
export function spawnCommand(
  commandArgs: string[],
  options?: { env?: NodeJS.ProcessEnv; onCleanup?: () => void }
): void {
  void launchSupervisedCommand(commandArgs, {
    env: options?.env,
    onExit: (result) => {
      try {
        options?.onCleanup?.();
      } finally {
        process.exitCode = exitStatus(result);
      }
    },
  }).catch((error) => {
    console.error(
      `Failed to run command: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}

// ---------------------------------------------------------------------------
// Framework-aware flag injection
// ---------------------------------------------------------------------------

/**
 * Frameworks that ignore the `PORT` env var. Maps command basename to the
 * flags needed. `strictPort` indicates whether `--strictPort` is supported
 * (prevents the framework from silently picking a different port).
 *
 * SvelteKit is not listed because its dev server is Vite under the hood,
 * so the `vite` entry already covers it.
 */
const FRAMEWORKS_NEEDING_PORT: Record<
  string,
  {
    /** Whether the maintained executable compatibility table supports its strict-port flag. */
    strictPort: boolean;
  }
> = {
  vite: { strictPort: true },
  'react-router': { strictPort: true },
  astro: { strictPort: false },
  ng: { strictPort: false },
  'react-native': { strictPort: false },
  expo: { strictPort: false },
};

/** Append existing known framework CLI flags to an explicitly trusted argv array without executing it or changing unrelated child options.
 * @param {string[]} commandArgs - Host-owned mutable argv; only known executable basenames receive missing flags.
 * @param {number} port - Host-validated intended local application port.
 * @returns {void} Mutates the supplied array in place; does not certify every framework/version or start a server.
 */
export function injectFrameworkFlags(
  commandArgs: string[],
  port: number
): void {
  /** First trusted executable token; an empty argv remains a no-op for flag injection. */
  const cmd = commandArgs[0];
  if (!cmd) {
    return;
  }

  /** Trusted executable basename used for exact compatibility-table selection. */
  const basename = path.basename(cmd);
  /** Existing supported executable flag profile; unknown programs remain unchanged. */
  const framework = FRAMEWORKS_NEEDING_PORT[basename];
  if (!framework) {
    return;
  }

  if (!commandArgs.includes('--port')) {
    commandArgs.push('--port', port.toString());
    if (framework.strictPort) {
      commandArgs.push('--strictPort');
    }
  }

  if (!commandArgs.includes('--host')) {
    /** Existing explicit loopback host flag for this known executable. */
    const hostValue = basename === 'expo' ? 'localhost' : '127.0.0.1';
    commandArgs.push('--host', hostValue);
  }
}

/** Own one explicit terminal readline interaction, closing its interface after an answer or EOF.
 * @param {string} question - Trusted operator prompt text; never requested automatically by library imports.
 * @returns {Promise<string>} Existing trimmed/lowercase answer or empty-close result; no command is executed by this helper.
 */
export function prompt(question: string): Promise<string> {
  /** Owned terminal readline interface closed after the single interaction. */
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.on('close', () => resolve(''));
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}
