import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePluginEntry } from '../dist/plugins.js';

function fixture(testFn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcli-plugins-'));
  const pkg = path.join(root, 'package');
  fs.mkdirSync(pkg);
  fs.mkdirSync(path.join(pkg, 'dist'));
  fs.writeFileSync(path.join(pkg, 'dist', 'plugin.js'), 'export default true');
  fs.writeFileSync(path.join(root, 'outside.js'), 'export default false');
  try { testFn(root, pkg); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('resolves a plugin under its own root and supports nested js modules', () => fixture((root, pkg) => {
  const url = resolvePluginEntry(pkg, './dist/plugin.js');
  assert.equal(fileURLToPath(url), path.join(pkg, 'dist', 'plugin.js'));
}));

test('does not allow traversal, absolute paths or URL injection', () => fixture((root, pkg) => {
  for (const entry of ['../outside.js', '/tmp/outside.js', 'file:///tmp/file.js', 'dist/plugin.js?x=1', 'dist/plugin.js#hash', 'dist/../../../a.js', '', {}, 'dist\\plugin.js']) {
    assert.throws(() => resolvePluginEntry(pkg, entry));
  }
}));

test('resolves realpath for symlinked package and rejects symlink escapes', () => fixture((root, pkg) => {
  const link = path.join(root, 'linked-package');
  fs.symlinkSync(pkg, link, 'dir');
  assert.equal(fileURLToPath(resolvePluginEntry(link, 'dist/plugin.js')), path.join(pkg, 'dist', 'plugin.js'));
  fs.symlinkSync(path.join(root, 'outside.js'), path.join(pkg, 'dist', 'external.js'));
  assert.throws(() => resolvePluginEntry(pkg, 'dist/external.js'), /escapes/);
}));
