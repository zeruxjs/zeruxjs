import fs from 'node:fs';
import path from 'node:path';
/** Supported authored text suffixes eligible for explicit lint discovery. */
const extensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.md',
  '.yaml',
  '.yml',
]);
/** Generated/dependency directories excluded from recursive discovery. */
const ignored = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
]);
/** Discover bounded authored files under a trusted root without following symlinks.
 * @param {string} cwd - Trusted project directory resolved against the current process working directory.
 * @param {{ files?: string[]; maxFiles?: number }} options - Caller-owned options; see documented fields for defaults and engine-specific behavior.
 * @param {string[]} [options.files] - Explicit local paths; omission discovers the project tree.
 * @param {number} [options.maxFiles=10000] - Positive discovery bound, at most 100,000.
 * @returns {string[]} Sorted unique absolute paths to supported real files within the requested traversal.
 * @throws {Error} For invalid limits, escaped/symlink inputs, traversal errors or excessive file count.
 */
export function discoverLintFiles(
  cwd: string,
  options: { files?: string[]; maxFiles?: number } = {}
): string[] {
  /** Absolute root boundary for explicit source inputs. */
  const base = path.resolve(cwd);
  /** Validated discovery cap; at most 100,000 files may be requested. */
  const max = options.maxFiles ?? 10_000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 100_000) {
    throw new Error('Invalid maxFiles');
  }
  /** Invocation-owned source list; duplicates are removed and paths sorted before return. */
  const found: string[] = [];
  /** Check a statically proven module source or discovered file before reporting diagnostics.
   * @param {string} name - Static property or diagnostic name, never evaluated as code.
   * @returns {void} Appends supported paths or throws when the discovery budget is exhausted.
   */
  const check = (name: string) => {
    if (found.length >= max) {
      throw new Error(`Lint file count exceeds ${max}`);
    }
    if (extensions.has(path.extname(name).toLowerCase())) {
      found.push(name);
    }
  };
  /** Enumerate real directories without following symbolic links or hidden descendants.
   * @param {string} dir - Trusted real directory visited without following symlinks.
   * @returns {void} Adds supported paths to this discovery invocation; traversal failures propagate.
   */
  const visit = (dir: string) => {
    // item comes from native directory metadata; symbolic links and generated roots stay excluded.
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) {
        continue;
      }
      /** Candidate path derived from trusted discovery or explicitly bounded input. */
      const location = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!ignored.has(item.name) && !item.name.startsWith('.')) {
          visit(location);
        }
      } else if (item.isFile()) {
        check(location);
      }
    }
  };
  if (options.files?.length) {
    // file is an explicit host-selected path; enforce the project boundary before visiting it.
    for (const file of options.files) {
      /** Candidate path derived from trusted discovery or explicitly bounded input. */
      const location = path.resolve(base, file);
      if (location !== base && !location.startsWith(base + path.sep)) {
        throw new Error('Lint file escapes project root');
      }
      /** No-follow input metadata used to distinguish regular files and directories. */
      const stat = fs.lstatSync(location);
      if (stat.isSymbolicLink()) {
        throw new Error('Symlink lint input is not allowed');
      }
      if (stat.isDirectory()) {
        visit(location);
      } else if (stat.isFile()) {
        check(location);
      }
    }
  } else {
    visit(base);
  }
  return [...new Set(found)].sort();
}
