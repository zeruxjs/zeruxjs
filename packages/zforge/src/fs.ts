import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Maximum serialized private state size checked before writes and after descriptor reads. */
const MAX_STATE_BYTES = 4 * 1024 * 1024;
/** Inspect an existing state destination without following its leaf symlink.
 * @param {string} filePath - Host-selected private state path.
 * @returns {fs.Stats | null} Existing regular-file metadata, or null when absent; unsafe objects reject.
 */
const unsafeFile = (filePath: string) => {
  try {
    /** Opened or directly inspected file metadata checked before trusting type and byte count. */
    const st = fs.lstatSync(filePath);
    if (!st.isFile() || st.isSymbolicLink()) {
      throw new Error(`Unsafe devtools state file: ${filePath}`);
    }
    return st;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

/** Create the host-selected state parent with private permissions.
 * @param {string} filePath - State destination whose parent may be created.
 * @returns {void} Ensures the parent exists; does not grant authorization or validate arbitrary ancestor ownership.
 */
export const ensureParentDirectory = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
};

/** Read bounded descriptor-backed JSON; the owning consumer still validates its schema.
 * @template T
 * @param {string} filePath - Host-selected private state path.
 * @param {T} fallback - Returned only when the file is absent.
 * @returns {T} Parsed state, with corrupt, oversized or linked leaves rejected.
 */
export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  let fd: number;
  try {
    fd = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      0o600
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('Unsafe devtools state file', { cause: error });
    }
    throw error;
  }
  try {
    /** Opened or directly inspected file metadata checked before trusting type and byte count. */
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_STATE_BYTES) {
      throw new Error('Invalid devtools state file');
    }
    /** Read buffer includes one sentinel byte to detect growth after the descriptor size check. */
    const bytes = Buffer.alloc(st.size + 1);
    /** Actual descriptor read length checked against the originally observed file size. */
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (size > st.size) {
      throw new Error('Devtools state changed during read');
    }
    /** Bounded UTF-8 state text parsed only after file type and size validation. */
    const content = bytes.subarray(0, size).toString('utf8');
    if (Buffer.byteLength(content) > MAX_STATE_BYTES) {
      throw new Error('Devtools state file exceeds 4 MiB');
    }
    return JSON.parse(content) as T;
  } finally {
    fs.closeSync(fd);
  }
};

/** Atomically replace private state through an exclusive same-directory temporary file.
 * @param {string} filePath - Host-owned private destination.
 * @param {unknown} value - JSON-serializable state within the byte limit.
 * @returns {void} Returns after rename; independent cleanup failures remain visible.
 */
export const writeJsonFile = (filePath: string, value: unknown): void => {
  /** Exact JSON representation bounded before any state file is written. */
  const payload = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(payload) > MAX_STATE_BYTES) {
    throw new Error('Devtools state file exceeds 4 MiB');
  }
  ensureParentDirectory(filePath);
  unsafeFile(filePath);
  /** Exclusive same-directory temporary destination removed after success or failure. */
  const temp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temp, payload, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.chmodSync(temp, 0o600);
    // Close the gap where another process might replace the target with a link.
    unsafeFile(filePath);
    fs.renameSync(temp, filePath);
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
};
