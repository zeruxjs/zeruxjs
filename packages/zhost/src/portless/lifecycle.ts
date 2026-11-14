import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** Versioned native creation identity; marker possession alone is not host authorization. */
export interface ProcessMarker {
  /** Supported ownership-marker schema version. */
  version: 1;
  /** Native process identifier; only identity comparison proves the recorded creation instance. */
  pid: number;
  /** Host-clock marker creation time; age alone never authorizes takeover. */
  startedAt: number;
  /** Native OS process creation fingerprint, not a client-supplied principal. */
  identity: string;
  /** Random 128-bit marker nonce; not a substitute for filesystem and endpoint authorization. */
  nonce: string;
}

/** Parse a legacy positive bare PID for diagnostics only; it never establishes process ownership.
 * @param {string} value - Untrusted marker text.
 * @returns {number | null} Safe integer greater than one or null.
 */
export function parsePid(value: string): number | null {
  /** Whitespace-trimmed diagnostic PID text before strict decimal syntax checks. */
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null;
  }
  /** Decimal legacy PID validated as a safe integer greater than one. */
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

/** Probe native PID existence with signal zero, treating permission denial as existence rather than death.
 * @param {number} pid - Host-selected native PID; callers validate positive ownership markers first.
 * @returns {boolean} Whether the PID exists or is inaccessible; this is not an identity proof.
 */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read a native creation fingerprint using fixed OS tools/proc fields after numeric PID validation; unsupported/unavailable identity returns null.
 * @param {number} pid - Safe integer PID greater than one.
 * @param {NodeJS.Platform} platform - Explicit supported OS selector; fixed native probes never execute caller-supplied source.
 * @returns {string | null} Platform-tagged creation identity or null; no shell is invoked and no header is trusted.
 */
