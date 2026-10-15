/** Crash-recovery records for rolling wrappers. Never use PID alone as proof of
 * ownership: every recorded child and controller needs its OS start identity.
 * This file is private local state, not an authorization mechanism. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ensureControlDirectory, readControlDescriptor, validateControlName } from './local-control.js';
import { processExists, processIdentity } from './lifecycle.js';
import { withOperationLock } from './operation-lock.js';
import { RouteStore } from './routes.js';

export interface TrackedGeneration { pid: number; identity: string; port: number; }
export interface GenerationRecord {
  version: 1;
  hostname: string;
  owner: { pid: number; identity: string; nonce: string };
  children: TrackedGeneration[];
  leaseId: string | null;
  updatedAt: string;
}
export interface RecoveryReport {
  hostname: string;
  recovered: boolean;
  terminated: number[];
  alreadyExited: number[];
  routeRemoved: boolean;
  dryRun?: boolean;
  wouldTerminate?: number[];
}
const MAX_BYTES = 16384;
const LEASE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FINGERPRINT = /^(linux:\d+|darwin:\d{4}-\d{2}-\d{2}T[\d:.]+Z|win32:\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/;
const validPid = (pid: unknown): pid is number => Number.isSafeInteger(pid) && (pid as number) > 1;
const isGone = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function generationRecordPath(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(ensureControlDirectory(stateDir), `${createHash('sha256').update(hostname).digest('hex')}.generations.json`);
}
function validateRecord(record: unknown, hostname: string): record is GenerationRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as GenerationRecord;
  return r.version === 1 && r.hostname === hostname && !!r.owner && validPid(r.owner.pid) &&
    typeof r.owner.identity === 'string' && FINGERPRINT.test(r.owner.identity) &&
    typeof r.owner.nonce === 'string' && /^[a-f0-9]{32}$/.test(r.owner.nonce) &&
    (r.leaseId === null || (typeof r.leaseId === 'string' && LEASE.test(r.leaseId))) &&
    typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt)) &&
    Array.isArray(r.children) && r.children.length <= 32 &&
    new Set(r.children.map(child => child.pid)).size === r.children.length &&
    r.children.every(c => validPid(c.pid) && c.pid !== r.owner.pid &&
      typeof c.identity === 'string' && FINGERPRINT.test(c.identity) &&
      Number.isSafeInteger(c.port) && c.port >= 1 && c.port <= 65535);
}
function assertPrivate(file: string): void {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.size > MAX_BYTES ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
    throw new Error('Unsafe rolling generation record');
  }
}
export function readGenerationRecord(stateDir: string, hostname: string): GenerationRecord | null {
  try {
    const file = generationRecordPath(stateDir, hostname);
    assertPrivate(file);
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validateRecord(parsed, hostname)) throw new Error('Malformed rolling generation record');
    return parsed;
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}
function atomicWrite(file: string, value: GenerationRecord): void {
  const payload = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error('Rolling generation record exceeds size limit');
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { assertPrivate(file); } catch (error) { if (!isGone(error)) throw error; }
    fs.renameSync(tmp, file);
    try { const fd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* Unsupported on some filesystems. */ }
  } finally { try { fs.unlinkSync(tmp); } catch (error) { if (!isGone(error)) throw error; } }
}
/** Delete only if contents and inode are still the observed record. */
function deleteUnchanged(file: string, expectedNonce: string): boolean {
  try {
    const before = fs.lstatSync(file);
    assertPrivate(file);
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as GenerationRecord;
    if (value.owner?.nonce !== expectedNonce) return false;
    const after = fs.lstatSync(file);
    if (before.ino !== after.ino || before.dev !== after.dev) return false;
    fs.unlinkSync(file);
    return true;
  } catch (error) { if (isGone(error)) return false; throw error; }
}
export function createGenerationRegistry(stateDir: string, hostname: string) {
  ensureControlDirectory(stateDir, true);
  const file = generationRecordPath(stateDir, hostname);
  const previous = readGenerationRecord(stateDir, hostname);
  if (previous) throw new Error('Previous rolling generation record requires recovery');
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error('Cannot identify rolling controller process');
  const record: GenerationRecord = { version: 1, hostname, owner: {
    pid: process.pid, identity, nonce: randomBytes(16).toString('hex')
  }, children: [], leaseId: null, updatedAt: new Date().toISOString() };
  let closed = false;
  const save = () => {
    if (closed) return;
    record.updatedAt = new Date().toISOString(); atomicWrite(file, record);
  };
  save();
  return {
    track(pid: number, port: number) {
      if (!validPid(pid) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid child process');
      const identity = processIdentity(pid);
      if (!identity) throw new Error(`Cannot identify rolling child ${pid}`);
      if (record.children.length >= 32) throw new Error('Too many recorded generations');
      record.children.push({ pid, port, identity }); save();
    },
    untrack(pid: number) {
      const previous = record.children;
      record.children = record.children.filter(child => child.pid !== pid);
      try { save(); } catch (error) { record.children = previous; throw error; }
    },
    lease(leaseId: string) {
      if (!LEASE.test(leaseId)) throw new Error('Invalid route lease');
      record.leaseId = leaseId; save();
    },
    close() {
      if (record.children.some(child => processIdentity(child.pid) === child.identity)) {
        throw new Error('Cannot remove recovery record while tracked children remain');
      }
      closed = true;
      return deleteUnchanged(file, record.owner.nonce);
    },
    get snapshot(): GenerationRecord { return structuredClone(record); },
  };
}

/** Never signal an unverified PID. On POSIX, a detached group is signalled only
 * while its original leader still matches the stored creation fingerprint. */
function isZombie(pid: number): boolean {
  if (process.platform !== 'linux') return false;
  try { const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return /^Z\s/.test(raw.slice(raw.lastIndexOf(')') + 2)); }
  catch { return false; }
}
function isSameRunning(child: TrackedGeneration): boolean {
  return !isZombie(child.pid) && processIdentity(child.pid) === child.identity;
}
async function terminateIdentified(child: TrackedGeneration, waitMs: number): Promise<'terminated' | 'gone'> {
  const identity = processIdentity(child.pid);
  if (!processExists(child.pid) || isZombie(child.pid) || (identity !== null && identity !== child.identity)) return 'gone';
  if (identity !== child.identity) throw new Error(`Cannot verify orphan child ${child.pid}; manual inspection required`);
  const signal = (name: NodeJS.Signals) => {
    if (processIdentity(child.pid) !== child.identity) return;
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  signal('SIGTERM');
  const deadline = Date.now() + waitMs;
  while (isSameRunning(child) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(75, Math.max(1, deadline - Date.now()))));
  }
  if (isSameRunning(child)) {
    signal('SIGKILL');
    const hardDeadline = Date.now() + 2_000;
    while (isSameRunning(child) && Date.now() < hardDeadline) {
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
  if (isSameRunning(child)) throw new Error(`Orphan child ${child.pid} could not be terminated`);
  return 'terminated';
}

/** Caller must serialize this with startup using the *same* control-directory lock. */
export async function recoverRollingGenerations(stateDir: string, hostname: string, options: { waitMs?: number; dryRun?: boolean } = {}): Promise<RecoveryReport> {
  const waitMs = options.waitMs ?? 5_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60_000) throw new RangeError('Invalid recovery timeout');
  const report: RecoveryReport = { hostname, recovered: false, terminated: [], alreadyExited: [], routeRemoved: false };
  const record = readGenerationRecord(stateDir, hostname);
  if (!record) return report;
  const descriptor = readControlDescriptor(stateDir, hostname);
  if (descriptor) {
    const controllerIdentity = processIdentity(descriptor.pid);
    if (controllerIdentity === descriptor.identity) throw new Error('Rolling controller is still running');
    if (controllerIdentity === null && processExists(descriptor.pid)) {
      throw new Error('Control descriptor owner is unverifiable; refusing recovery');
    }
  }
  const ownerIdentity = processIdentity(record.owner.pid);
  if (ownerIdentity === record.owner.identity) throw new Error('Rolling owner is still running; refusing recovery');
  if (ownerIdentity === null && processExists(record.owner.pid)) throw new Error('Rolling owner identity unavailable; refusing recovery');
  // Preflight every child before signalling any; never partially clean an
  // unidentifiable set and claim success.
  for (const child of record.children) {
    if (processExists(child.pid) && processIdentity(child.pid) === null) {
      throw new Error(`Unverifiable orphan child ${child.pid}; manual inspection required`);
    }
  }
  if (options.dryRun) {
    report.dryRun = true;
    report.wouldTerminate = record.children.filter(isSameRunning).map(child => child.pid);
    report.alreadyExited = record.children.filter(child => !isSameRunning(child)).map(child => child.pid);
    return report;
  }
  for (const child of record.children) {
    const result = await terminateIdentified(child, waitMs);
    (result === 'terminated' ? report.terminated : report.alreadyExited).push(child.pid);
  }
  if (record.leaseId) report.routeRemoved = new RouteStore(stateDir).removeRouteIfOwned(hostname, record.leaseId);
  if (!deleteUnchanged(generationRecordPath(stateDir, hostname), record.owner.nonce)) throw new Error('Rolling generation record changed during recovery');
  report.recovered = true;
  return report;
}
export function recoverRollingGenerationsLocked(stateDir: string, hostname: string, options?: { waitMs?: number; dryRun?: boolean }) {
  return withOperationLock(ensureControlDirectory(stateDir, true), () => recoverRollingGenerations(stateDir, hostname, options));
}
