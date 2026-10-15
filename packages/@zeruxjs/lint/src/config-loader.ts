import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const configFiles = ['lint.zerux.mjs', 'lint.zerux.js', 'lint.zerux.cjs', 'lint.zerux.json', 'lint.zerux.ts', '.lint.zerux.mjs', '.lint.zerux.js', '.lint.zerux.json'];
export async function loadLintConfig(root: string): Promise<Record<string, unknown>> {
  for (const filename of configFiles) {
    const full = path.resolve(root, filename);
    let stat;
    try { stat = await fs.lstat(full); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Unsafe lint configuration');
    const loaded = filename.endsWith('.json') ? JSON.parse(await fs.readFile(full, 'utf8')) : (await import(pathToFileURL(full).href)).default;
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('Lint configuration must be an object');
    return loaded as Record<string, unknown>;
  }
  return {};
}
