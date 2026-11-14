import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SearchDocument } from './types.js';
import { SearchIndex } from './search-index.js';

export interface SearchPersistenceOptions {
  /** Maximum serialized snapshot bytes; defaults to 16 MiB, within 256 bytes–256 MiB. */
  maxBytes?: number;
  /** Saving only; loads validate either version against the target index. */ snapshotVersion?:
    | 1
    | 2;
}
/** Validate persistence configuration and return the explicit serialized-byte ceiling.
 * @param {SearchPersistenceOptions} options - Optional byte and snapshot version settings; invalid settings throw.
 * @returns {number} Validated limit between 256 bytes and 256 MiB.
 */
function maxBytes(options?: SearchPersistenceOptions): number {
  if (
    options?.snapshotVersion !== undefined &&
    options.snapshotVersion !== 1 &&
    options.snapshotVersion !== 2
  ) {
    throw new TypeError('Unsupported snapshot version');
  }
  /** Validated byte ceiling, defaulting to 16 MiB for standalone persistence. */
  const value = options?.maxBytes ?? 16 * 1024 * 1024;
  if (
    !Number.isSafeInteger(value) ||
    value < 256 ||
    value > 256 * 1024 * 1024
  ) {
    throw new RangeError('Invalid snapshot byte limit');
  }
  return value;
}
/** Resolve a safe snapshot filename beneath an existing nonsymlink parent. This is a private-directory contract, not cross-process locking.
 * @param {string} filename - Host-selected filename; hidden names and unsupported basename characters reject.
 * @returns {Promise<string>} Absolute path after parent realpath validation.
 */
async function validatedPath(filename: string): Promise<string> {
  if (
    typeof filename !== 'string' ||
    !/^[a-zA-Z0-9._-]+$/.test(basename(filename)) ||
    basename(filename).startsWith('.')
  ) {
    throw new TypeError('Invalid snapshot filename');
  }
  /** Absolute destination resolved without creating directories. */
  const pathname = resolve(filename);
  /** Existing parent directory whose canonical path must match to reject symlink ancestors. */
  const dir = dirname(pathname);
  if ((await realpath(dir)) !== dir) {
    throw new Error('Snapshot directory must not contain symlinks');
  }
  return pathname;
}
/** Reject an existing symbolic-link destination; absence is allowed for an exclusive new write.
 * @param {string} file - Validated absolute snapshot path.
 * @returns {Promise<void>} Settles after lstat; errors other than absence propagate.
 */
async function rejectSymlink(file: string): Promise<void> {
  try {
    if ((await lstat(file)).isSymbolicLink()) {
      throw new Error('Snapshot path cannot be a symlink');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
/** Atomically replace a size-bounded snapshot in a host-owned private directory. Owns and closes temporary file handles; directory fsync is best effort and concurrent writers need host coordination.
 * @param {string} filename - Host-selected destination with an existing private nonsymlink parent.
 * @param {SearchIndex<T>} index - Borrowed index; snapshot generation does not mutate it.
 * @param {SearchPersistenceOptions} options - Optional maximum bytes and output version; defaults to V1 and 16 MiB.
 * @returns {Promise<void>} Resolves after candidate promotion; failed candidates are cleaned and failures propagate.
 */
export async function saveSearchSnapshot<T extends SearchDocument>(
  filename: string,
  index: SearchIndex<T>,
  options?: SearchPersistenceOptions
): Promise<void> {
  /** Validated private path; ownership of its parent remains with the host. */
  const file = await validatedPath(filename);
  /** Complete snapshot representation prepared before touching the destination. */
  const bytes = Buffer.from(
    JSON.stringify(
      options?.snapshotVersion === 2
        ? index.snapshot({ version: 2 })
        : index.snapshot()
    )
  );
  if (bytes.length > maxBytes(options)) {
    throw new RangeError('Search snapshot too large');
  }
  await rejectSymlink(file);
  /** Exclusive random sibling; rename promotes only a completely written candidate. */
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rejectSymlink(file);
    await rename(temporary, file);
    // Flush the directory entry on platforms that support directory fsync.
    try {
      /** Owned directory handle used for best-effort directory-entry synchronization. */
      const d = await open(dirname(file), 'r');
      try {
        await d.sync();
      } finally {
        await d.close();
      }
    } catch {
      /* best effort on platforms without directory fsync */
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}
/** Read a bounded regular-file snapshot and stage validation before replacing the borrowed index. Always closes its owned read handle.
 * @param {string} filename - Host-selected snapshot path; symlink destinations reject.
 * @param {SearchIndex<T>} index - Borrowed target; malformed or incompatible snapshots preserve its previous state.
 * @param {SearchPersistenceOptions} options - Optional maximum input bytes; snapshot versions are validated by the target index.
 * @returns {Promise<boolean>} False only for an absent file; true after successful load. Other I/O or validation failures reject.
 */
export async function loadSearchSnapshot<T extends SearchDocument>(
  filename: string,
  index: SearchIndex<T>,
  options?: SearchPersistenceOptions
): Promise<boolean> {
  /** Validated private path; ownership of its parent remains with the host. */
  const file = await validatedPath(filename);
  await rejectSymlink(file);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  try {
    /** File metadata checked before reading a bounded regular-file snapshot. */
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes(options)) {
      throw new RangeError('Invalid snapshot file size');
    }
    /** UTF-8 snapshot text; parsing and staged index validation precede replacement. */
    const content = await handle.readFile({ encoding: 'utf8' });
    index.load(JSON.parse(content));
    return true;
  } finally {
    await handle.close();
  }
}
