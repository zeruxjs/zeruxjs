import fs from 'node:fs/promises';
import path from 'node:path';
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

