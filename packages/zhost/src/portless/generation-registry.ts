import { readStateFile } from './state-file.js';
/** Crash-recovery records for rolling wrappers. Never use PID alone as proof of
 * ownership: every recorded child and controller needs its OS start identity.
 * This file is private local state, not an authorization mechanism. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  ensureControlDirectory,
  readControlDescriptor,
  validateControlName,
} from './local-control.js';
import { processExists, processIdentity } from './lifecycle.js';
import { withOperationLock } from './operation-lock.js';
import { RouteStore } from './routes.js';

export interface TrackedGeneration {
  /** Native host-owned process identifier, meaningful only with its creation identity. */
  pid: number;
  /** Native OS creation fingerprint rechecked before signalling. */
  identity: string;
  /** Validated loopback backend port associated with this generation. */
  port: number;
}
export interface GenerationRecord {
  /** Supported private recovery-journal schema version. */
  version: 1;
  /** Exact authorized host route bound to this private journal. */
  hostname: string;
  /** Controller native identity and random nonce; filesystem possession alone is not host authorization. */
  owner: {
    /** Native host-owned process identifier, meaningful only with its creation identity. */
    pid: number;
    /** Native OS creation fingerprint rechecked before signalling. */
    identity: string;
    nonce: string;
  };
  /** Bounded unique-PID owned generation observations, at most thirty-two. */
  children: TrackedGeneration[];
  /** Conditional route-store lease UUID or null before publication. */
  leaseId: string | null;
  /** Host-clock ISO UTC journal update time; age never authorizes takeover. */
  updatedAt: string;
}
export interface RecoveryReport {
  /** Exact authorized host route bound to this private journal. */
  hostname: string;
  /** True only after complete requested recovery and journal removal. */
  recovered: boolean;
  /** Recorded owned PIDs observed terminated through this explicit operation. */
  terminated: number[];
  /** Recorded PIDs absent, zombies or replaced creation instances; not signalled. */
  alreadyExited: number[];
  /** Whether the exact recorded route lease was still owned and removed. */
  routeRemoved: boolean;
  /** True only for explicit read-only recovery preview. */
  dryRun?: boolean;
  /** Verified running recorded PIDs eligible for the requested preview. */
  wouldTerminate?: number[];
}
/** Maximum complete private generation journal bytes, 16 KiB. */
const MAX_BYTES = 16384;
/** Supported conditional route lease UUID syntax; possession alone grants no host permission. */
const LEASE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Supported native OS creation fingerprint formats. */
const FINGERPRINT =
  /^(linux:\d+|darwin:\d{4}-\d{2}-\d{2}T[\d:.]+Z|win32:\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/;
/** Check a positive native PID without coercing strings.
 * @param {unknown} pid Unknown persisted identifier.
 * @returns {boolean} Whether the candidate is a safe integer greater than one. */
const validPid = (pid: unknown): pid is number =>
  Number.isSafeInteger(pid) && (pid as number) > 1;
/** Recognize only missing-file errors; other native failures remain visible.
 * @param {unknown} error Native private cause.
 * @returns {boolean} Whether the native code is ENOENT. */
const isGone = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Derive the validated hashed private journal path using the existing verified control directory.
 * @param {string} stateDir - Host-owned private state directory; separately authorize any recovery operation.
 * @param {string} hostname - Validated exact host-authorized route name.
 * @returns {string} Fixed private journal filename; no arbitrary path or process is selected.
 */
export function generationRecordPath(
  stateDir: string,
  hostname: string
): string {
  validateControlName(hostname);
  return path.join(
    ensureControlDirectory(stateDir),
    `${createHash('sha256').update(hostname).digest('hex')}.generations.json`
  );
}
/** Validate the supported bounded immutable-identity journal shape before native process checks.
 * @param {unknown} record - Unknown parsed JSON snapshot.
 * @param {string} hostname - Expected exact route name.
 * @returns {boolean} Whether the V1 owner, unique child identities, lease and timestamp fields are supported.
 */
function validateRecord(
  record: unknown,
  hostname: string
): record is GenerationRecord {
  if (!record || typeof record !== 'object') {
    return false;
  }
  /** Unknown parsed object viewed as the supported shape only during complete fixed-field validation. */
  const r = record as GenerationRecord;
  return (
    r.version === 1 &&
    r.hostname === hostname &&
    !!r.owner &&
    validPid(r.owner.pid) &&
    typeof r.owner.identity === 'string' &&
    FINGERPRINT.test(r.owner.identity) &&
    typeof r.owner.nonce === 'string' &&
    /^[a-f0-9]{32}$/.test(r.owner.nonce) &&
    (r.leaseId === null ||
      (typeof r.leaseId === 'string' && LEASE.test(r.leaseId))) &&
    typeof r.updatedAt === 'string' &&
    Number.isFinite(Date.parse(r.updatedAt)) &&
    Array.isArray(r.children) &&
    r.children.length <= 32 &&
    new Set(r.children.map((child) => child.pid)).size === r.children.length &&
    r.children.every(
      (c) =>
        validPid(c.pid) &&
        c.pid !== r.owner.pid &&
        typeof c.identity === 'string' &&
        FINGERPRINT.test(c.identity) &&
        Number.isSafeInteger(c.port) &&
        c.port >= 1 &&
        c.port <= 65535
    )
  );
}
/** Require a bounded real owner-private journal file; no permissive or foreign-owned state is trusted.
 * @param {string} file - Trusted fixed journal path.
 * @param {fs.Stats} st - Previously opened same-inode metadata or a fresh final-file stat.
 * @returns {void} Throws on unsupported owner/mode/type/size metadata.
 */
function assertPrivate(file: string, st = fs.lstatSync(file)): void {
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    (st.mode & 0o077) !== 0 ||
    st.size > MAX_BYTES ||
    (typeof process.getuid === 'function' && st.uid !== process.getuid())
  ) {
    throw new Error('Unsafe rolling generation record');
  }
}
/** Read bounded no-follow private recovery bytes and validate all recorded ownership fields without signalling anything.
 * @param {string} stateDir - Host-owned private state directory; separately authorize any recovery operation.
 * @param {string} hostname - Expected authorized route name.
 * @returns {GenerationRecord | null} Validated journal or null only for absence; corruption fails closed.
 */
