import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * Title: Prepare the published Stylelint security bundle.
 * Description: Installs the reviewed, locked dependency graph without lifecycle scripts and copies it into this package for npm's dependency bundling.
 * Global Variables: import.meta.url, the temporary directory, npm's configured registry/cache and inherited process environment. No environment values are logged.
 * @returns {Promise<void>} Resolves after verifying and preparing the patched dependency tree; failures abort packing.
 */
async function prepareStylelintBundle() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-stylelint-bundle-'));
  try {
    for (const name of ['package.json', 'package-lock.json']) {
      await fs.copyFile(path.join(root, 'stylelint-bundle', name), path.join(temporary, name));
    }
    // Published overrides are ignored by consumers; bundle the actual patched dependency files instead.
    const npmCli=process.env.npm_execpath;
    if(!npmCli || path.basename(npmCli)!=='npm-cli.js') throw new Error('Run bundle preparation through npm pack so npm-cli.js is available');
    execFileSync(process.execPath,
      // The outer npm pack --dry-run flag must not turn dependency preparation into a no-op.
      [npmCli, 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--workspaces=false', '--json=false', '--dry-run=false'],
      { cwd: temporary, stdio: ['ignore', 2, 2] });
    const modules = path.join(temporary, 'node_modules');
    const braces = JSON.parse(await fs.readFile(path.join(modules, 'braces/package.json'), 'utf8'));
    if (braces.name !== '@zklogic/braces' || braces.version !== '3.0.7') {
      throw new Error('Refusing to pack an unexpected braces implementation');
    }
    // Retain unrelated package-local build dependencies; npm bundles only the declared Stylelint roots.
    for (const entry of await fs.readdir(modules)) {
      if (entry.startsWith('.')) continue;
      await fs.cp(path.join(modules, entry), path.join(root, 'node_modules', entry), { recursive: true });
    }
    console.error('Prepared locked Stylelint/SCSS bundle with @zklogic/braces@3.0.7');
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

await prepareStylelintBundle();
