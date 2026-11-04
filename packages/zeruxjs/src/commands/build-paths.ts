import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
/** Refuse symlinked parents as well as the final build directory.
 * Checking only the leaf allows a linked intermediate directory to escape the project. */
export async function assertSafeBuildDirectories(root: string, target: string, kind='build output'): Promise<void> {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Build path escapes project root');
  }
  let current = root;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Unsafe ${kind} directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** A build must never create its output within a directory being copied. */
export async function assertDisjointBuildSources(root: string, output: string, sources: Iterable<string>): Promise<void> {
  for (const source of sources) {
    const full = path.join(root, source);
    let stat;
    try { stat = await fs.lstat(full); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isDirectory()) continue;
    if (output === full || output.startsWith(full + path.sep) || full.startsWith(output + path.sep)) {
      throw new Error(`Build output overlaps application source: ${source}`);
    }
  }
}


/** Inspect and read the same opened inode; never follow a leaf symlink. */
export async function readBuildFile(file: string, maximum: number, singleLink = false): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum || (singleLink && stat.nlink !== 1)) throw new Error('Invalid or oversized build file');
    const buffer = Buffer.alloc(Math.min(maximum + 1, stat.size + 1));
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size > maximum || size > stat.size) throw new Error('Build file changed or exceeds limit');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