export function readGenerationRecord(
  stateDir: string,
  hostname: string
): GenerationRecord | null {
  try {
    /** Validated hashed journal path within the verified owner-private namespace. */
    const file = generationRecordPath(stateDir, hostname);
    /** Bounded no-follow file bytes/metadata from one native descriptor. */
    const opened = readStateFile(file, MAX_BYTES);
    assertPrivate(file, opened.stat);
    /** Unknown JSON staged for complete journal validation. */
    const parsed: unknown = JSON.parse(opened.bytes.toString('utf8'));
    if (!validateRecord(parsed, hostname)) {
      throw new Error('Malformed rolling generation record');
    }
    return parsed;
  } catch (error) {
    if (isGone(error)) {
      return null;
    }
    throw error;
  }
}
/** Atomically replace the bounded private journal through exclusive staging and file fsync; directory fsync is a best-effort platform compatibility step.
 * @param {string} file - Fixed journal path in the verified private namespace.
 * @param {GenerationRecord} value - Trusted bounded controller-owned record.
 * @returns {void} Commits rename or throws; temporary unlink failures remain visible.
 */
function atomicWrite(file: string, value: GenerationRecord): void {
  /** Complete bounded private recovery representation with one newline. */
  const payload = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(payload) > MAX_BYTES) {
    throw new Error('Rolling generation record exceeds size limit');
  }
  /** Exclusive private same-directory staging path. */
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    /** Owned file/directory descriptor, always closed after native sync. */
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      assertPrivate(file);
    } catch (error) {
      if (!isGone(error)) {
        throw error;
      }
    }
    fs.renameSync(tmp, file);
    try {
      /** Owned file/directory descriptor, always closed after native sync. */
      const fd = fs.openSync(path.dirname(file), 'r', 0o600);
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* Unsupported on some filesystems. */
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (error) {
      if (!isGone(error)) {
        // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
        throw error;
      }
    }
  }
}
/** Remove only an owner-private journal retaining the expected nonce and observed inode; callers separately serialize recovery with startup.
 * @param {string} file - Fixed private journal path.
 * @param {string} expectedNonce - Exact previously observed controller ownership nonce.
 * @returns {boolean} Whether the expected record was removed; false preserves absence or replaced ownership.
 */
