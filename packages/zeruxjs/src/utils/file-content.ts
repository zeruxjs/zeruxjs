import fs from 'node:fs';
/** Read a bounded opened regular inode; optional link-following exists only for explicit host secret-rotation paths.
 * @param {string} file - Trusted host-selected path.
 * @param {number} maximum - Maximum admitted byte size.
 * @param {boolean} followLinks - Explicit host policy, default false.
 * @returns {Buffer} Owned bytes; the descriptor closes after success or failure.
 */
export function readLocalFileSync(
  file: string,
  maximum: number,
  followLinks = false
): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY |
        fs.constants.O_NONBLOCK |
        (followLinks ? 0 : fs.constants.O_NOFOLLOW),
      0o600
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('Unsafe local file', { cause: error });
    }
    throw error;
  }
  try {
    /** Opened descriptor metadata, inspected before reading or allocating its byte buffer. */
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw Object.assign(new Error('Unsafe local file type'), {
        code: 'EFTYPE',
      });
    }
    if (stat.size > maximum) {
      throw new Error('Local file size exceeds limit');
    }
    /** One-extra-byte buffer detecting growth beyond the inspected file size. */
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      /** Bytes read during this iteration; zero means EOF. */
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) {
        break;
      }
      size += count;
    }
    if (size > stat.size) {
      throw new Error('Local file changed during read');
    }
    return bytes.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}
