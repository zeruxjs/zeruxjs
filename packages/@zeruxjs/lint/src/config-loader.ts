import {readLintSource} from './file-content.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const configFiles = ['lint.zerux.mjs', 'lint.zerux.js', 'lint.zerux.cjs', 'lint.zerux.json', 'lint.zerux.ts', '.lint.zerux.mjs', '.lint.zerux.js', '.lint.zerux.json'];
export async function loadLintConfig(root: string): Promise<Record<string, unknown>> {
  for (const filename of configFiles) {
    const full = path.resolve(root, filename);
    let content:string;
    try {content=await readLintSource(full,1024*1024);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
    // JavaScript config is explicitly trusted executable host code; JSON stays inert.
    const loaded = filename.endsWith('.json') ? JSON.parse(content) : (await import(pathToFileURL(full).href)).default;
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('Lint configuration must be an object');
    return loaded as Record<string, unknown>;
  }
  return {};
}