function deleteUnchanged(file: string, expectedNonce: string): boolean {
  try {
    /** Same-inode journal metadata and bytes used for conditional owner removal. */
    const { stat: before, bytes } = readStateFile(file, MAX_BYTES);
    if (
      (before.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && before.uid !== process.getuid())
    ) {
      throw new Error('Unsafe generation record');
    }
    /** Parsed owner-bearing journal checked for the expected nonce before removal. */
    const value = JSON.parse(bytes.toString('utf8')) as GenerationRecord;
    if (value.owner?.nonce !== expectedNonce) {
      return false;
    }
    /** Current native inode/device compared before deleting recorded ownership. */
    const after = fs.lstatSync(file);
    if (before.ino !== after.ino || before.dev !== after.dev) {
      return false;
    }
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (isGone(error)) {
      return false;
    }
    throw error;
  }
}
/** Acquire a new private controller recovery journal, refusing any prior journal until explicit trusted recovery; no child is launched by this factory.
 * @param {string} stateDir - Host-owned private state directory; separately authorize any recovery operation.
 * @param {string} hostname - Validated host-authorized route name.
 * @returns {object} Owned synchronous journal callbacks; stop/untrack children before close removes recovery evidence.
 */
export function createGenerationRegistry(stateDir: string, hostname: string) {
  ensureControlDirectory(stateDir, true);
  /** Validated hashed journal path within the verified owner-private namespace. */
  const file = generationRecordPath(stateDir, hostname);
  /** Prior journal or child list preserved for safe acquisition/persistence rollback. */
  const previous = readGenerationRecord(stateDir, hostname);
  if (previous) {
    throw new Error('Previous rolling generation record requires recovery');
  }
  /** Current native process creation identity; null never grants signalling authority. */
  const identity = processIdentity(process.pid);
  if (!identity) {
    throw new Error('Cannot identify rolling controller process');
  }
  /** Controller-owned private recovery state, never exposed as browser configuration. */
  const record: GenerationRecord = {
    version: 1,
    hostname,
    owner: {
      pid: process.pid,
      identity,
      nonce: randomBytes(16).toString('hex'),
    },
    children: [],
    leaseId: null,
    updatedAt: new Date().toISOString(),
  };
  let closed = false;
  /** Persist updated recovery evidence unless this local registry has closed.
   * @returns {void} Synchronous atomic journal replacement; no process starts or signals. */
  const save = () => {
    if (closed) {
      return;
    }
    record.updatedAt = new Date().toISOString();
    atomicWrite(file, record);
  };
  save();
  return {
    /** Record one explicit host-owned child creation fingerprint immediately after spawn, before readiness or route publication.
     * @param {number} pid - Host-owned native child PID; never a request-supplied arbitrary process.
     * @param {number} port - Validated loopback backend port.
     * @returns {void} Persists the child record or throws; launching controller owns rollback on failure.
     */
    track(pid: number, port: number) {
      if (
        !validPid(pid) ||
        !Number.isSafeInteger(port) ||
        port < 1 ||
        port > 65535
      ) {
        throw new Error('Invalid child process');
      }
      /** Current native process creation identity; null never grants signalling authority. */
      const identity = processIdentity(pid);
      if (!identity) {
        throw new Error(`Cannot identify rolling child ${pid}`);
      }
      if (record.children.length >= 32) {
        throw new Error('Too many recorded generations');
      }
      record.children.push({ pid, port, identity });
      save();
    },
    /** Remove one exited/stopped child from this journal, restoring its in-memory list if persistence fails.
     * @param {number} pid - Previously tracked owned native child PID.
     * @returns {void} Updates the local journal without signalling any process.
     */
    untrack(pid: number) {
      /** Prior journal or child list preserved for safe acquisition/persistence rollback. */
      const previous = record.children;
      record.children = record.children.filter((child) => child.pid !== pid);
      try {
        save();
      } catch (error) {
        record.children = previous;
        throw error;
      }
    },
    /** Persist the conditional route lease associated with this controller for safe later recovery.
     * @param {string} leaseId - Validated route-store lease UUID, never inferred from a numeric PID.
     * @returns {void} Writes recovery evidence; it does not itself mutate route membership.
     */
    lease(leaseId: string) {
      if (!LEASE.test(leaseId)) {
        throw new Error('Invalid route lease');
      }
      record.leaseId = leaseId;
      save();
    },
    /** Refuse journal removal while any tracked native child identity still matches, then conditionally remove this owner’s recovery record.
     * @returns {boolean} Whether the unchanged record was removed; no process is stopped by close.
     */
    close() {
      if (
        record.children.some(
          (child) => processIdentity(child.pid) === child.identity
        )
      ) {
        throw new Error(
          'Cannot remove recovery record while tracked children remain'
        );
      }
      closed = true;
      return deleteUnchanged(file, record.owner.nonce);
    },
    /**
     * Read a deep copied host-private journal without granting process-control permission.
     * @returns {GenerationRecord} Detached current local recovery evidence.
     */
    get snapshot(): GenerationRecord {
      return structuredClone(record);
    },
  };
}

