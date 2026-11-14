import * as fs from 'node:fs';
/** Read bounded bytes and metadata from one opened regular inode, closing its descriptor even on failure; parent policy stays host-owned.
 * @param {string} file - Trusted private-state path; open uses the existing no-follow/nonblocking flags.
 * @param {number} maximum - Caller-validated byte ceiling, checked against the opened inode before allocating a buffer.
 * @returns {{bytes: Buffer; stat: fs.Stats}} Consumed bytes and same-inode metadata; detects growth during reading, not a cross-process snapshot lock.
 */
export function readStateFile(
  file: string,
  maximum: number
): { bytes: Buffer; stat: fs.Stats } {
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      0o600
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('Unsafe state file', { cause: error });
    }
    throw error;
  }
  try {
    /** Metadata from the already opened inode, not a separate pathname lookup. */
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) {
      throw new Error('Unsafe or oversized state file');
    }
    /** One-byte sentinel beyond the initial size, used to detect growth without an unbounded read. */
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      /** Actual bytes read in this bounded iteration; zero terminates at end of file. */
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) {
        break;
      }
      size += count;
    }
    if (size > stat.size) {
      throw new Error('State file changed during read');
    }
    return { bytes: buffer.subarray(0, size), stat };
  } finally {
    fs.closeSync(fd);
  }
}
