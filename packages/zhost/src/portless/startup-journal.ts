import { readStateFile } from './state-file.js';
/** Crash-recoverable journal for the four proxy startup metadata files.
 * Callers must hold the proxy operation lock throughout recovery/publication.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Fixed compatibility filenames followed by the authoritative canonical commit record. */
export const STATE_NAMES = [
  'proxy.port',
  'proxy.tls',
  'proxy.tld',
  'proxy.pid',
  'proxy.state.json',
] as const;
export type StateName = (typeof STATE_NAMES)[number];
export type Snapshot = Record<StateName, Buffer | null>;
/** Internal private journal name; never derived from request input. */
const JOURNAL = '.proxy-startup-journal.json';
/** Maximum individual startup field bytes; journal reads have an explicit bounded multiplier. */
const MAX_FILE = 64 * 1024;

/** Read bounded no-follow state bytes; absence is distinct from unsafe or malformed native files.
 * @param {string} file - Trusted fixed state path.
 * @param {number} limit - Maximum allowed file bytes, default 64 KiB.
 * @returns {Buffer | null} Detached bytes or null only for absence; no file is fetched remotely.
 */
export function regularFile(file: string, limit = MAX_FILE): Buffer | null {
  try {
    return readStateFile(file, limit).bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    if (error instanceof Error && error.message.startsWith('Unsafe')) {
      throw new Error(`Unsafe proxy state file: ${file}`, { cause: error });
    }
    throw error;
  }
}

/** Attempt directory fsync after file publication while tolerating only declared unsupported platform errors.
 * @param {string} dir - Trusted parent containing the fixed startup files.
 * @returns {void} Unexpected native errors propagate; tolerated platforms retain file fsync/rename only.
 */
function syncDirectory(dir: string): void {
  // Not all platforms permit directory fsync. File fsync/rename still applies.
  try {
    /** Owned native descriptor, closed after file/directory synchronization. */
    const fd = fs.openSync(dir, 'r', 0o600);
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (
      !['EINVAL', 'EISDIR', 'EBADF', 'EPERM', 'EACCES', 'ENOTSUP'].includes(
        (error as NodeJS.ErrnoException).code ?? ''
      )
    ) {
      throw error;
    }
  }
}

/** Atomically replace or delete one fixed startup file with exclusive private staging and explicit directory durability attempt.
 * @param {string} file - Trusted fixed destination inside the host-owned state directory.
 * @param {Buffer | null} bytes - Next bounded bytes, or null for deletion; caller owns schema/size checks.
 * @returns {void} Commits rename/delete and attempts parent sync; cleanup failures are visible.
 */
export function atomicStateWrite(file: string, bytes: Buffer | null): void {
  /** Trusted parent directory for fixed state publication. */
  const dir = path.dirname(file);
  if (bytes === null) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    syncDirectory(dir);
    return;
  }
  /** Exclusive private same-directory staging filename. */
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    /** Owned native descriptor, closed after file/directory synchronization. */
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    syncDirectory(dir);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
        throw error;
      }
    }
  }
}

/** Read all fixed startup filenames without inferring a cross-file atomic snapshot; callers must hold the operation lock.
 * @param {string} dir - Trusted locked state directory.
 * @returns {Snapshot} Fixed-name bytes or absence for each startup field.
 */
export function snapshot(dir: string): Snapshot {
  return Object.fromEntries(
    STATE_NAMES.map((name) => [name, regularFile(path.join(dir, name))])
  ) as Snapshot;
}

/** Encode a fixed startup snapshot as inert base64 JSON fields.
 * @param {Snapshot} state - Trusted bounded fixed-name byte snapshot.
 * @returns {Record<StateName, string | null>} Serializable fixed-key representation; contains private process ownership data.
 */
function encode(state: Snapshot): Record<StateName, string | null> {
  return Object.fromEntries(
    STATE_NAMES.map((name) => [name, state[name]?.toString('base64') ?? null])
  ) as Record<StateName, string | null>;
}
/** Validate bounded canonical base64 snapshot fields with compatibility for the missing V1 canonical commit key.
 * @param {unknown} value - Unknown parsed journal snapshot.
 * @returns {Snapshot} Validated fixed-key bytes; malformed input rejects before restoration.
 */