/** Recognize Linux zombie state for this explicit recorded PID; unavailable/non-Linux observations do not invent death.
 * @param {number} pid - Previously validated host-owned native PID.
 * @returns {boolean} Whether proc reports a zombie; no signal or external program is executed.
 */
function isZombie(pid: number): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    /** Native Linux proc stat for an explicitly recorded child, used only for zombie detection. */
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return /^Z\s/.test(raw.slice(raw.lastIndexOf(')') + 2));
  } catch {
    return false;
  }
}
/** Require both non-zombie observation and current matching native creation identity.
 * @param {TrackedGeneration} child - Previously validated recorded child identity.
 * @returns {boolean} Whether this exact creation instance remains observed running.
 */
function isSameRunning(child: TrackedGeneration): boolean {
  return !isZombie(child.pid) && processIdentity(child.pid) === child.identity;
}
/** Signal only a verified recorded child, including its detached POSIX group while its leader still matches; use finite TERM then KILL observation budgets.
 * @param {TrackedGeneration} child - Validated host-owned detached child identity; trusted recovery authorization is mandatory.
 * @param {number} waitMs - Validated bounded TERM grace period in milliseconds.
 * @returns {Promise<'terminated' | 'gone'>} Explicit native observation or rejection; arbitrary JavaScript rollback is not implied.
 */
