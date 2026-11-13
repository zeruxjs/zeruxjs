import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.mjs';
import { writePublicApiFreeze } from './workspace-api-freeze.mjs';
/** Perform the fixture operation.
 * @param {unknown} t - Input value for t.
 * @param {unknown} overrides - Input value for overrides.
 * @returns {unknown} Result produced by fixture.
 */
function fixture(t, overrides = {}) {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-security-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packages/demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'project',
      version: '0.0.1',
      workspaces: ['packages/*'],
    })
  );
  /** Local value for pkg. */
  const pkg = { name: 'demo', version: '0.1.0', license: 'MIT', ...overrides };
  fs.writeFileSync(
    path.join(root, 'packages/demo/package.json'),
    JSON.stringify(pkg)
  );
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      name: 'project',
      version: '0.0.1',
      lockfileVersion: 3,
      packages: {
        '': { name: 'project', version: '0.0.1', workspaces: ['packages/*'] },
        'packages/demo': {
          version: '0.1.0',
          license: 'MIT',
          ...(overrides.dependencies
            ? { dependencies: overrides.dependencies }
            : {}),
        },
        'node_modules/demo': { resolved: 'packages/demo', link: true },
      },
    })
  );
  writePublicApiFreeze(root);
  return { root };
}
test('offline source audit reports its unverified external advisory boundary', (t) => {
  /** Local value for destructured values. */
  const { root } = fixture(t);
  /** Local value for result. */
  const result = inspectPackageReleaseSecurity(root);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.ok(
    result.advisories.some((a) => a.code === 'ADVISORY_DATABASE_NOT_QUERIED')
  );
});
test('rejects install hooks and Git/file/url dependencies without execution', (t) => {
  /** Local value for destructured values. */
  const { root } = fixture(t, {
    scripts: { postinstall: 'node unsafe.js' },
    dependencies: { hidden: 'git+ssh://bad.test/code' },
  });
  /** Local value for issues. */
  const issues = inspectPackageReleaseSecurity(root).issues;
  assert.ok(issues.some((i) => i.code === 'INSTALL_HOOK'));
  assert.ok(issues.some((i) => i.code === 'REMOTE_DEPENDENCY'));
});
test('rejects missing public license and embedded private key marker', (t) => {
  /** Local value for destructured values. */
  const { root } = fixture(t);
  /** Local value for file. */
  const file = path.join(root, 'packages/demo/package.json');
  /** Local value for pkg. */
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete pkg.license;
  fs.writeFileSync(file, JSON.stringify(pkg));
  fs.writeFileSync(
    path.join(root, 'packages/demo/README.md'),
    '-----BEGIN PRIVATE KEY-----\nsecret'
  );
  /** Local value for issues. */
  const issues = inspectPackageReleaseSecurity(root).issues;
  assert.ok(issues.some((i) => i.code === 'LICENSE'));
  assert.ok(issues.some((i) => i.code === 'PRIVATE_KEY'));
});
