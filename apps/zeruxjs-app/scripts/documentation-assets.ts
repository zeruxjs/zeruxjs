import { build } from 'esbuild';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  realpath,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/** Stage package CSS and the explicitly authored docs browser entry under the public mount.
 * @param {string} [root] - Trusted app root; defaults to this script's containing application.
 * @returns {Promise<void>} Both candidates complete before per-file promotion; cleanup owns temporary files, not a multi-file transaction.
 */
export async function buildDocumentationAssets(
  root: string = dirname(dirname(fileURLToPath(import.meta.url)))
) {
  /** Resolve the explicit app root before descending; symlinked descendants reject before mkdir can follow them. */
  const actualRoot = await realpath(root);
  let directory = actualRoot;
  for (const segment of ['public', 'docs', 'assets']) {
    directory = join(directory, segment);
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
    /** Every newly selected parent is checked before opening its child. */
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Documentation asset directory cannot be a symlink');
    }
  }
  /** Resolve only the installed package's declared public CSS export. */
  const css = await readFile(
    fileURLToPath(import.meta.resolve('@zeruxjs/docs/styles.css')),
    'utf8'
  );
  /** Temp and final output share a directory for same-filesystem promotion. */
  const temporary = join(directory, '.theme-' + randomUUID() + '.css');
  /** A separate native browser bundle owns only docs code-copy controls. */
  const browser = join(directory, '.theme-' + randomUUID() + '.js');
  try {
    await build({
      entryPoints: [join(actualRoot, 'client/documentation.ts')],
      outfile: browser,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2022'],
      minify: true,
      logLevel: 'silent',
    });
    await writeFile(temporary, css, { flag: 'wx' });
    await rename(temporary, join(directory, 'docs.css'));
    await rename(browser, join(directory, 'docs-client.js'));
  } finally {
    await rm(temporary, { force: true });
    await rm(browser, { force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildDocumentationAssets();
}
