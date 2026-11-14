import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePluginEntry } from '../dist/plugins.js';

/** Own a temporary installed-package tree for one synchronous containment assertion.
 * @param {(root: string, pkg: string) => void} testFn - Trusted fixture callback; no package code is imported.
 * @returns {void} Completes after removing only the owned fixture tree.
 */
function fixture(testFn) {
  /** Owned temporary package/escape-path fixture removed in finally. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclivo-plugins-'));
  /** Owned synthetic installed package root used for canonical containment checks. */
  const pkg = path.join(root, 'package');
  fs.mkdirSync(pkg);
  fs.mkdirSync(path.join(pkg, 'dist'));
  fs.writeFileSync(path.join(pkg, 'dist', 'plugin.js'), 'export default true');
  fs.writeFileSync(path.join(root, 'outside.js'), 'export default false');
  try {
    testFn(root, pkg);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('resolves a plugin under its own root and supports nested js modules', () =>
  fixture((root, pkg) => {
    /** Validated package-owned file URL checked against its canonical entry path. */
    const url = resolvePluginEntry(pkg, './dist/plugin.js');
    assert.equal(fileURLToPath(url), path.join(pkg, 'dist', 'plugin.js'));
  }));

test('does not allow traversal, absolute paths or URL injection', () =>
  fixture((root, pkg) => {
    for (const entry of [
      '../outside.js',
      '/tmp/outside.js',
      'file:///tmp/file.js',
      'dist/plugin.js?x=1',
      'dist/plugin.js#hash',
      'dist/../../../a.js',
      '',
      {},
      'dist\\plugin.js',
    ]) {
      assert.throws(() => resolvePluginEntry(pkg, entry));
    }
  }));

test('resolves realpath for symlinked package and rejects symlink escapes', () =>
  fixture((root, pkg) => {
    /** Fixture-only symlink proving package-root resolution and entry containment. */
    const link = path.join(root, 'linked-package');
    fs.symlinkSync(pkg, link, 'dir');
    assert.equal(
      fileURLToPath(resolvePluginEntry(link, 'dist/plugin.js')),
      path.join(pkg, 'dist', 'plugin.js')
    );
    fs.symlinkSync(
      path.join(root, 'outside.js'),
      path.join(pkg, 'dist', 'external.js')
    );
    assert.throws(() => resolvePluginEntry(pkg, 'dist/external.js'), /escapes/);
  }));
