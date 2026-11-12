import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, rename, unlink, lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Eight-MiB serialized private catalog limit, shared by V1 and V2 persistence. */
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
/** Reject existing nonregular catalog targets without following a leaf symlink.
 * @param {string} file - Leaf path within a host-trusted parent directory.
 * @returns {Promise<void>} Missing or regular target passes; other errors propagate.
 */
async function regularOrMissing(file: string) {
  try {
    if (!(await lstat(file)).isFile()) {
      throw new Error('Catalog path is not a regular file');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
/** Write bounded inert JSON to an exclusive 0600 temporary file, sync, then atomically rename. Parent directory and concurrent-writer locking remain host-owned.
 * @param {string} file - Private destination under a trusted directory.
 * @param {unknown} value - Schema-validated data owned by the caller; this layer only serializes and bounds it.
 * @returns {Promise<void>} Complete candidate promoted or temporary file removed on failure; no cross-process transaction guarantee.
 */
export async function writeCatalogData(
  file: string,
  value: unknown
): Promise<void> {
  /** Serialized candidate checked before opening or replacing any output file. */
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > MAX_CATALOG_BYTES) {
    throw new RangeError('Asset catalog exceeds size limit');
  }
  await mkdir(dirname(file), { recursive: true });
  await regularOrMissing(file);
  /** Unique same-directory exclusive staging file, removed on failure before promotion. */
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    /** Owned file descriptor closed in finally; callers own the trusted parent directory. */
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await regularOrMissing(file);
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
/** Read bounded regular JSON through an owned no-follow file descriptor.
 * @param {string} file - Private catalog under a trusted parent directory.
 * @returns {Promise<unknown>} Parsed inert data; callers validate the versioned schema. Descriptor closes on every outcome.
 */
export async function readCatalogData(file: string): Promise<unknown> {
  /** Owned file descriptor closed in finally; callers own the trusted parent directory. */
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    /** Descriptor metadata checked after no-follow open, before parsing the bounded file. */
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_CATALOG_BYTES) {
      throw new Error('Invalid asset catalog file');
    }
    return JSON.parse(await handle.readFile({ encoding: 'utf8' }));
  } finally {
    await handle.close();
  }
}
