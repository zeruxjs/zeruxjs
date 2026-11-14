import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** Prepare and verify the separately locked Stylelint dependency tree before packing.
 * @returns {Promise<void>} Resolves after the reviewed dependency identities are verified and copied; temporary install files are removed.
 * @throws {Error} Rejects on install/integrity/copy/cleanup failure and aborts packing.
 */
async function prepareStylelintBundle() {
  /** Owning package directory; only declared bundled dependency roots are prepared. */
  const root = fileURLToPath(new URL('../', import.meta.url));
  /** Owned temporary install tree, removed even when npm or integrity checks fail. */
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'zerux-stylelint-bundle-')
  );
  // Mirror repository depth so the locked local parser archive resolves unchanged.
  /** Mirrored repository-depth prefix so the locked local adapter archive resolves unchanged. */
  const installRoot = path.join(
    temporary,
    'packages/@zeruxjs/lint/stylelint-bundle'
  );
  try {
    await fs.mkdir(installRoot, { recursive: true });
    await fs.mkdir(path.join(temporary, 'vendor'), { recursive: true });
    await fs.copyFile(
      new URL(
        '../../../../vendor/zeruxjs-scss-media-parser-0.2.3.tgz',
        import.meta.url
      ),
      path.join(temporary, 'vendor/zeruxjs-scss-media-parser-0.2.3.tgz')
    );
    // name selects a committed private install input; lockfile and manifest are copied unchanged.
    for (const name of ['package.json', 'package-lock.json']) {
      await fs.copyFile(
        path.join(root, 'stylelint-bundle', name),
        path.join(installRoot, name)
      );
    }
    // Published overrides are ignored by consumers; bundle the actual patched dependency files instead.
    /** Host npm CLI path validated before spawning Node with an explicit argument array. */
    const npmCli = process.env.npm_execpath;
    if (!npmCli || path.basename(npmCli) !== 'npm-cli.js') {
      throw new Error(
        'Run bundle preparation through npm pack so npm-cli.js is available'
      );
    }
    execFileSync(
      process.execPath,
      // The outer npm pack --dry-run flag must not turn dependency preparation into a no-op.
      [
        npmCli,
        'ci',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--workspaces=false',
        '--json=false',
        '--dry-run=false',
      ],
      { cwd: installRoot, stdio: ['ignore', 2, 2] }
    );
    /** Locked installed dependency tree whose reviewed packages are copied into the owner. */
    const modules = path.join(installRoot, 'node_modules');
    /** Installed fork identity/version checked before any bundle promotion. */
    const braces = JSON.parse(
      await fs.readFile(path.join(modules, 'braces/package.json'), 'utf8')
    );
    if (braces.name !== '@zklogic/braces' || braces.version !== '3.0.7') {
      throw new Error('Refusing to pack an unexpected braces implementation');
    }
    /** Installed licensed media adapter identity/version, checked before bundling. */
    const parser = JSON.parse(
      await fs.readFile(
        path.join(modules, 'postcss-media-query-parser/package.json'),
        'utf8'
      )
    );
    if (
      parser.name !== '@zeruxjs/scss-media-parser' ||
      parser.version !== '0.2.3'
    ) {
      throw new Error('Refusing to pack an unexpected SCSS media parser');
    }
    // Retain unrelated package-local build dependencies; npm bundles only the declared Stylelint roots.
    // entry is a verified installed dependency directory; retain unrelated package-local build tools.
    for (const entry of await fs.readdir(modules)) {
      if (entry.startsWith('.')) {
        continue;
      }
      await fs.cp(
        path.join(modules, entry),
        path.join(root, 'node_modules', entry),
        { recursive: true }
      );
    }
    console.error(
      'Prepared locked Stylelint/SCSS bundle with licensed media adapter and @zklogic/braces@3.0.7'
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

await prepareStylelintBundle();
