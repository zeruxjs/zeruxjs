import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSafeModuleAsset } from '../dist/module-loader.js';

test('devtools assets stay within their real package/public root', (t) => {
  /** Owned synthetic package fixture removed by the test cleanup hook. */
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-zdev-assets-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  /** Synthetic module asset root bounding all allowed file/directory resolution. */
  const root = path.join(temp, 'module');
  fs.mkdirSync(root);
  /** Out-of-root synthetic payload that traversal and symlink requests must never expose. */
  const privateFile = path.join(temp, 'secret.txt');
  fs.writeFileSync(privateFile, 'DO-NOT-EXPOSE');
  fs.writeFileSync(path.join(root, 'ok.css'), '.ok {}');
  fs.mkdirSync(path.join(root, 'nested'));
  assert.equal(
    resolveSafeModuleAsset(root, 'ok.css'),
    path.join(root, 'ok.css')
  );
  assert.equal(
    resolveSafeModuleAsset(root, 'nested', 'directory'),
    path.join(root, 'nested')
  );
  for (const value of [
    '../secret.txt',
    'nested/../../secret.txt',
    '..\\secret.txt',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'nested/%2e%2e%2fsecret.txt',
  ]) {
    assert.equal(resolveSafeModuleAsset(root, value), null, value);
  }
  assert.equal(resolveSafeModuleAsset(root, 'nested', 'file'), null);
  assert.equal(resolveSafeModuleAsset(root, 'ok.css', 'directory'), null);
  fs.symlinkSync(privateFile, path.join(root, 'shortcut.txt'));
  fs.symlinkSync(temp, path.join(root, 'escape-dir'));
  assert.equal(resolveSafeModuleAsset(root, 'shortcut.txt'), null);
  assert.equal(resolveSafeModuleAsset(root, 'escape-dir/secret.txt'), null);
  fs.symlinkSync(path.join(root, 'ok.css'), path.join(root, 'inside.css'));
  assert.equal(
    resolveSafeModuleAsset(root, 'inside.css'),
    path.join(root, 'ok.css')
  );
});
