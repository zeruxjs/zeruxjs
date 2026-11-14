import { build } from 'esbuild';
import { createZuix } from 'zuixs';
import { svgIconMarkup } from '@zeruxjs/font';
import { writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
/** Build complete candidate resources, then replace each generated output with a per-file rename.
 * @param {string} root - Trusted explicit app root; this is an operator/build action, never an import side effect.
 * @returns {Promise<void>} Compiles before promotion and cleans owned scratch files; the four renames are not a multi-file transaction.
 */
export async function buildWorkspaceAssets(
  root: string = dirname(dirname(fileURLToPath(import.meta.url)))
) {
  /** Unique candidate filenames remain inside the explicit target public directory. */
  const base = join(root, 'public', `.workspace-${randomUUID()}`),
    temporary = base + '.js',
    counterFile = base + '-counter.js',
    cssFile = base + '.css',
    iconFile = base + '.svg';
  try {
    await build({
      entryPoints: [join(root, 'client/workspace.ts')],
      outfile: temporary,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: true,
      sourcemap: false,
      logLevel: 'silent',
      metafile: true,
    });
    await build({
      entryPoints: [join(root, 'client/counter.ts')],
      outfile: counterFile,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: true,
      sourcemap: false,
      logLevel: 'silent',
    });
    /** Structured authored SVG from the font encoder; no arbitrary HTML or remote asset is admitted. */
    const icon = svgIconMarkup(
      {
        viewBox: [0, 0, 24, 24],
        paths: [{ d: 'M4 4 H20 V8 L8 16 H20 V20 H4 V16 L16 8 H4 Z' }],
      },
      { decorative: false, label: 'Zerux workspace' }
    );
    await writeFile(iconFile, icon);
    /** Explicit utility inventory compiled at build time, never a browser CSS interpreter. */
    const tokens = ['grid', 'gap-4'];
    /** Complete compiler result must contain no unknown utilities before any output is replaced. */
    const css = createZuix({ minify: true }).generate(tokens);
    if (css.unmatched.length) {
      throw new Error('Unrecognized workspace CSS utilities');
    }
    await writeFile(cssFile, css.css);
    await rename(iconFile, join(root, 'public', 'workspace-mark.svg'));
    await rename(temporary, join(root, 'public', 'workspace-client.js'));
    await rename(counterFile, join(root, 'public', 'counter-client.js'));
    await rename(cssFile, join(root, 'public', 'workspace-utilities.css'));
  } finally {
    await rm(temporary, { force: true });
    await rm(counterFile, { force: true });
    await rm(cssFile, { force: true });
    await rm(iconFile, { force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildWorkspaceAssets();
}
