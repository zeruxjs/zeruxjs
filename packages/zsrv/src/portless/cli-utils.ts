import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { execSync, spawn } from "node:child_process";
import { PORTLESS_HEADER } from "./proxy.js";
import { readCommittedProxyState, PendingStartupTransactionError } from "./committed-state.js";
import { recoverInterruptedStartup } from "./startup-state.js";
import { withOperationLock } from "./operation-lock.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** True when running on Windows. */
export const isWindows = process.platform === "win32";

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
export const SYSTEM_STATE_DIR = isWindows ? path.join(os.tmpdir(), "portless") : "/tmp/portless";

/** Per-user state directory (used when proxy runs without sudo). */
export const USER_STATE_DIR = path.join(os.homedir(), ".portless");

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

/**
 * Return the effective default proxy port. Reads the PORTLESS_PORT env var
 * first, falling back to DEFAULT_PROXY_PORT (1355).
 */
export function getDefaultPort(): number {
  const envPort = process.env.PORTLESS_PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) return port;
  }
  return DEFAULT_PROXY_PORT;
}

// ---------------------------------------------------------------------------
// State directory resolution
// ---------------------------------------------------------------------------

/**
 * Determine the state directory for a given proxy port.
 * On Unix, privileged ports (< 1024) use the system dir so both root and
 * non-root processes can share state. Unprivileged ports use the user's
 * home directory (~/.portless). On Windows, always use the user dir
 * (no privileged port concept).
 */
export function resolveStateDir(port: number): string {
  if (process.env.PORTLESS_STATE_DIR) return process.env.PORTLESS_STATE_DIR;
  if (isWindows) return USER_STATE_DIR;
  return port < PRIVILEGED_PORT_THRESHOLD ? SYSTEM_STATE_DIR : USER_STATE_DIR;
}

/** Read the proxy port from a given state directory. Returns null if unreadable. */
export function readPortFromDir(dir: string): number | null {
  return readCommittedProxyState(dir)?.port ?? null;
}

/** Name of the marker file that indicates the proxy is running with TLS. */
const TLS_MARKER_FILE = "proxy.tls";

/** Read the TLS marker from a state directory. */
export function readTlsMarker(dir: string): boolean {
  return readCommittedProxyState(dir)?.tls ?? false;
}

/** Write or remove the TLS marker in the state directory. */
export function writeTlsMarker(dir: string, enabled: boolean): void {
  const markerPath = path.join(dir, TLS_MARKER_FILE);
  if (enabled) {
    fs.writeFileSync(markerPath, "1", { mode: 0o644 });
  } else {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  }
}

/** Default TLD when PORTLESS_TLD is not set. */
export const DEFAULT_TLD = "localhost";

/** TLDs that work but have known pitfalls worth warning about. */
export const RISKY_TLDS = new Map<string, string>([
  ["local", "conflicts with mDNS/Bonjour on macOS"],
  ["dev", "Google-owned; browsers force HTTPS via preloaded HSTS"],
  ["com", "public TLD -- DNS requests will leak to the internet"],
  ["org", "public TLD -- DNS requests will leak to the internet"],
  ["net", "public TLD -- DNS requests will leak to the internet"],
  ["io", "public TLD -- DNS requests will leak to the internet"],
  ["app", "public TLD -- DNS requests will leak to the internet"],
  ["edu", "public TLD -- DNS requests will leak to the internet"],
  ["gov", "public TLD -- DNS requests will leak to the internet"],
  ["mil", "public TLD -- DNS requests will leak to the internet"],
  ["int", "public TLD -- DNS requests will leak to the internet"],
]);

/**
 * Validate a TLD string. Returns an error message if invalid, or null if OK.
 * Does not check for risky TLDs (those produce warnings, not errors).
 */
export function validateTld(tld: string): string | null {
  if (!tld) return "TLD cannot be empty";
  if (!/^[a-z0-9]+$/.test(tld)) {
    return `Invalid TLD "${tld}": must contain only lowercase letters and digits`;
  }
  return null;
}

/** Name of the file that stores the proxy's active TLD. */
const TLD_FILE = "proxy.tld";

