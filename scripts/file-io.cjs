/** Local value for fs. */
const fs = require('node:fs');
/**
 * Read one bounded regular descriptor without following symlinks.
 *
 * @param {string|Buffer|URL|number} file - File descriptor or path already authorized by the caller.
 * @param {number} maximum - Maximum accepted file size in bytes.
 * @returns {Buffer} Bytes read before the file changed or the bound was exceeded.
 * @throws {Error} If the target is not a regular, bounded file or changes during reading.
 */
function readRegularFileSync(file, maximum = 4 * 1024 * 1024) {
  /** Descriptor opened with no-follow and nonblocking flags for bounded reads. */
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    0o600
  );
  try {
    /** Snapshot used to reject directories, oversized files, and mid-read growth. */
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) {
      throw Error('Unsafe or oversized file');
    }
    /** One sentinel byte detects a file that grows during the read. */
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      /** Local value for count. */
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) {
        break;
      }
      size += count;
    }
    if (size > stat.size) {
      throw Error('File changed during read');
    }
    return bytes.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}
/**
 * Read one bounded regular file asynchronously without following symlinks.
 *
 * @param {string|Buffer|URL|number} file - File descriptor or path already authorized by the caller.
 * @param {number} maximum - Maximum accepted file size in bytes.
 * @returns {Promise<Buffer>} Bytes read before the file changed or the bound was exceeded.
 * @throws {Error} If the target is not a regular, bounded file or changes during reading.
 */
async function readRegularFile(file, maximum = 64 * 1024 * 1024) {
  /** Owned descriptor closed in the function's finally block. */
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    0o600
  );
  try {
    /** Snapshot used to reject directories, oversized files, and mid-read growth. */
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) {
      throw Error('Unsafe or oversized file');
    }
    /** One sentinel byte detects a file that grows during the read. */
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      /** Local value for chunk. */
      const chunk = await handle.read(bytes, size, bytes.length - size, null);
      if (!chunk.bytesRead) {
        break;
      }
      size += chunk.bytesRead;
    }
    if (size > stat.size) {
      throw Error('File changed during read');
    }
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}
/**
 * Replace one private log path with an exclusively created empty file.
 *
 * @param {string|Buffer|URL} file - Caller-authorized log path to replace.
 * @returns {number} Open descriptor for the newly claimed log file.
 * @throws {Error} If an unexpected unlink or exclusive create failure occurs.
 */
function resetLogFileSync(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return fs.openSync(file, 'wx', 0o600);
}
module.exports = { readRegularFileSync, readRegularFile, resetLogFileSync };
