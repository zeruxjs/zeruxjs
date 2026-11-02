import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.mjs';
import { serve } from './http.mjs';
const root = new URL('../', import.meta.url),
  config = readConfig(root),
  directory = fileURLToPath(new URL('dist/', root));
const file =
  config.mode === 'static' ? 'static-export.json' : 'build-manifest.json';
const manifest = JSON.parse(
  fs.readFileSync(new URL('dist/' + file, root), 'utf8'),
);
if (
  manifest.basePath !== config.basePath ||
  (config.mode === 'static'
    ? manifest.kind !== 'zerux-static-export'
    : manifest.kind !== 'create-zyro-build-v1')
)
  throw Error('Build manifest mismatch; rebuild first');
serve({
  directory,
  config,
  files: manifest.files.map((item) => item.file),
  notFound:
    (config.basePath === '/' ? '' : config.basePath.slice(1) + '/') +
    '404.html',
});
