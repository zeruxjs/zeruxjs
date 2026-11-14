import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CommandRegistry,
  loadConfiguredPlugins,
  loadPlugins,
} from '../dist/index.js';
test('explicit workspace plugins share a keyword; npm package exports hide package.json', async () => {
  /** Owned temporary host project removed after plugin/registry assertions. */
  const root = mkdtempSync(join(tmpdir(), 'zclivo-explicit-'));
  try {
    /** Explicit synthetic allowlisted package with hidden package.json export. */
    const pkg = join(root, 'node_modules', 'cli-extra');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', zeruxCli: { plugins: ['cli-extra'] } })
    );
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'cli-extra',
        type: 'module',
        exports: { '.': './plugin.js' },
        zerux: './plugin.js',
      })
    );
    writeFileSync(
      join(pkg, 'plugin.js'),
      "export function register({commands}){commands.register('zerux','extra',()=>0,{description:'installed'})}"
    );
    /** Fixture registry preserving an original command alongside the explicit plugin. */
    const registry = new CommandRegistry();
    registry.register('zerux', 'build', () => 0);
    /** Owned activation records; each requires explicit awaited disposal. */
    const plugins = await loadConfiguredPlugins(registry, root);
    try {
      assert.equal(plugins.length, 1);
      assert.equal((await registry.dispatch('zerux', ['extra'])).exitCode, 0);
      assert.equal((await registry.dispatch('zerux', ['build'])).exitCode, 0);
      await assert.rejects(
        loadPlugins(['../../escape'], new CommandRegistry(), root),
        /Invalid/
      );
    } finally {
      // Dispose this explicit registration before removing its owning fixture package.
      await plugins[0]?.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