function decode(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid proxy startup journal');
  }
  /** Unknown parsed object narrowed only while fixed fields are validated. */
  const data = value as Record<string, unknown>;
  return Object.fromEntries(
    STATE_NAMES.map((name) => {
      /** Unknown encoded field validated before base64 decoding. */
      const bytes = data[name];
      // Version-1 journals created before the committed-state record existed
      // contain only the four legacy keys. Treat the new key as absent.
      if (name === 'proxy.state.json' && bytes === undefined) {
        return [name, null];
      }
      if (bytes === null) {
        return [name, null];
      }
      if (
        typeof bytes !== 'string' ||
        bytes.length > MAX_FILE * 2 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          bytes
        )
      ) {
        throw new Error('Invalid proxy startup journal payload');
      }
      /** Canonical decoded bytes checked against the individual file budget. */
      const decoded = Buffer.from(bytes, 'base64');
      if (decoded.length > MAX_FILE || decoded.toString('base64') !== bytes) {
        throw new Error('Invalid proxy startup journal payload');
      }
      return [name, decoded];
    })
  ) as Snapshot;
}
/** Compare nullable state bytes exactly, distinguishing absence from an empty file.
 * @param {Buffer | null} a - First optional byte buffer.
 * @param {Buffer | null} b - Second optional byte buffer.
 * @returns {boolean} Whether both absence or byte identity agree.
 */
export function equalState(a: Buffer | null, b: Buffer | null): boolean {
  return a === null ? b === null : b !== null && a.equals(b);
}
/** Derive the fixed internal startup journal filename without touching disk.
 * @param {string} dir - Trusted host state directory.
 * @returns {string} Fixed child path, not a client-selected destination.
 */
export function journalPath(dir: string): string {
  return path.join(dir, JOURNAL);
}

/** Reject an unrecovered journal before atomically publishing a versioned before/after snapshot under the operation lock.
 * @param {string} dir - Trusted locked state directory.
 * @param {Snapshot} before - Complete bounded prior state.
 * @param {Snapshot} after - Complete bounded proposed state.
 * @returns {void} Commits the private journal; does not publish the startup files itself.
 */
export function writeStartupJournal(
  dir: string,
  before: Snapshot,
  after: Snapshot
): void {
  if (regularFile(journalPath(dir), MAX_FILE * 16) !== null) {
    throw new Error('Unrecovered proxy startup journal exists');
  }
  atomicStateWrite(
    journalPath(dir),
    Buffer.from(
      JSON.stringify({
        version: 1,
        before: encode(before),
        after: encode(after),
      })
    )
  );
}
/** Remove the fixed startup journal after successful commit/recovery while holding the operation lock.
 * @param {string} dir - Trusted locked state directory.
 * @returns {void} Absent journal is tolerated; unexpected native failures throw.
 */
export function clearStartupJournal(dir: string): void {
  atomicStateWrite(journalPath(dir), null);
}

/** Restore only states matching the journal’s before/after alternatives, refusing live/unverifiable markers and unrelated external edits.
 * @param {string} dir - Trusted state directory protected by the host-held operation lock.
 * @param {(raw: string) => boolean} isLiveMarker - Trusted native identity verifier; true also covers unverifiable live ownership.
 * @returns {boolean} False for no journal, true after complete recovery; unsafe partial recovery throws.
 */
export function recoverStartupJournal(
  dir: string,
  isLiveMarker: (raw: string) => boolean
): boolean {
  /** Optional bounded private crash journal bytes. */
  const raw = regularFile(journalPath(dir), MAX_FILE * 16);
  if (raw === null) {
    return false;
  }
  let record: { before: Snapshot; after: Snapshot };
  try {
    /** Unknown parsed object narrowed only while fixed fields are validated. */
    const data = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    if (data.version !== 1) {
      throw new Error('Unknown proxy journal version');
    }
    record = { before: decode(data.before), after: decode(data.after) };
  } catch {
    throw new Error('Invalid proxy startup journal; manual recovery required');
  }
  /** Current fixed-name snapshot used to reject unrelated external edits before recovery. */
  const current = snapshot(dir);
  for (const name of STATE_NAMES) {
    if (
      !equalState(current[name], record.before[name]) &&
      !equalState(current[name], record.after[name])
    ) {
      throw new Error(
        `Proxy state changed outside interrupted startup (${name}); manual recovery required`
      );
    }
  }
  if (
    current['proxy.pid'] !== null &&
    isLiveMarker(current['proxy.pid'].toString('utf8'))
  ) {
    throw new Error(
      'Cannot recover proxy startup journal while recorded process is live'
    );
  }
  // The canonical owner record must be protected independently: a legacy PID
  // file might have been manually deleted while a live committed owner remains.
  if (current['proxy.state.json'] !== null) {
    let marker: unknown;
    try {
      marker = (
        JSON.parse(current['proxy.state.json'].toString('utf8')) as Record<
          string,
          unknown
        >
      ).marker;
    } catch {
      throw new Error(
        'Invalid committed proxy state; manual recovery required'
      );
    }
    if (!marker || isLiveMarker(JSON.stringify(marker))) {
      throw new Error(
        'Cannot recover proxy startup journal while committed process is live or unverifiable'
      );
    }
  }
  // Restore the owner marker first; readers must not mistake the new metadata for committed state.
  for (const name of [...STATE_NAMES].reverse()) {
    if (!equalState(current[name], record.before[name])) {
      atomicStateWrite(path.join(dir, name), record.before[name]);
    }
  }
  clearStartupJournal(dir);
  return true;
}
