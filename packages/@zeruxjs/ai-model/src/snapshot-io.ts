import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Fixed 32 MiB snapshot ceiling applies during serialization and incremental reads. */
const LIMIT = 32 * 1024 * 1024;
/**
 * Reject an existing nonregular/symlink snapshot target before output promotion.
 * @param {string} file - Trusted private snapshot path; parent ownership and cross-process coordination belong to host.
 * @returns {Promise<void>} Missing targets are allowed; unexpected filesystem errors propagate.
 */
async function checkTarget(file: string) {
  try {
    if (!(await lstat(file)).isFile()) {
      throw new TypeError('Unsafe knowledge snapshot path');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
/**
 * Own a private exclusive temporary sibling until synced candidate promotion or cleanup.
 * @param {unknown} snapshot - Complete versioned candidate; no partial restoration/promotion is allowed.
 * @param {string} file - Trusted private snapshot path; parent ownership and cross-process coordination belong to host.
 * @returns {Promise<void>} Resolves after rename; concurrent trusted writers remain last-complete-writer-wins.
 * @throws {Error} Rejects oversized/unsafe targets or I/O failure; owned temporary output is cleaned on failure.
 */
export async function writeBoundedSnapshot(
  snapshot: unknown,
  file: string
): Promise<void> {
  /** Serialized candidate is byte-checked before creating any temporary output. */
  const content = JSON.stringify(snapshot);
  if (Buffer.byteLength(content) > LIMIT) {
    throw new RangeError('Knowledge snapshot too large');
  }
  await mkdir(dirname(file), { recursive: true });
  await checkTarget(file);
  /** Private exclusive temporary sibling supports complete-candidate promotion and cleanup. */
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    /** Owned descriptor is closed in finally; borrowed application stores are not involved. */
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await checkTarget(file);
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
/**
 * Read a regular non-symlink JSON snapshot under an incremental 32 MiB byte ceiling.
 * @param {string} file - Trusted private snapshot path; parent ownership and cross-process coordination belong to host.
 * @returns {Promise<unknown>} Fatally decoded parsed JSON; owned descriptor closes even on corrupt/oversized input.
 * @throws {Error} Rejects nonregular/symlink, corrupt UTF-8/JSON or oversized files; descriptor always closes.
 */
export async function readBoundedSnapshot(file: string): Promise<unknown> {
  /** Owned descriptor is closed in finally; borrowed application stores are not involved. */
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let snapshot: unknown;
  try {
    /** Descriptor stat rejects nonregular or already oversized input before allocating chunks. */
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > LIMIT) {
      throw new TypeError('Invalid knowledge snapshot file');
    }
    /** Bounded read fragments are retained only after aggregate byte accounting. */
    const chunks: Buffer[] = [];
    let length = 0;
    while (true) {
      /** Fixed 64 KiB per-read buffer keeps growth bounded while the file may change. */
      const buffer = Buffer.alloc(65536);
      /** One descriptor read is charged before its bytes enter the retained snapshot. */
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) {
        break;
      }
      length += read.bytesRead;
      if (length > LIMIT) {
        throw new RangeError('Knowledge snapshot too large');
      }
      chunks.push(buffer.subarray(0, read.bytesRead));
    }
    snapshot = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, length)
      )
    );
  } finally {
    await handle.close();
  }
  return snapshot;
}
