import { readLocalFileSync } from '../utils/file-content.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Finite serialized runtime-metadata byte ceiling; private snapshots are not arbitrary service graphs. */
const MAX_BYTES = 4 * 1024 * 1024;
/** Refuse nonregular or symlink metadata destinations before replacement.
 * @param {string} file - Trusted private metadata path.
 * @returns {boolean} Whether a safe existing regular file is present.
 */
const inspect = (file: string) => {
  try {
    /** Destination inode metadata inspected without following its leaf link. */
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) {
      throw new Error(`Unsafe Zerux runtime state file: ${file}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

/** Read bounded optional private runtime metadata without following a leaf symlink.
 * @param {string} file - Trusted metadata path.
 * @param {T} fallback - Value returned only for a missing file.
 * @returns {T} Parsed metadata or missing-file fallback; malformed/unsafe data throws.
 */
export function readRuntimeJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readLocalFileSync(file, MAX_BYTES).toString('utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

/** Replace one complete bounded private metadata file through exclusive staging and rename; never read a previous oversized file.
 * @param {string} file - Trusted private metadata destination.
 * @param {unknown} value - Explicit serializable metadata projection, never a live service graph.
 * @returns {void} Promotion/cleanup completion; cleanup failures remain visible.
 */
export function writeRuntimeJson(file: string, value: unknown): void {
  /** Complete serialized candidate measured before any temporary output is written. */
  const data = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(data) > MAX_BYTES) {
    throw new Error('Zerux runtime state exceeds 4 MiB');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  inspect(file);
  /** Owned same-directory exclusive temporary file, removed after promotion or failure. */
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temp, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    inspect(file);
    fs.renameSync(temp, file);
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
