import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writePublicApiFreeze,
  verifyPublicApiFreeze,
} from './workspace-api-freeze.mjs';

/** Perform the fixture operation.
 * @param {unknown} t - Input value for t.
 * @returns {unknown} Result produced by fixture.
 */
function fixture(t) {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-api-freeze-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packages/test'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ workspaces: ['packages/*'] })
  );
  /** Local value for file. */
  const file = path.join(root, 'packages/test/package.json');
  /** Local value for pkg. */
  const pkg = {
    name: '@acme/fixture',
    version: '0.1.0',
    exports: { '.': './dist/index.js' },
    engines: { node: '>=20' },
  };
  fs.writeFileSync(file, JSON.stringify(pkg));
  return { root, file, pkg };
}

test('freeze is deterministic and implementation-only source changes do not affect it', (t) => {
  /** Local value for destructured values. */
  const { root } = fixture(t);
  writePublicApiFreeze(root);
  assert.equal(verifyPublicApiFreeze(root).ok, true);
  fs.writeFileSync(
    path.join(root, 'packages/test/new.ts'),
    'export const x=1;'
  );
  assert.equal(verifyPublicApiFreeze(root).ok, true);
});
test('freeze rejects entrypoint, version, peer, platform and private-visibility drift', (t) => {
  /** Local value for destructured values. */
  const { root, file, pkg } = fixture(t);
  writePublicApiFreeze(root);
  for (const patch of [
    { version: '0.2.0' },
    { exports: { '.': './dist/other.js' } },
    { peerDependencies: { react: '^19.0.0' } },
    { engines: { node: '>=24' } },
    { private: true },
  ]) {
    fs.writeFileSync(file, JSON.stringify({ ...pkg, ...patch }));
    assert.equal(verifyPublicApiFreeze(root).ok, false);
    assert.match(
      verifyPublicApiFreeze(root).issues[0].issue,
      /contract changed/
    );
  }
});
test('freeze rejects missing baseline and lost workspaces', (t) => {
  /** Local value for destructured values. */
  const { root } = fixture(t);
  assert.equal(verifyPublicApiFreeze(root).ok, false);
  writePublicApiFreeze(root);
  fs.rmSync(path.join(root, 'packages/test'), { recursive: true, force: true });
  assert.match(verifyPublicApiFreeze(root).issues[0].issue, /removed package/);
});
