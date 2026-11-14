import fs from 'node:fs/promises';
import { constants } from 'node:fs';
/** Distinguish skipped oversized formatter inputs from other filesystem failures. */
export class LintSourceLimitError extends RangeError {
  /** Construct the fixed source-size error without including source data or a path. */
  constructor() {
    super('Lint source exceeds size limit');
  }
}
/** Read a bounded regular file through the same already-owned descriptor.
 * @param {Awaited<ReturnType<typeof fs.open>>} handle - Borrowed open descriptor; the caller remains responsible for closing it.
 * @param {number} maximum - Maximum source size in bytes, enforced before allocation.
 * @returns {Promise<string>} Decoded UTF-8 source read from this descriptor within the byte limit.
 * @throws {Error} For nonregular, oversized or changing sources and native descriptor read failures.
 */
async function content(
  handle: Awaited<ReturnType<typeof fs.open>>,
  maximum: number
): Promise<string> {
  /** Descriptor-bound file metadata checked before allocation or source parsing. */
  const stat = await handle.stat();
  if (!stat.isFile()) {
    throw new Error('Unsafe lint source');
  }
  if (stat.size > maximum) {
    throw new LintSourceLimitError();
  }
  /** Bounded UTF-8 buffer used for the current descriptor read or replacement write. */
  const bytes = Buffer.alloc(stat.size + 1);
  let size = 0;
  while (size < bytes.length) {
    /** Native read result; a zero-byte read ends the bounded read loop. */
    const next = await handle.read(bytes, size, bytes.length - size, null);
    if (!next.bytesRead) {
      break;
    }
    size += next.bytesRead;
  }
  if (size > stat.size) {
    throw new Error('Lint source changed during read');
  }
  return bytes.subarray(0, size).toString('utf8');
}
/** Read one owned no-follow descriptor and always close it before settling.
 * @param {string} file - Trusted local source path; caller owns path authorization.
 * @param {Node} maximum - Maximum source size in bytes, enforced before allocation.
 * @returns {Promise<string>} UTF-8 source after the owned descriptor closes, including on read failure.
 * @throws {Error} Rejects for unsafe inputs, size limits, reads or close failures.
 */
export async function readLintSource(
  file: string,
  maximum = 5 * 1024 * 1024
): Promise<string> {
  /** Owned no-follow file descriptor, closed in finally after success or failure. */
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600
  );
  try {
    return await content(handle, maximum);
  } finally {
    await handle.close();
  }
}
/** Apply an explicit fix only when the opened file still matches the expected source.
 * @param {string} file - Trusted local source path; caller owns path authorization.
 * @param {string} expected - Previously read source text used to reject concurrent edits before fixing.
 * @param {string} next - Replacement source bytes from the selected formatter, never executable instructions here.
 * @returns {Promise<void>} Resolves after the revision-checked replacement is written and the descriptor closes.
 * @throws {Error} Rejects for size limits, changed source, unsafe paths, incomplete writes or descriptor failures.
 */
export async function writeLintSource(
  file: string,
  expected: string,
  next: string
): Promise<void> {
  if (Buffer.byteLength(next) > 5 * 1024 * 1024) {
    throw new Error('Formatted source exceeds 5 MiB');
  }
  /** Owned no-follow file descriptor, closed in finally after success or failure. */
  const handle = await fs.open(
    file,
    constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600
  );
  try {
    if ((await content(handle, 5 * 1024 * 1024)) !== expected) {
      throw new Error('Lint source changed before fix');
    }
    /** Bounded UTF-8 buffer used for the current descriptor read or replacement write. */
    const bytes = Buffer.from(next);
    let written = 0;
    while (written < bytes.length) {
      /** Native write result; zero progress rejects rather than spinning indefinitely. */
      const result = await handle.write(
        bytes,
        written,
        bytes.length - written,
        written
      );
      if (!result.bytesWritten) {
        throw new Error('Incomplete lint fix write');
      }
      written += result.bytesWritten;
    }
    await handle.truncate(bytes.length);
  } finally {
    await handle.close();
  }
}