/** Read the TLD from a state directory. Returns DEFAULT_TLD if absent. */
export function readTldFromDir(dir: string): string {
  return readCommittedProxyState(dir)?.tld ?? DEFAULT_TLD;
}

/** Write or remove the TLD file in the state directory. */
export function writeTldFile(dir: string, tld: string): void {
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

/**
 * Return the effective TLD. Reads the PORTLESS_TLD env var first,
 * falling back to DEFAULT_TLD ("localhost"). Throws on invalid values.
 */
export function getDefaultTld(): string {
  const val = process.env.PORTLESS_TLD?.trim().toLowerCase();
  if (!val) return DEFAULT_TLD;
  const err = validateTld(val);
  if (err) throw new Error(`PORTLESS_TLD: ${err}`);
  return val;
}

/**
 * Return whether HTTPS mode is requested via the PORTLESS_HTTPS env var.
 */
export function isHttpsEnvEnabled(): boolean {
  const val = process.env.PORTLESS_HTTPS;
  return val === "1" || val === "true";
}

/**
 * Discover the active proxy's state directory, port, TLS mode, and TLD.
 * Checks the user-level dir first, then the system-level dir.
 * Falls back to the system dir with the default port if nothing is running.
 */
export async function discoverState(): Promise<{
  dir: string;
  port: number;
  tls: boolean;
  tld: string;
}> {
  // Env var override
  if (process.env.PORTLESS_STATE_DIR) {
    const dir = process.env.PORTLESS_STATE_DIR;
    const state = readCommittedProxyState(dir);
    return { dir, port: state?.port ?? getDefaultPort(), tls: state?.tls ?? false, tld: state?.tld ?? getDefaultTld() };
  }

  // Check user-level state first (~/.portless)
  const userState = readCommittedProxyState(USER_STATE_DIR);
  if (userState) {
    const userPort = userState.port;
    // Always use plain HTTP for the liveness check. The TLS-enabled proxy
    // accepts plain HTTP via byte-peeking, so this works for both modes and
    // avoids TLS handshake timeouts that can cause false negatives.
    if (await isProxyRunning(userPort)) {
      return { dir: USER_STATE_DIR, port: userPort, tls: userState.tls, tld: userState.tld };
    }
  }

  // Check system-level state (/tmp/portless)
  const systemState = readCommittedProxyState(SYSTEM_STATE_DIR);
  if (systemState) {
    const systemPort = systemState.port;
    if (await isProxyRunning(systemPort)) {
      return { dir: SYSTEM_STATE_DIR, port: systemPort, tls: systemState.tls, tld: systemState.tld };
    }
  }

  // State files didn't help. Probe well-known ports as a last resort --
  // privileged-port proxies store state in /tmp which macOS cleans on reboot,
  // so the daemon may still be alive after the port file is gone.
  const defaultPort = getDefaultPort();
  const probePorts = new Set([defaultPort, 443, 80]);
  for (const port of probePorts) {
    if (await isProxyRunning(port)) {
      const dir = resolveStateDir(port);
      const state = readCommittedProxyState(dir);
      return { dir, port: state?.port ?? port, tls: state?.tls ?? false, tld: state?.tld ?? getDefaultTld() };
    }
  }

  return { dir: resolveStateDir(defaultPort), port: defaultPort, tls: false, tld: getDefaultTld() };
}

/** Recover an interrupted startup only while holding that directory's
 * operation lock, then retry discovery. This is used for lifecycle commands;
 * ordinary read accessors deliberately remain read-only and fail closed.
 */
export async function discoverStateWithRecovery(): ReturnType<typeof discoverState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await discoverState(); }
    catch (error) {
      if (!(error instanceof PendingStartupTransactionError)) throw error;
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

/**
 * Find a free port in the given range (default 4000-4999).
 * Tries random ports first for speed, then falls back to sequential scan.
 *
 * Note: There is an inherent TOCTOU race between verifying a port is free
 * and the child process actually binding to it. The random-first strategy
 * minimizes the window.
 */
export async function findFreePort(
  minPort = MIN_APP_PORT,
  maxPort = MAX_APP_PORT
): Promise<number> {
  if (minPort > maxPort) {
    throw new Error(`minPort (${minPort}) must be <= maxPort (${maxPort})`);
  }

  const tryPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on("error", () => resolve(false));
    });
  };

  // Try random ports first
  for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
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

