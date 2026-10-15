import fs from 'node:fs';
import path from 'node:path';

/**
 * Create a fresh, fully representative workspace source tree for clean-install
 * verification. Unlike a packages-only fixture this includes app routes,
 * config, public assets, integration tests, and build scripts.
 *
 * Never copy local credentials, dependency links, caches, or generated output.
 * All symlinks are excluded, not dereferenced, even when they point outside the
 * checkout. This helper never modifies the input directory.
 */
export function createCleanWorkspaceSnapshot(source, destination) {
  const root = path.resolve(source);
  const output = path.resolve(destination);
  if (output === root || output.startsWith(root + path.sep)) {
    throw new Error('Clean workspace destination must be outside the source tree');
  }
  for (const filename of ['package.json', 'package-lock.json']) {
    if (!fs.statSync(path.join(root, filename), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing workspace source: ${filename}`);
    }
  }
  const excludedDirs = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', '.git', '.cache', '__pycache__']);
  const excludedFiles = new Set(['.DS_Store', 'Thumbs.db', '.npmrc', '.yarnrc', '.pypirc', '.netrc']);
  let copied = 0;
  fs.cpSync(root, output, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    filter: filename => {
      if (filename === root) return true;
      const base = path.basename(filename);
      if (excludedFiles.has(base) || /^\.env(?:\..*)?$/.test(base) && base !== '.env.example' || base.endsWith('.tsbuildinfo')) return false;
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) return false;
      if (stat.isDirectory() && excludedDirs.has(base)) return false;
      if (stat.isFile()) copied++;
      return true;
    }
  });
  return { copiedFiles: copied, destination: output };
}