async function terminateIdentified(
  child: TrackedGeneration,
  waitMs: number
): Promise<'terminated' | 'gone'> {
  /** Current native process creation identity; null never grants signalling authority. */
  const identity = processIdentity(child.pid);
  if (
    !processExists(child.pid) ||
    isZombie(child.pid) ||
    (identity !== null && identity !== child.identity)
  ) {
    return 'gone';
  }
  if (identity !== child.identity) {
    throw new Error(
      `Cannot verify orphan child ${child.pid}; manual inspection required`
    );
  }
  /** Recheck the original leader’s creation identity before signalling its explicit detached group.
   * @param {NodeJS.Signals} name Fixed internal TERM/KILL signal selected by this recovery policy.
   * @returns {void} Missing native process is tolerated; other signalling errors propagate. */
  const signal = (name: NodeJS.Signals) => {
    if (processIdentity(child.pid) !== child.identity) {
      return;
    }
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error;
      }
    }
  };
  signal('SIGTERM');
  /** Finite TERM observation cutoff; expiry advances only this explicit owned-child recovery. */
  const deadline = Date.now() + waitMs;
  while (isSameRunning(child) && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(75, Math.max(1, deadline - Date.now())))
    );
  }
  if (isSameRunning(child)) {
    signal('SIGKILL');
    /** Finite final observation cutoff after verified SIGKILL. */
    const hardDeadline = Date.now() + 2_000;
    while (isSameRunning(child) && Date.now() < hardDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  if (isSameRunning(child)) {
    throw new Error(`Orphan child ${child.pid} could not be terminated`);
  }
  return 'terminated';
}

/** Under the required shared control-directory operation lock, reject live/unverifiable owners and preflight every child before any explicit recovery signals.
 * @param {string} stateDir - Host-owned private state directory; separately authorize any recovery operation.
 * @param {string} hostname - Host-authorized exact recovery target.
 * @param {{ waitMs?: number; dryRun?: boolean }} options - Explicit preview or bounded termination policy; default performs host-authorized recovery.
 * @param {number | undefined} options.waitMs - Finite native TERM observation grace period; no arbitrary process takeover.
 * @param {boolean | undefined} options.dryRun - True performs a read-only recovery preview without signals or route changes.
 * @returns {Promise<RecoveryReport>} Per-child outcome and conditional route removal; partial errors preserve explicit recovery failure.
 */
export async function recoverRollingGenerations(
  stateDir: string,
  hostname: string,
  options: {
    waitMs?: number;
    /** True only for explicit read-only recovery preview. */
    dryRun?: boolean;
  } = {}
): Promise<RecoveryReport> {
  /** Validated explicit recovery grace period, zero through sixty thousand milliseconds. */
  const waitMs = options.waitMs ?? 5_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60_000) {
    throw new RangeError('Invalid recovery timeout');
  }
  /** Per-call host-only recovery receipt, initially recording no mutation. */
  const report: RecoveryReport = {
    hostname,
    recovered: false,
    terminated: [],
    alreadyExited: [],
    routeRemoved: false,
  };
  /** Controller-owned private recovery state, never exposed as browser configuration. */
  const record = readGenerationRecord(stateDir, hostname);
  if (!record) {
    return report;
  }
  /** Private local endpoint owner evidence checked independently of the generation journal. */
  const descriptor = readControlDescriptor(stateDir, hostname);
  if (descriptor) {
    /** Current native control-descriptor owner identity. */
    const controllerIdentity = processIdentity(descriptor.pid);
    if (controllerIdentity === descriptor.identity) {
      throw new Error('Rolling controller is still running');
    }
    if (controllerIdentity === null && processExists(descriptor.pid)) {
      throw new Error(
        'Control descriptor owner is unverifiable; refusing recovery'
      );
    }
  }
  /** Current native journal controller identity; live/unverifiable owners reject recovery. */
  const ownerIdentity = processIdentity(record.owner.pid);
  if (ownerIdentity === record.owner.identity) {
    throw new Error('Rolling owner is still running; refusing recovery');
  }
  if (ownerIdentity === null && processExists(record.owner.pid)) {
    throw new Error('Rolling owner identity unavailable; refusing recovery');
  }
  // Preflight every child before signalling any; never partially clean an
  // unidentifiable set and claim success.
  for (const child of record.children) {
    if (processExists(child.pid) && processIdentity(child.pid) === null) {
      throw new Error(
        `Unverifiable orphan child ${child.pid}; manual inspection required`
      );
    }
  }
  if (options.dryRun) {
    report.dryRun = true;
    report.wouldTerminate = record.children
      .filter(isSameRunning)
      .map((child) => child.pid);
    report.alreadyExited = record.children
      .filter((child) => !isSameRunning(child))
      .map((child) => child.pid);
    return report;
  }
  for (const child of record.children) {
    /** Actual identified-child termination receipt; no automatic task replay occurs. */
    const result = await terminateIdentified(child, waitMs);
    (result === 'terminated' ? report.terminated : report.alreadyExited).push(
      child.pid
    );
  }
  if (record.leaseId) {
    report.routeRemoved = new RouteStore(stateDir).removeRouteIfOwned(
      hostname,
      record.leaseId
    );
  }
  if (
    !deleteUnchanged(
      generationRecordPath(stateDir, hostname),
      record.owner.nonce
    )
  ) {
    throw new Error('Rolling generation record changed during recovery');
  }
  report.recovered = true;
  return report;
}
/** Acquire the same private operation lock used by startup before performing one explicitly authorized recovery or dry-run.
 * @param {string} stateDir - Host-owned private state directory; separately authorize any recovery operation.
 * @param {string} hostname - Host-authorized exact route name.
 * @param {{ waitMs?: number; dryRun?: boolean }} options - Optional explicit preview/bounded termination policy.
 * @param {number | undefined} options.waitMs - Finite native TERM observation grace period; no arbitrary process takeover.
 * @param {boolean | undefined} options.dryRun - True performs a read-only recovery preview without signals or route changes.
 * @returns {Promise<RecoveryReport>} Actual locked recovery receipt; failures never grant permission to steal live ownership.
 */
export function recoverRollingGenerationsLocked(
  stateDir: string,
  hostname: string,
  options?: {
    waitMs?: number;
    /** True only for explicit read-only recovery preview. */
    dryRun?: boolean;
  }
) {
  return withOperationLock(ensureControlDirectory(stateDir, true), () =>
    recoverRollingGenerations(stateDir, hostname, options)
  );
}