export function processIdentityForPlatform(
  pid: number,
  platform: NodeJS.Platform
): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return null;
  }
  try {
    if (platform === 'darwin') {
      /** Native fixed-tool output or unknown parsed JSON; each use validates its specific shape. */
      const value = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 4096,
      }).trim();
      return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/.test(value) &&
        Number.isFinite(Date.parse(value))
        ? `darwin:${new Date(value).toISOString()}`
        : null;
    }
    if (platform === 'win32') {
      /** Fixed PowerShell CIM query interpolating only the already validated numeric PID; never request/model source. */
      const script = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop).CreationDate.ToUniversalTime().ToString('o')`;
      /** Native fixed-tool output or unknown parsed JSON; each use validates its specific shape. */
      const value = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 3000, maxBuffer: 4096 }
      ).trim();
      return /^\d{4}-\d{2}-\d{2}T/.test(value) &&
        Number.isFinite(Date.parse(value))
        ? `win32:${new Date(value).toISOString()}`
        : null;
    }
    if (platform !== 'linux') {
      return null;
    }
    /** Native Linux proc stat text for the explicit host-selected PID. */
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    /** Last process-name closing parenthesis, allowing spaces/parentheses inside comm. */
    const close = stat.lastIndexOf(')');
    if (close < 0) {
      return null;
    }
    /** Proc fields after comm; start-time position remains relative to the documented stat layout. */
    const fields = stat
      .slice(close + 2)
      .trim()
      .split(/\s+/);
    /** Optional proc start tick, accepted only as a decimal integer. */
    const start = fields[19];
    return start && /^\d+$/.test(start) ? `linux:${start}` : null;
  } catch {
    return null;
  }
}

/** Read this host platform’s process creation fingerprint; Linux uses boot-relative stat start ticks.
 * @param {number} pid - Host-authorized native PID selected independently of untrusted request metadata.
 * @returns {string | null} Native creation fingerprint or null for absent/unavailable/unsupported state.
 */
export function processIdentity(pid: number): string | null {
  return processIdentityForPlatform(pid, process.platform);
}

/** Create a versioned process ownership marker only when a native creation fingerprint can be read.
 * @param {number} pid - Host-owned PID, default this process.
 * @returns {ProcessMarker} Native identity and random nonce; no process is created or signalled.
 */
export function createProcessMarker(pid = process.pid): ProcessMarker {
  /** Readable native creation fingerprint required before marker creation. */
  const identity = processIdentity(pid);
  if (!identity) {
    throw new Error('Cannot safely identify proxy process on this platform');
  }
  return {
    version: 1,
    pid,
    startedAt: Date.now(),
    identity,
    nonce: randomBytes(16).toString('hex'),
  };
}

/** Validate the supported inert versioned marker shape without probing or signalling its PID.
 * @param {string} raw - Unknown persisted JSON text.
 * @returns {ProcessMarker | null} Validated supported marker or null; callers still recheck its current native identity.
 */
export function parseProcessMarker(raw: string): ProcessMarker | null {
  try {
    /** Native fixed-tool output or unknown parsed JSON; each use validates its specific shape. */
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') {
      return null;
    }
    /** Unknown parsed marker narrowed only through explicit fixed-field checks. */
    const x = value as Partial<ProcessMarker>;
    if (
      x.version !== 1 ||
      !Number.isSafeInteger(x.pid) ||
      (x.pid ?? 0) <= 1 ||
      !Number.isSafeInteger(x.startedAt) ||
      (x.startedAt ?? 0) <= 0 ||
      typeof x.identity !== 'string' ||
      !/^(linux:\d+|darwin:\d{4}-\d{2}-\d{2}T[\d:.]+Z|win32:\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/.test(
        x.identity
      ) ||
      typeof x.nonce !== 'string' ||
      !/^[a-f0-9]{32}$/.test(x.nonce)
    ) {
      return null;
    }
    return x as ProcessMarker;
  } catch {
    return null;
  }
}

/** Compare a recorded creation fingerprint against current native PID identity immediately before a privileged operation.
 * @param {ProcessMarker} marker - Previously parsed host-owned marker.
 * @returns {boolean} True only for a matching readable identity; numeric PID existence alone is insufficient.
 */
export function markerMatchesProcess(marker: ProcessMarker): boolean {
  return processIdentity(marker.pid) === marker.identity;
}

/** Atomically replace a marker through exclusive private same-directory staging; the host owns directory/operation-lock policy.
 * @param {string} filename - Fixed marker path in a host-controlled namespace.
 * @param {ProcessMarker} marker - Trusted validated ownership marker, not caller JSON.
 * @returns {void} Publishes complete JSON by rename; temporary cleanup failures are explicit.
 */
export function writeProcessMarker(
  filename: string,
  marker: ProcessMarker
): void {
  /** Exclusive private same-directory marker staging filename. */
  const temp = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temp, JSON.stringify(marker) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temp, filename);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
        throw error;
      }
    }
  }
}

/** Delete only a marker whose current text exactly matches the previously observed value; callers separately hold the required operation lock.
 * @param {string} filename - Trusted fixed marker path.
 * @param {string} expected - Exact previously read marker bytes represented as UTF-8.
 * @returns {boolean} Whether matching bytes were removed; false for absence or changed contents.
 */
export function removeOwnedMarker(filename: string, expected: string): boolean {
  try {
    if (fs.readFileSync(filename, 'utf8') !== expected) {
      return false;
    }
    fs.unlinkSync(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** After host authorization, recheck native identity across endpoint verification before sending SIGTERM; never signal this process or an unverifiable replacement PID.
 * @param {string} filename - Fixed host-owned private process marker path.
 * @param {() => Promise<boolean>} verifyEndpoint - Trusted asynchronous endpoint verifier required before signalling.
 * @param {{ waitMs?: number; pollMs?: number }} options - Finite native termination wait/poll policy; timeout never escalates to an arbitrary kill.
 * @param {number | undefined} options.waitMs - Finite native TERM observation grace period; no arbitrary process takeover.
 * @param {number | undefined} options.pollMs - Bounded positive native identity poll delay in milliseconds.
 * @returns {Promise<'stopped' | 'stale' | 'missing' | 'unverified' | 'timeout'>} Explicit outcome; timeout retains ownership evidence and does not imply forced termination.
 */
export async function stopMarkedProcess(
  filename: string,
  verifyEndpoint: () => Promise<boolean>,
  options: { waitMs?: number; pollMs?: number } = {}
): Promise<'stopped' | 'stale' | 'missing' | 'unverified' | 'timeout'> {
  let raw: string;
  try {
    raw = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
  /** Validated maximum SIGTERM observation wait in milliseconds. */
  const waitMs = options.waitMs ?? 10_000;
  /** Validated maximum identity-poll delay in milliseconds. */
  const pollMs = options.pollMs ?? 100;
  if (
    !Number.isSafeInteger(waitMs) ||
    waitMs < 0 ||
    waitMs > 300_000 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1 ||
    pollMs > 60_000
  ) {
    throw new RangeError('Invalid shutdown wait interval');
  }
  /** Parsed host-owned marker; endpoint verification and fresh native identity are still required. */
  const marker = parseProcessMarker(raw);
  if (!marker || marker.pid === process.pid) {
    return 'unverified';
  }
  if (!processExists(marker.pid) || !markerMatchesProcess(marker)) {
    removeOwnedMarker(filename, raw);
    return 'stale';
  }
  if (!(await verifyEndpoint())) {
    return 'unverified';
  }
  // Recheck identity after asynchronous endpoint verification to prevent PID reuse.
  if (!markerMatchesProcess(marker)) {
    return 'unverified';
  }
  try {
    process.kill(marker.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }
  /** Local shutdown observation cutoff; exceeding it never grants broader signal authority. */
  const deadline = Date.now() + waitMs;
  while (markerMatchesProcess(marker) && Date.now() < deadline) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now())))
    );
  }
  if (markerMatchesProcess(marker)) {
    return 'timeout';
  }
  removeOwnedMarker(filename, raw);
  return 'stopped';
}
