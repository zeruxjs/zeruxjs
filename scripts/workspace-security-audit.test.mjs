import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.mjs';
import { writePublicApiFreeze } from './workspace-api-freeze.mjs';
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-security-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packages/demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'project', version: '0.0.1', workspaces: ['packages/*'] }));
  const pkg = { name: 'demo', version: '0.1.0', license: 'MIT', ...overrides };
  fs.writeFileSync(path.join(root, 'packages/demo/package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'project', version: '0.0.1', lockfileVersion: 3, packages: {
    '': { name: 'project', version: '0.0.1', workspaces: ['packages/*'] },
    'packages/demo': { version: '0.1.0', license: 'MIT', ...(overrides.dependencies ? { dependencies: overrides.dependencies } : {}) },
    'node_modules/demo': { resolved: 'packages/demo', link: true }
  } }));
  writePublicApiFreeze(root);
  return { root };
}
test('offline source audit reports its unverified external advisory boundary', t => {
  const { root } = fixture(t);
  const result = inspectPackageReleaseSecurity(root);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.ok(result.advisories.some(a => a.code === 'ADVISORY_DATABASE_NOT_QUERIED'));
});
test('rejects install hooks and Git/file/url dependencies without execution', t => {
  const { root } = fixture(t, { scripts: { postinstall: 'node unsafe.js' }, dependencies: { hidden: 'git+ssh://bad.test/code' } });
  const issues = inspectPackageReleaseSecurity(root).issues;
  assert.ok(issues.some(i => i.code === 'INSTALL_HOOK'));
  assert.ok(issues.some(i => i.code === 'REMOTE_DEPENDENCY'));
});
test('rejects missing public license and embedded private key marker', t => {
  const { root } = fixture(t);
  const file = path.join(root, 'packages/demo/package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete pkg.license;
  fs.writeFileSync(file, JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, 'packages/demo/README.md'), '-----BEGIN PRIVATE KEY-----\nsecret');
  const issues = inspectPackageReleaseSecurity(root).issues;
  assert.ok(issues.some(i => i.code === 'LICENSE'));
  assert.ok(issues.some(i => i.code === 'PRIVATE_KEY'));
});
