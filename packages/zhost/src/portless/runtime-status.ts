import { readStateFile } from './state-file.js';
/** Read-only runtime observability: private, atomic status snapshots per wrapper.
 * This is diagnostic state only. Never use it to authorize process signaling. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { processIdentity } from './lifecycle.js';
import type { ManagedStatus } from './managed-status.js';

export interface RuntimeStatusRecord {
  /** Persisted schema discriminator; only V1 is supported. */
  version: 1;
  /** Validated diagnostic app label, not tenant/owner authorization. */
  hostname: string;
  /** Recorded wrapper PID, validated against a separately observed OS identity for liveness. */
  ownerPid: number;
  /** OS process identity captured at writer creation, or null when unavailable. */
  ownerIdentity: string | null;
  /** Bounded host-supplied managed lifecycle snapshot. */
  status: ManagedStatus;
}
export interface InspectedRuntime extends RuntimeStatusRecord {
  /** Verified process identity and a nonterminal snapshot. Not a health check. */
  alive: boolean;
}
/** Maximum serialized bytes admitted for one runtime status record. */
const MAX_BYTES = 8192;
/** Maximum matching directory entries inspected in one listing. */
const MAX_RECORDS = 200;
/** Validate a bounded inert status hostname label.
 * @param {string} name - Host-supplied diagnostic name.
 * @returns {boolean} Whether path/traversal-like labels are excluded.
 */
const hostnameValid = (name: string) =>
  /^[a-z0-9][a-z0-9._-]{0,240}$/.test(name) && !name.includes('..');

/** Resolve the per-user diagnostic subdirectory beneath the host-owned state root without creating it.
 * @param {string} stateDir - Trusted state root; its parent access policy remains host-owned.
 * @returns {string} Per-user runtime-status directory.
 */
function runtimeDir(stateDir: string): string {
  /** OS user suffix keeping diagnostic subdirectories separate. */
  const userId =
    typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return path.join(stateDir, `app-status-${userId}`);
}
/** Check a real directory owned by the current OS user, optionally creating it with private default permissions.
 * @param {string} dir - Host-controlled directory path.
 * @param {boolean} create - Whether this call may create missing directories.
 * @returns {boolean} False only for a missing read-only lookup; unsafe type/ownership and other errors throw.
 */
function safeDirectory(dir: string, create: boolean): boolean {
  if (create) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(dir);
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Unsafe application status directory');
  }
  // A shared proxy state directory is permitted; the per-user child isn't.
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error('Application status directory belongs to another user');
  }
  return true;
}
/** Write one private diagnostic candidate through an exclusive temporary inode, fsync and same-directory rename.
 * @param {string} filename - Fixed diagnostic destination within the host-owned directory.
 * @param {string} value - Already bounded serialized status text.
 * @returns {void} Closes the owned descriptor and removes its temporary file on every terminal path.
 */
function writeAtomically(filename: string, value: string): void {
  /** Unpredictable exclusive same-directory temporary candidate, never a reusable lock. */
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Refuse to overwrite a symlink, even though rename itself doesn't follow it.
    try {
      if (fs.lstatSync(filename).isSymbolicLink()) {
        throw new Error('Unsafe status file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    fs.renameSync(temporary, filename);
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line no-unsafe-finally -- Preserve the existing policy of surfacing private temporary-file cleanup failures.
        throw error;
      }
    }
  }
}

/** Create a process-scoped atomic status writer without storing argv or environment automatically; status fields remain host-supplied.
 * @param {string} stateDir - Existing trusted state root; not created by this factory.
 * @param {string} hostname - Validated diagnostic app hostname, never process-management authorization.
 * @returns {(status: ManagedStatus) => void} Synchronous writer for this unique record; no persistent descriptor or background timer is retained.
 */
