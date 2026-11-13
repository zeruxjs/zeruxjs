import { readStateFile } from './state-file.js';
/** Private, bounded on-disk checkpoint for the proxy's backend circuit breakers.
 * A checkpoint is diagnostic/recovery state, never authority to modify routes. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface SavedBackendHealth {
  /** Route hostname used for diagnostic lookup, never management authorization. */
  hostname: string;
  /** SHA-256 route-generation fingerprint fencing restored failures. */
  routeKey: string;
  /** Validated loopback backend port. */
  port: number;
  /** Bounded failure count. */
  failures: number;
  /** Last probe/traffic timestamp in milliseconds, or null. */
  checkedAt: number | null;
  /** An active probe must clear blocked before this backend can be selected. */
  blocked: boolean;
  /** Passive isolation expiry in milliseconds; active blocking is represented separately. */
  cooldownUntil: number;
}
interface Snapshot {
  /** Persisted schema discriminator; only version 1 is supported. */
  version: 1;
  /** Checkpoint wall-clock timestamp in milliseconds. */
  savedAt: number;
  /** Bounded validated circuit-breaker entries. */
  entries: SavedBackendHealth[];
}
/** Maximum checkpoint bytes accepted before decoding or atomic replacement. */
const MAX_BYTES = 256 * 1024;
/** Maximum circuit-breaker records retained in one checkpoint. */
const MAX_ENTRIES = 1024;
/** Fixed leaf name within the host-owned private state directory. */
const FILENAME = 'backend-health.json';
/** Read only a filesystem error code without serializing paths or causes.
 * @param {unknown} error - Caught filesystem failure.
 * @returns {string | undefined} Native error code when available.
 */
const errno = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException)?.code;

/** Require a real host-owned directory that other users cannot write.
 * @param {string} directory - Private checkpoint parent directory.
 * @returns {void} Throws on unsafe ownership, permissions or directory type.
 */
function checkDirectory(directory: string): void {
  /** Directory inode metadata checked before reading or replacing a checkpoint. */
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Unsafe backend health directory');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('Backend health directory owner mismatch');
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error('Backend health directory is writable by other users');
  }
}
/** Require a bounded private regular snapshot file with the current user as owner.
 * @param {string} file - Snapshot path used when metadata must be read.
 * @param {fs.Stats} stat - Metadata from the opened inode when supplied; otherwise read from the path.
 * @returns {void} Throws when type, size, ownership or permissions are unsafe.
 */
function checkFile(file: string, stat = fs.lstatSync(file)): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > MAX_BYTES ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('Unsafe backend health snapshot');
  }
}
/** Validate persisted health fields without trusting parsed JSON types.
 * @param {unknown} value - Untrusted JSON checkpoint entry.
 * @returns {boolean} Whether the value has the bounded SavedBackendHealth representation.
 */
function validEntry(value: unknown): value is SavedBackendHealth {
  if (!value || typeof value !== 'object') {
    return false;
  }
  /** Untrusted entry viewed through the target shape only while each field is validated. */
  const v = value as SavedBackendHealth;
  return (
    typeof v.hostname === 'string' &&
    v.hostname.length > 0 &&
    v.hostname.length <= 253 &&
    typeof v.routeKey === 'string' &&
    /^[a-f0-9]{64}$/.test(v.routeKey) &&
    Number.isSafeInteger(v.port) &&
    v.port >= 1 &&
    v.port <= 65535 &&
    Number.isSafeInteger(v.failures) &&
    v.failures >= 0 &&
    v.failures <= 1_000_000 &&
    (v.checkedAt === null ||
      (Number.isSafeInteger(v.checkedAt) && v.checkedAt >= 0)) &&
    typeof v.blocked === 'boolean' &&
    Number.isSafeInteger(v.cooldownUntil) &&
    v.cooldownUntil >= 0
  );
}
/** Decode a V1 checkpoint and reject invalid metadata or duplicate backend identities.
 * @param {string} raw - Bounded UTF-8 JSON read from the private snapshot inode.
 * @returns {Snapshot} Validated checkpoint; freshness is checked separately by the store.
 */
