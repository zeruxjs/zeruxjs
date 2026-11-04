import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, '.zerux'), { recursive: true });
const temporary = await mkdtemp(join(root, '.zerux/workspace-init-'));
try {
  const outfile = join(temporary, 'init.mjs');
  await build({ entryPoints: [join(root, 'scripts/workspace-init.ts')], outfile, platform: 'node', format: 'esm', bundle: true, packages: 'external', logLevel: 'silent' });
  await import(pathToFileURL(outfile).href);
} finally { await rm(temporary, { recursive: true, force: true }); }