export function createRuntimeStatusWriter(
  stateDir: string,
  hostname: string
): (status: ManagedStatus) => void {
  if (!hostnameValid(hostname)) {
    throw new TypeError('Invalid application status hostname');
  }
  /** Per-user diagnostic directory checked before access. */
  const dir = runtimeDir(stateDir);
  safeDirectory(stateDir, false); // don't create the proxy state directory here
  safeDirectory(dir, true);
  /** Short hostname-derived filename prefix; not an anonymous identity or authorization token. */
  const nameHash = createHash('sha256')
    .update(hostname)
    .digest('hex')
    .slice(0, 16);
  /** Fixed unique record path retained by this writer or selected from a bounded listing. */
  const filename = path.join(
    dir,
    `${nameHash}-${process.pid}-${randomBytes(8).toString('hex')}.json`
  );
  /** Observed current wrapper identity captured before creating the writer callback. */
  const ownerIdentity = processIdentity(process.pid);
  return (status) => {
    /** Diagnostic metadata only; native liveness is checked separately and never grants management permission. */
    const record: RuntimeStatusRecord = {
      version: 1,
      hostname,
      ownerPid: process.pid,
      ownerIdentity,
      status,
    };
    /** Bounded serialized diagnostic candidate, never executable source. */
    const raw = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(raw) > MAX_BYTES) {
      throw new Error('Application status record too large');
    }
    writeAtomically(filename, raw);
  };
}

/** Validate inert parsed diagnostic metadata without treating its identity or status as signaling authority.
 * @param {string} raw - Bounded UTF-8 JSON from an opened status inode.
 * @returns {RuntimeStatusRecord | null} Supported diagnostic record, or null on malformed JSON/fields.
 */
function parseRecord(raw: string): RuntimeStatusRecord | null {
  try {
    /** Unknown parsed JSON root checked before field access. */
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    /** Partially typed record candidate whose required fields are checked individually. */
    const data = value as Partial<RuntimeStatusRecord>;
    /** Managed status candidate checked for supported lifecycle/date/counter fields. */
    const state = data.status;
    if (
      data.version !== 1 ||
      typeof data.hostname !== 'string' ||
      !hostnameValid(data.hostname) ||
      !Number.isSafeInteger(data.ownerPid) ||
      (data.ownerPid ?? 0) <= 1 ||
      !(
        data.ownerIdentity === null ||
        (typeof data.ownerIdentity === 'string' &&
          data.ownerIdentity.length <= 128)
      ) ||
      !state ||
      !['starting', 'running', 'restarting', 'stopping', 'stopped'].includes(
        state.phase
      ) ||
      !(state.pid === null || Number.isSafeInteger(state.pid)) ||
      !Number.isSafeInteger(state.generation) ||
      !Number.isSafeInteger(state.automaticRestarts) ||
      typeof state.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(state.updatedAt))
    ) {
      return null;
    }
    return data as RuntimeStatusRecord;
  } catch {
    return null;
  }
}

/** Inspect at most 200 matching diagnostic snapshots, ignoring invalid/unsafe files without executing stored data.
 * @param {string} stateDir - Host-owned diagnostic state root.
 * @param {string} hostname - Optional exact validated app hostname filter.
 * @returns {InspectedRuntime[]} Newest-first records with verified process-identity liveness, not an application health result.
 */
export function listRuntimeStatus(
  stateDir: string,
  hostname?: string
): InspectedRuntime[] {
  if (hostname !== undefined && !hostnameValid(hostname)) {
    throw new TypeError('Invalid application status hostname');
  }
  /** Per-user diagnostic directory checked before access. */
  const dir = runtimeDir(stateDir);
  if (!safeDirectory(dir, false)) {
    return [];
  }
  /** Detached inspected records with diagnostic liveness annotations. */
  const result: InspectedRuntime[] = [];
  // Cap filesystem work and memory, and ignore non-JSON/nonregular files.
  /** Bounded matching filename list; unrecognized names are never opened. */
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^[a-f0-9]{16}-\d+-[a-f0-9]{16}\.json$/.test(name))
    .slice(0, MAX_RECORDS);
  for (const file of files) {
    /** Fixed unique record path retained by this writer or selected from a bounded listing. */
    const filename = path.join(dir, file);
    try {
      /** Metadata and bytes from the same opened inode, avoiding separate-path inspection of another file. */
      const { stat: stats, bytes } = readStateFile(filename, MAX_BYTES);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_BYTES) {
        continue;
      }
      /** Diagnostic metadata only; native liveness is checked separately and never grants management permission. */
      const record = parseRecord(bytes.toString('utf8'));
      if (!record || (hostname && record.hostname !== hostname)) {
        continue;
      }
      result.push({
        ...record,
        alive:
          record.status.phase !== 'stopped' &&
          record.ownerIdentity !== null &&
          processIdentity(record.ownerPid) === record.ownerIdentity,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        continue;
      }
    }
  }
  return result.sort((a, b) =>
    b.status.updatedAt.localeCompare(a.status.updatedAt)
  );
}
