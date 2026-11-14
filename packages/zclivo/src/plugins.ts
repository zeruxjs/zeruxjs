/** Resolve opt-in `package.json.zerux` entry points inside their owning package.
 * Paths are validated after realpath resolution so symlinks cannot escape a
 * package. pnpm's normal symlinked node_modules packages remain supported.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Explicit plugin path-policy failure; not a sandbox for trusted plugin code. */
export class PluginEntryError extends Error {
  /** Construct a fixed plugin path diagnostic.
   * @param {string} message - Trusted path-policy failure text.
   */
  constructor(message: string) {
    super(message);
    this.name = 'PluginEntryError';
  }
}

/** Resolve only a package-owned explicit JavaScript entry after canonical containment checks.
 * @param {string} packageDir - Trusted installed package root selected by the host allowlist.
 * @param {unknown} entry - Package manifest's relative zerux entry, inspected as path data.
 * @returns {string} Canonical file URL; writable-tree races and module effects remain host responsibilities.
 */
export function resolvePluginEntry(packageDir: string, entry: unknown): string {
  if (
    typeof entry !== 'string' ||
    !entry ||
    entry.includes('\0') ||
    entry.includes('\\') ||
    entry.includes('?') ||
    entry.includes('#') ||
    path.isAbsolute(entry)
  ) {
    throw new PluginEntryError('Plugin entry must be a local relative path');
  }
  // Avoid loading accidental files from nested dependency packages or arbitrary
  // paths, even when a malicious entry uses traversal or symlinks.
  if (
    !/^\.?\/?[a-zA-Z0-9_@./-]+$/.test(entry) ||
    entry.split('/').includes('..')
  ) {
    throw new PluginEntryError('Invalid plugin entry path');
  }
  /** Canonical installed package root; dependency-manager package symlinks resolve here first. */
  const root = fs.realpathSync(packageDir);
  /** Canonical explicit plugin entry; containment is checked after resolving filesystem links. */
  const target = fs.realpathSync(path.resolve(root, entry));
  /** Canonical relative path used to reject escape or selecting the package directory itself. */
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PluginEntryError('Plugin entry escapes its package directory');
  }
  if (!/\.(?:js|mjs|cjs)$/i.test(target) || !fs.statSync(target).isFile()) {
    throw new PluginEntryError('Plugin entry must be a JavaScript module');
  }
  return pathToFileURL(target).href;
}
