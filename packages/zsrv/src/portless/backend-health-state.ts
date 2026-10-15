/** Private, bounded on-disk checkpoint for the proxy's backend circuit breakers.
 * A checkpoint is diagnostic/recovery state, never authority to modify routes. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface SavedBackendHealth {
  hostname: string;
  routeKey: string;
  port: number;
  failures: number;
  checkedAt: number | null;
  /** An active probe must clear blocked before this backend can be selected. */
  blocked: boolean;
  cooldownUntil: number;
}
interface Snapshot { version: 1; savedAt: number; entries: SavedBackendHealth[] }
const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 1024;
const FILENAME = 'backend-health.json';
const errno = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;

function checkDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe backend health directory');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Backend health directory owner mismatch');
  if ((stat.mode & 0o022) !== 0) throw new Error('Backend health directory is writable by other users');
}
function checkFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('Unsafe backend health snapshot');
  }
}
function validEntry(value: unknown): value is SavedBackendHealth {
  if (!value || typeof value !== 'object') return false;
  const v = value as SavedBackendHealth;
  return typeof v.hostname === 'string' && v.hostname.length > 0 && v.hostname.length <= 253 &&
    typeof v.routeKey === 'string' && /^[a-f0-9]{64}$/.test(v.routeKey) &&
    Number.isSafeInteger(v.port) && v.port >= 1 && v.port <= 65535 &&
    Number.isSafeInteger(v.failures) && v.failures >= 0 && v.failures <= 1_000_000 &&
    (v.checkedAt === null || (Number.isSafeInteger(v.checkedAt) && v.checkedAt >= 0)) &&
    typeof v.blocked === 'boolean' && Number.isSafeInteger(v.cooldownUntil) && v.cooldownUntil >= 0;
}
function decode(raw: string): Snapshot {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid backend health snapshot');
  const snapshot = value as Snapshot;
  if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.savedAt) || snapshot.savedAt < 0 ||
      !Array.isArray(snapshot.entries) || snapshot.entries.length > MAX_ENTRIES || !snapshot.entries.every(validEntry)) {
    throw new Error('Invalid backend health snapshot');
  }
  const keys = snapshot.entries.map(entry => `${entry.hostname}:${entry.port}`);
  if (keys.length !== new Set(keys).size) throw new Error('Duplicate backend health snapshot entries');
  return snapshot;
}

/** Checkpoints are never loaded if older than maxAgeMs, including after a crash. */
export class BackendHealthStore {
  readonly file: string;
  readonly maxAgeMs: number;
  constructor(directory: string, maxAgeMs = 60_000) {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 3_600_000) {
      throw new RangeError('Health checkpoint maxAgeMs must be 0–3600000');
    }
    this.file = path.join(path.resolve(directory), FILENAME);
    this.maxAgeMs = maxAgeMs;
    checkDirectory(path.dirname(this.file));
  }
  read(now = Date.now()): readonly SavedBackendHealth[] {
    try {
      checkDirectory(path.dirname(this.file));
      checkFile(this.file);
      const fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      let raw: string;
      try {
        if (fs.fstatSync(fd).size > MAX_BYTES) throw new Error('Backend health snapshot too large');
        raw = fs.readFileSync(fd, 'utf8');
      } finally { fs.closeSync(fd); }
      const snapshot = decode(raw);
      if (snapshot.savedAt > now + 30_000 || now - snapshot.savedAt > this.maxAgeMs) return [];
      return snapshot.entries.map(value => ({ ...value }));
    } catch (error) {
      if (errno(error) === 'ENOENT') return [];
      throw error;
    }
  }
  write(entries: readonly SavedBackendHealth[], now = Date.now()): void {
    if (entries.length > MAX_ENTRIES || !entries.every(validEntry)) throw new Error('Invalid backend health checkpoint');
    checkDirectory(path.dirname(this.file));
    const content = JSON.stringify({ version: 1, savedAt: now, entries }) + '\n';
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Backend health checkpoint too large');
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try { checkFile(this.file); } catch (error) { if (errno(error) !== 'ENOENT') throw error; }
      fs.renameSync(temporary, this.file);
      try {
        const fd = fs.openSync(path.dirname(this.file), 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } catch { /* Directory fsync unavailable on some platforms. */ }
    } finally { try { fs.unlinkSync(temporary); } catch (error) { if (errno(error) !== 'ENOENT') throw error; } }
  }
}