function decode(raw: string): Snapshot {
  /** Unknown parsed JSON root, validated before use. */
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid backend health snapshot');
  }
  /** Checkpoint candidate whose schema, counts and entries have been validated. */
  const snapshot = value as Snapshot;
  if (
    snapshot.version !== 1 ||
    !Number.isSafeInteger(snapshot.savedAt) ||
    snapshot.savedAt < 0 ||
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length > MAX_ENTRIES ||
    !snapshot.entries.every(validEntry)
  ) {
    throw new Error('Invalid backend health snapshot');
  }
  /** Composite hostname/port identities used to reject duplicate records. */
  const keys = snapshot.entries.map(
    (entry) => `${entry.hostname}:${entry.port}`
  );
  if (keys.length !== new Set(keys).size) {
    throw new Error('Duplicate backend health snapshot entries');
  }
  return snapshot;
}

/** Checkpoints are never loaded if older than maxAgeMs, including after a crash. */
export class BackendHealthStore {
  /** Fixed private checkpoint leaf resolved during construction. */
  readonly file: string;
  /** Validated freshness window used when deciding whether to restore state. */
  readonly maxAgeMs: number;
  /** Bind a private checkpoint path without creating a directory or retaining open descriptors.
   * @param {string} directory - Existing host-owned private state directory.
   * @param {number} maxAgeMs - Maximum checkpoint age in milliseconds, defaulting to 60000.
   */
  constructor(directory: string, maxAgeMs = 60_000) {
    if (
      !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 0 ||
      maxAgeMs > 3_600_000
    ) {
      throw new RangeError('Health checkpoint maxAgeMs must be 0–3600000');
    }
    this.file = path.join(path.resolve(directory), FILENAME);
    this.maxAgeMs = maxAgeMs;
    checkDirectory(path.dirname(this.file));
  }
  /** Read a private bounded inode, ignoring missing, stale or excessively future-dated snapshots.
   * @param {number} now - Wall-clock timestamp in milliseconds used for freshness checks.
   * @returns {readonly SavedBackendHealth[]} Detached entries or an empty list; corrupt/unsafe snapshots throw.
   */
  read(now = Date.now()): readonly SavedBackendHealth[] {
    try {
      checkDirectory(path.dirname(this.file));
      /** Bounded bytes and metadata from the same opened snapshot inode. */
      const opened = readStateFile(this.file, MAX_BYTES);
      checkFile(this.file, opened.stat);
      /** UTF-8 checkpoint text; never evaluated as executable code. */
      const raw = opened.bytes.toString('utf8');
      /** Checkpoint candidate whose schema, counts and entries have been validated. */
      const snapshot = decode(raw);
      if (
        snapshot.savedAt > now + 30_000 ||
        now - snapshot.savedAt > this.maxAgeMs
      ) {
        return [];
      }
      return snapshot.entries.map((value) => ({ ...value }));
    } catch (error) {
      if (errno(error) === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
  /** Atomically replace a complete private checkpoint through an exclusive temporary file and fsync.
   * @param {readonly SavedBackendHealth[]} entries - Bounded validated health records; no route authority or request payloads.
   * @param {number} now - Checkpoint timestamp in milliseconds.
   * @returns {void} Closes owned descriptors and removes the temporary file on success or failure.
   */
  write(entries: readonly SavedBackendHealth[], now = Date.now()): void {
    if (entries.length > MAX_ENTRIES || !entries.every(validEntry)) {
      throw new Error('Invalid backend health checkpoint');
    }
    checkDirectory(path.dirname(this.file));
    /** Complete serialized candidate checked against the byte ceiling before writing. */
    const content =
      JSON.stringify({ version: 1, savedAt: now, entries }) + '\n';
    if (Buffer.byteLength(content) > MAX_BYTES) {
      throw new Error('Backend health checkpoint too large');
    }
    /** Unpredictable exclusive temporary path within the same private directory. */
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      /** Owned descriptor, closed in finally even when writing or fsync fails. */
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        checkFile(this.file);
      } catch (error) {
        if (errno(error) !== 'ENOENT') {
          throw error;
        }
      }
      fs.renameSync(temporary, this.file);
      try {
        /** Owned descriptor, closed in finally even when writing or fsync fails. */
        const fd = fs.openSync(path.dirname(this.file), 'r', 0o600);
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        /* Directory fsync unavailable on some platforms. */
      }
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (errno(error) !== 'ENOENT') {
          // eslint-disable-next-line no-unsafe-finally -- Preserve the existing policy of surfacing private temporary-file cleanup failures.
          throw error;
        }
      }
    }
  }
}
