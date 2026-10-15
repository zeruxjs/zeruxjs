import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncLocalLock, inspectWorkspaceLock } from './workspace-lock.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-lock-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packages', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'beta'), { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n');
  write('package.json', { name: 'root', version: '1.0.0', workspaces: ['packages/*'], dependencies: { alpha: '*', beta: '*' } });
  write('packages/alpha/package.json', { name: 'alpha', version: '1.0.0', dependencies: { beta: '*' }, main: './dist/index.js' });
  write('packages/beta/package.json', { name: 'beta', version: '1.0.0' });
  write('package-lock.json', { name: 'root', version: '1.0.0', lockfileVersion: 3, packages: {
    '': { name: 'root', version: '1.0.0', workspaces: ['packages/*'], dependencies: { alpha: '*' } },
    'packages/alpha': { version: '0.9.0' },
    'node_modules/alpha': { resolved: 'packages/alpha', link: true }
  } });
  return { root, write };
}

test('reconciles local workspace and root metadata without inventing external resolutions', t => {
  const { root, write } = fixture(t);
  write('packages/alpha/package.json', { name: 'alpha', version: '1.2.0', dependencies: { beta: '*', 'vendor-package': '^2.0.0' } });
  const before = inspectWorkspaceLock(root);
  assert.equal(before.staleWorkspaceMetadata, true);
  assert.equal(before.unresolvedExternal[0].name, 'vendor-package');
  const sync = syncLocalLock(root, { write: true });
  assert.equal(sync.changed, true);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['packages/alpha'].version, '1.2.0');
  assert.equal(lock.packages['packages/alpha'].dependencies['vendor-package'], '^2.0.0');
  assert.deepEqual(lock.packages['node_modules/beta'], { resolved: 'packages/beta', link: true });
  assert.equal(lock.packages['node_modules/vendor-package'], undefined);
  assert.equal(inspectWorkspaceLock(root).staleWorkspaceMetadata, false);
  assert.equal(inspectWorkspaceLock(root).ok, false);
  assert.equal(syncLocalLock(root, { write: true }).changed, false);
});

test('accepts a fully resolved local-only workspace lock', t => {
  const { root } = fixture(t);
  syncLocalLock(root, { write: true });
  const report = inspectWorkspaceLock(root);
  assert.equal(report.ok, true);
  assert.equal(report.workspaceCount, 2);
});

test('detects malformed lockfile version rather than corrupting it', t => {
  const { root, write } = fixture(t);
  write('package-lock.json', { lockfileVersion: 2, packages: {} });
  assert.throws(() => syncLocalLock(root, { write: true }), /lockfileVersion 3/);
});

test('does not overwrite existing external integrity information', t => {
  const { root, write } = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/vendor-package'] = { version: '2.0.1', resolved: 'https://example.invalid/pkg.tgz', integrity: 'sha512-abc' };
  write('package-lock.json', lock);
  syncLocalLock(root, { write: true });
  const next = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(next.packages['node_modules/vendor-package'], lock.packages['node_modules/vendor-package']);
});

test('detects a missing nested transitive resolution, not just missing direct imports', t => {
  const { root, write } = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/vendor'] = {
    version: '1.0.0',
    dependencies: { transitive: '^1.0.0' },
    resolved: 'https://registry.npmjs.org/vendor/-/vendor-1.0.0.tgz',
    integrity: 'sha512-abc123=='
  };
  write('package-lock.json', lock);
  syncLocalLock(root, { write: true });
  const report = inspectWorkspaceLock(root);
  assert.ok(report.missingDependencies.some(value => value.owner === 'node_modules/vendor' && value.dependency === 'transitive'));
  assert.equal(report.ok, false);
});

test('valid nested resolutions and locked package integrity pass graph checks', t => {
  const { root, write } = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/vendor'] = { version: '1.0.0', dependencies: { nested: '^2.0.0' }, resolved: 'https://registry.npmjs.org/vendor/-/vendor-1.0.0.tgz', integrity: 'sha512-abc==' };
  lock.packages['node_modules/vendor/node_modules/nested'] = { version: '2.0.0', resolved: 'https://registry.npmjs.org/nested/-/nested-2.0.0.tgz', integrity: 'sha512-abc==' };
  write('package-lock.json', lock);
  syncLocalLock(root, { write: true });
  const report = inspectWorkspaceLock(root);
  assert.deepEqual(report.missingDependencies, []);
  assert.deepEqual(report.malformedEntries, []);
  assert.deepEqual(report.insecureResolutions, []);
  assert.equal(report.ok, true);
});

test('detects cleartext download URLs and missing registry integrity without modifying them', t => {
  const { root, write } = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/unsafe'] = { version: '1.0.0', resolved: 'http://registry.npmjs.org/unsafe/-/unsafe.tgz' };
  lock.packages['node_modules/no-integrity'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/no-integrity/-/no-integrity.tgz' };
  write('package-lock.json', lock);
  syncLocalLock(root, { write: true });
  const report = inspectWorkspaceLock(root);
  assert.deepEqual(report.insecureResolutions, ['node_modules/unsafe']);
  assert.deepEqual([...report.malformedEntries].sort(), ['node_modules/no-integrity', 'node_modules/unsafe']);
  assert.equal(report.ok, false);
});

test('removes obsolete workspace links but keeps legitimate downloaded entries', t => {
  const { root, write } = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/removed-workspace'] = { resolved: 'packages/removed-workspace', link: true };
  lock.packages['node_modules/safe-external'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/safe-external/-/safe-external.tgz', integrity: 'sha512-abc==' };
  write('package-lock.json', lock);
  syncLocalLock(root, { write: true });
  const next = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(next.packages['node_modules/removed-workspace'], undefined);
  assert.deepEqual(next.packages['node_modules/safe-external'], lock.packages['node_modules/safe-external']);
});