/**
 * Check if a portless proxy is listening on the given port at 127.0.0.1.
 * Makes an HTTP(S) request and verifies the X-Portless response header to
 * distinguish the portless proxy from unrelated services.
 *
 * When `tls` is true, uses HTTPS with certificate verification disabled
 * (the proxy may use a self-signed or locally-trusted CA cert).
 */
export function isProxyRunning(port: number, tls = false): Promise<boolean> {
  return new Promise((resolve) => {
    const requestFn = tls ? https.request : http.request;
    const req = requestFn(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "HEAD",
        timeout: SOCKET_TIMEOUT_MS,
        ...(tls ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        res.resume();
        resolve(res.headers[PORTLESS_HEADER.toLowerCase()] === "1");
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Process utilities
// ---------------------------------------------------------------------------

/**
 * Parse the PID of a process listening on a given port from netstat output.
 * Exported for testing.
 */
export function parsePidFromNetstat(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    // Format: TCP  0.0.0.0:PORT  0.0.0.0:0  LISTENING  PID
    if (parts.length < 5) continue;
    const localAddr = parts[1];
    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) continue;
    const addrPort = parseInt(localAddr.substring(lastColon + 1), 10);
    if (addrPort === port) {
      const pid = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(pid) && pid > 0) return pid;
    }
  }
  return null;
}

/**
 * Try to find the PID of a process listening on the given TCP port.
 * Uses lsof on macOS/Linux and netstat on Windows.
 * Returns null if the PID cannot be determined.
 */
export function findPidOnPort(port: number): number | null {
  try {
    if (isWindows) {
      const output = execSync("netstat -ano -p tcp", {
        encoding: "utf-8",
        timeout: PID_LOOKUP_TIMEOUT_MS,
      });
      return parsePidFromNetstat(output, port);
    }

    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf-8",
      timeout: PID_LOOKUP_TIMEOUT_MS,
    });
    // lsof may return multiple PIDs (one per line); take the first
    const pid = parseInt(output.trim().split("\n")[0], 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Poll until the proxy is listening or the timeout is reached.
 * Returns true if the proxy became ready, false on timeout.
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
export function spawnCommand(
  commandArgs: string[],
  options?: { env?: NodeJS.ProcessEnv; onCleanup?: () => void }
): void {
  void launchSupervisedCommand(commandArgs, {
    env: options?.env,
    onExit: result => {
      try { options?.onCleanup?.(); } finally { process.exitCode = exitStatus(result); }
    },
  }).catch(error => {
    console.error(`Failed to run command: ${error instanceof Error ? error.message : String(error)}`);
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
const FRAMEWORKS_NEEDING_PORT: Record<string, { strictPort: boolean }> = {
  vite: { strictPort: true },
  "react-router": { strictPort: true },
  astro: { strictPort: false },
  ng: { strictPort: false },
  "react-native": { strictPort: false },
  expo: { strictPort: false },
};

/**
 * Check if `commandArgs` invokes a framework that ignores `PORT` and, if so,
 * mutate the array in-place to append the correct CLI flags so the app
 * listens on the expected port and address.
 *
 * The portless proxy connects to 127.0.0.1 (IPv4), so we also inject
 * `--host 127.0.0.1` to prevent frameworks from binding to IPv6 `::1`.
 */
export function injectFrameworkFlags(commandArgs: string[], port: number): void {
  const cmd = commandArgs[0];
  if (!cmd) return;

  const basename = path.basename(cmd);
  const framework = FRAMEWORKS_NEEDING_PORT[basename];
  if (!framework) return;

  if (!commandArgs.includes("--port")) {
    commandArgs.push("--port", port.toString());
    if (framework.strictPort) {
      commandArgs.push("--strictPort");
    }
  }

  if (!commandArgs.includes("--host")) {
    const hostValue = basename === "expo" ? "localhost" : "127.0.0.1";
    commandArgs.push("--host", hostValue);
  }
}

/**
 * Prompt the user for input via readline. Returns empty string if stdin closes.
 */
export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.on("close", () => resolve(""));
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}
