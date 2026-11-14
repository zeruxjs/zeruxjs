import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Supported legacy server source extensions; declaration files are excluded separately. */
export const SCRIPT_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'] as const;

/** Build, dependency and runtime-state folders pruned by the legacy script walk. */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.zerux',
  'coverage',
  'dist',
  'node_modules',
]);

/** Convert native separators for source/manifests without changing path authority.
 * @param {string} value - Native path.
 * @returns {string} Forward-slash representation.
 */
export const toPosixPath = (value: string) => value.split(path.sep).join('/');

/** Create a trusted host-selected directory recursively.
 * @param {string} targetPath - Host-owned destination.
 * @returns {void} Directory creation completion.
 */
export const ensureDirectory = (targetPath: string) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

/** Recognize supported executable source suffixes while excluding .d.ts declarations.
 * @param {string} filePath - Candidate filename.
 * @returns {boolean} Whether legacy script discovery admits its suffix.
 */
export const isScriptFile = (filePath: string) => {
  if (filePath.endsWith('.d.ts')) {
    return false;
  }
  return SCRIPT_EXTENSIONS.some((extension) => filePath.endsWith(extension));
};

/** Return the first existing regular candidate in declared priority order.
 * @param {string} basePath - Trusted source directory.
 * @param {readonly string[]} candidates - Explicit relative candidate names.
 * @returns {string | null} First matching path or null.
 */
export const findExistingFile = (
  basePath: string,
  candidates: readonly string[]
) => {
  for (const candidate of candidates) {
    /** Current explicit candidate under the trusted base directory. */
    const absolutePath = path.join(basePath, candidate);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  }

  return null;
};

/** Resolve a named legacy script entry using supported extension order.
 * @param {string} basePath - Trusted source directory.
 * @param {string} [name] - Authored entry basename, default index.
 * @returns {string | null} First existing script path or null.
 */
export const findScriptEntry = (basePath: string, name = 'index') =>
  findExistingFile(
    basePath,
    SCRIPT_EXTENSIONS.map((extension) => `${name}${extension}`)
  );

/** Walk trusted source trees with legacy ignore/extension policy; not a hostile-filesystem sandbox.
 * @param {string} directoryPath - Trusted source directory.
 * @returns {string[]} Sorted script paths.
 */
export const walkDirectory = (directoryPath: string): string[] => {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  /** Directory metadata inspected before recursive discovery. */
  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return [];
  }

  /** Script paths collected from the trusted source tree before deterministic sorting. */
  const files: string[] = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...walkDirectory(path.join(directoryPath, entry.name)));
      continue;
    }

    /** Current child file path checked by the supported-extension predicate. */
    const fullPath = path.join(directoryPath, entry.name);
    if (isScriptFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files.sort();
};

/** Import an explicitly selected trusted server module; development gets a cache revision.
 * @param {string} filePath - Trusted selected source file.
 * @param {"dev" | "start"} mode - Source-development or production behavior.
 * @returns {Promise<unknown>} Executed trusted module namespace.
 */
export const importModule = async (filePath: string, mode: 'dev' | 'start') => {
  /** File URL whose development cache marker never authorizes an arbitrary source path. */
  const moduleUrl = pathToFileURL(path.resolve(filePath));
  if (mode === 'dev') {
    moduleUrl.searchParams.set('t', `${Date.now()}`);
  }

  return import(moduleUrl.href);
};
