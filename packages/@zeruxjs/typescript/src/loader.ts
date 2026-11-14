import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transformTypescript } from './transform.js';

/** Borrowed downstream Node resolver; asynchronous rejection is preserved. */
type Resolve = (specifier: string, context: object) => Promise<{ url: string }>;
/** Borrowed downstream Node loader for unsupported URL schemes/extensions. */
type Load = (
  url: string,
  context: object
) => Promise<{ format?: string; source?: string | Uint8Array }>;

/** Delegate resolution unchanged; the next Node loader owns package/URL policy.
 * This hook neither rewrites specifiers nor reads source files.
 *
 * @param {string} specifier - Module specifier received from Node, passed through unchanged.
 * @param {object} context - Borrowed Node resolution context passed to the next loader.
 * @param {Resolve} nextResolve - Next hook; retains resolution and rejection ownership.
 * @returns {Promise<{url: string}>} Next loader's resolved module record.
 * @throws {Error} Rejects with the next loader's failure; no fallback or replay occurs.
 */
export async function resolve(
  specifier: string,
  context: object,
  nextResolve: Resolve
) {
  return nextResolve(specifier, context);
}
/** Read and transpile local TypeScript URLs, delegating other inputs unchanged.
 * File/transform failures reject the load. shortCircuit declares ownership to Node;
 * returning source does not evaluate it here, but Node will execute it on import.
 *
 * @param {string} url - Resolved module URL; only local TypeScript file URLs are read here.
 * @param {object} context - Borrowed Node load context, used only when delegating.
 * @param {Load} nextLoad - Next hook for unsupported schemes/extensions.
 * @returns {Promise<object>} Delegated record or short-circuited module format and transpiled source.
 * @throws {Error} Rejects for file reads, URL conversion, transpilation or delegated failures.
 */
export async function load(url: string, context: object, nextLoad: Load) {
  if (
    !url.startsWith('file:') ||
    !/\.(?:ts|tsx|mts|cts)$/.test(new URL(url).pathname)
  ) {
    return nextLoad(url, context);
  }
  /** Local path derived from the resolved file URL, never a remote fetch target. */
  const filename = fileURLToPath(url);
  /** UTF-8 module text read for transpilation; execution remains with Node. */
  const source = await fs.readFile(filename, 'utf8');
  /** CTS selects CommonJS; other supported TypeScript extensions select ESM. */
  const format = filename.endsWith('.cts') ? 'cjs' : 'esm';
  return {
    format: format === 'cjs' ? 'commonjs' : 'module',
    shortCircuit: true,
    source: transformTypescript(source, { filename, format, sourceMap: true })
      .code,
  };
}
