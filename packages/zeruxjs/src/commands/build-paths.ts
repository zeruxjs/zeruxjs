import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
/** Reject destination escapes and symlinked or non-directory ancestors, allowing missing paths for later staged creation.
 * @param {string} root - Trusted absolute project root.
 * @param {string} target - Absolute candidate output directory.
 * @param {string} kind - Diagnostic label for the inspected directory.
 * @returns {Promise<void>} Validation completion; this check does not create directories or lock the filesystem.
 */
export async function assertSafeBuildDirectories(
  root: string,
  target: string,
  kind = 'build output'
): Promise<void> {
  /** Project-relative destination checked before traversing its parent directories. */
  const relative = path.relative(root, target);
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Build path escapes project root');
  }
  let current = root;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) {
      current = path.join(current, segment);
    }
    try {
      /** Metadata from the inspected path or opened inode, never a followed leaf symlink. */
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Unsafe ${kind} directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

/** Reject output/source directory overlap before copying, including output nested inside a source tree.
 * @param {string} root - Trusted absolute project root.
 * @param {string} output - Absolute candidate output directory.
 * @param {Iterable<string>} sources - Explicit project-relative source directories.
 * @returns {Promise<void>} Validation completion; missing source paths are ignored.
 */
export async function assertDisjointBuildSources(
  root: string,
  output: string,
  sources: Iterable<string>
): Promise<void> {
  for (const source of sources) {
    /** Project-root-relative source path checked for output overlap. */
    const full = path.join(root, source);
    let stat;
    try {
      stat = await fs.lstat(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    if (
      output === full ||
      output.startsWith(full + path.sep) ||
      full.startsWith(output + path.sep)
    ) {
      throw new Error(`Build output overlaps application source: ${source}`);
    }
  }
}

/** Inspect and read the same owned inode with no-follow flags and a byte ceiling, then always close its handle.
 * @param {string} file - Trusted candidate local file path.
 * @param {number} maximum - Maximum accepted byte count.
 * @param {boolean} singleLink - Require one hard link when the caller needs exclusive-file policy.
 * @returns {Promise<Buffer>} Bounded bytes; non-files, unexpected links and detected growth reject.
 */
export async function readBuildFile(
  file: string,
  maximum: number,
  singleLink = false
): Promise<Buffer> {
  /** Owned no-follow read handle, always closed after inspection and bounded reading. */
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    /** Metadata from the inspected path or opened inode, never a followed leaf symlink. */
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > maximum ||
      (singleLink && stat.nlink !== 1)
    ) {
      throw new Error('Invalid or oversized build file');
    }
    /** Bounded allocation with one extra byte to detect growth past the inspected size. */
    const buffer = Buffer.alloc(Math.min(maximum + 1, stat.size + 1));
    let size = 0;
    while (size < buffer.length) {
      /** One read from the same opened inode; zero bytes ends the bounded loop. */
      const part = await handle.read(buffer, size, buffer.length - size, null);
      if (!part.bytesRead) {
        break;
      }
      size += part.bytesRead;
    }
    if (size > maximum || size > stat.size) {
      throw new Error('Build file changed or exceeds limit');
    }
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}
