import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export interface ProcessMarker {
  version: 1;
  pid: number;
  startedAt: number;
  identity: string;
  nonce: string;
}

/** Legacy bare PIDs are accepted for inspection, never as proof of identity. */
export function parsePid(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Obtain an OS-specific process creation fingerprint. Fail closed if it is unavailable.
 * macOS uses ps lstart; Windows uses CIM CreationDate. We never execute a shell.
 */
export function processIdentityForPlatform(pid: number, platform: NodeJS.Platform): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    if (platform === 'darwin') {
      const value = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 }).trim();
      return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/.test(value) && Number.isFinite(Date.parse(value)) ? `darwin:${new Date(value).toISOString()}` : null;
    }
    if (platform === 'win32') {
      const script = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop).CreationDate.ToUniversalTime().ToString('o')`;
      const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 3000, maxBuffer: 4096 }).trim();
      return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? `win32:${new Date(value).toISOString()}` : null;
    }
    if (platform !== 'linux') return null;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const start = fields[19];
    return start && /^\d+$/.test(start) ? `linux:${start}` : null;
  } catch { return null; }
}

/** On Linux, /proc/<pid>/stat field 22 is a boot-relative process start tick. */
export function processIdentity(pid: number): string | null {
  return processIdentityForPlatform(pid, process.platform);
}

export function createProcessMarker(pid = process.pid): ProcessMarker {
  const identity = processIdentity(pid);
  if (!identity) throw new Error('Cannot safely identify proxy process on this platform');
  return { version: 1, pid, startedAt: Date.now(), identity, nonce: randomBytes(16).toString('hex') };
}

export function parseProcessMarker(raw: string): ProcessMarker | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const x = value as Partial<ProcessMarker>;
    if (x.version !== 1 || !Number.isSafeInteger(x.pid) || (x.pid ?? 0) <= 1 ||
        !Number.isSafeInteger(x.startedAt) || (x.startedAt ?? 0) <= 0 ||
        typeof x.identity !== 'string' || !(/^(linux:\d+|darwin:\d{4}-\d{2}-\d{2}T[\d:.]+Z|win32:\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/.test(x.identity)) ||
        typeof x.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(x.nonce)) return null;
    return x as ProcessMarker;
  } catch { return null; }
}

export function markerMatchesProcess(marker: ProcessMarker): boolean {
  return processIdentity(marker.pid) === marker.identity;
}

/** Atomic marker replacement prevents observing half-written JSON. */
export function writeProcessMarker(filename: string, marker: ProcessMarker): void {
  const temp = path.join(path.dirname(filename), `.${path.basename(filename)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(marker) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, filename);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** Only delete a marker whose contents still match the observed value. */
export function removeOwnedMarker(filename: string, expected: string): boolean {
  try {
    if (fs.readFileSync(filename, 'utf8') !== expected) return false;
    fs.unlinkSync(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Stop only an identified process; never signal an unverifiable or replaced PID. */
export async function stopMarkedProcess(
  filename: string,
  verifyEndpoint: () => Promise<boolean>,
  options: { waitMs?: number; pollMs?: number } = {}
): Promise<'stopped' | 'stale' | 'missing' | 'unverified' | 'timeout'> {
  let raw: string;
  try { raw = fs.readFileSync(filename, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  const waitMs = options.waitMs ?? 10_000;
  const pollMs = options.pollMs ?? 100;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 300_000 || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 60_000) throw new RangeError('Invalid shutdown wait interval');
  const marker = parseProcessMarker(raw);
  if (!marker || marker.pid === process.pid) return 'unverified';
  if (!processExists(marker.pid) || !markerMatchesProcess(marker)) {
    removeOwnedMarker(filename, raw);
    return 'stale';
  }
  if (!(await verifyEndpoint())) return 'unverified';
  // Recheck identity after asynchronous endpoint verification to prevent PID reuse.
  if (!markerMatchesProcess(marker)) return 'unverified';
  try { process.kill(marker.pid, 'SIGTERM'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + waitMs;
  while (markerMatchesProcess(marker) && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  if (markerMatchesProcess(marker)) return 'timeout';
  removeOwnedMarker(filename, raw);
  return 'stopped';
}
