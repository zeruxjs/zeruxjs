import { readLintSource } from './file-content.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Ordered supported config names; the first readable configuration owns selection. */
const configFiles = [
  'lint.zerux.mjs',
  'lint.zerux.js',
  'lint.zerux.cjs',
  'lint.zerux.json',
  'lint.zerux.ts',
  '.lint.zerux.mjs',
  '.lint.zerux.js',
  '.lint.zerux.json',
];
/** Load the first supported trusted project configuration; JSON is data, JS/TS may execute.
 * @param {string} root - Trusted project or owned fixture directory used for local operations.
 * @returns {Promise<Record<string, unknown>>} Validated configuration object, or an empty object when no supported config is present.
 * @throws {Error} Rejects for unreadable/malformed configs or executable config failures; configs are trusted host code.
 */
export async function loadLintConfig(
  root: string
): Promise<Record<string, unknown>> {
  // filename follows the documented precedence list; stop after the first existing valid config.
  for (const filename of configFiles) {
    /** Absolute candidate configuration path under the trusted project root. */
    const full = path.resolve(root, filename);
    let content: string;
    try {
      content = await readLintSource(full, 1024 * 1024);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    // JavaScript config is explicitly trusted executable host code; JSON stays inert.
    /** Parsed JSON data or the default export of explicitly trusted executable configuration. */
    const loaded = filename.endsWith('.json')
      ? JSON.parse(content)
      : (await import(pathToFileURL(full).href)).default;
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      throw new Error('Lint configuration must be an object');
    }
    return loaded as Record<string, unknown>;
  }
  return {};
}
