import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transformTypescript } from './transform.js';

type Resolve = (specifier: string, context: object) => Promise<{ url: string }>;
type Load = (url: string, context: object) => Promise<{ format?: string; source?: string | Uint8Array }>;

/** Node ESM loader: node --import register-loader.mjs or --experimental-loader <this package>/loader. */
export async function resolve(specifier: string, context: object, nextResolve: Resolve) {
  return nextResolve(specifier, context);
}
export async function load(url: string, context: object, nextLoad: Load) {
  if (!url.startsWith('file:') || !/\.(?:ts|tsx|mts|cts)$/.test(new URL(url).pathname)) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const source = await fs.readFile(filename, 'utf8');
  const format = filename.endsWith('.cts') ? 'cjs' : 'esm';
  return { format: format === 'cjs' ? 'commonjs' : 'module', shortCircuit: true,
    source: transformTypescript(source, { filename, format, sourceMap: true }).code };
}
