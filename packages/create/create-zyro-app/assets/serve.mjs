import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.mjs';
import { serve } from './http.mjs';
/** Generated project root; preview reads only its explicit build output. */
const root = new URL('../', import.meta.url);
/** Validated public-only preview configuration. */
const config = readConfig(root);
/** Owned generated output directory, not an arbitrary request path. */
const directory = fileURLToPath(new URL('dist/', root));
/** Fixed manifest filename selected by the validated mode. */
const file =
  config.mode === 'static' ? 'static-export.json' : 'build-manifest.json';
/** Build-owned manifest checked against the configured public mount before serving. */
const manifest = JSON.parse(
  fs.readFileSync(new URL('dist/' + file, root), 'utf8')
);
if (
  manifest.basePath !== config.basePath ||
  (config.mode === 'static'
    ? manifest.kind !== 'zerux-static-export'
    : manifest.kind !== 'create-zyro-build-v1')
) {
  throw Error('Build manifest mismatch; rebuild first');
}
serve({
  directory,
  config,
  files: manifest.files.map((item) => item.file),
  notFound:
    (config.basePath === '/' ? '' : config.basePath.slice(1) + '/') +
    '404.html',
});
