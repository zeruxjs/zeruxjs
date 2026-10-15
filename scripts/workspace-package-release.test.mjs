import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPublishablePackage, inspectPublishableWorkspaces } from './workspace-package-release.mjs';
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-release-'));
  const dir = path.join(root, 'packages', 'example'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT', files: ['dist/','README.md','LICENSE-MIT'], main: './dist/index.js', types: './dist/index.d.ts', bin: { demo: './dist/cli.js' } }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Example'); fs.writeFileSync(path.join(dir, 'LICENSE-MIT'), 'MIT');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))) };
};
const expected = ['package.json','README.md','LICENSE-MIT','dist/index.js','dist/index.d.ts','dist/cli.js'].map(path => ({ path }));
test('publishable tarball verifies every JS, typing and CLI target', t => {
  const { root, dir, pkg } = fixture(t);
  const result = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), packedFiles: expected, built: true });
  assert.deepEqual(result.errors, []);
  assert.equal(inspectPublishableWorkspaces(root, { built: true, npmPack: () => expected }).ok, true);
});
test('missing artifact is blocked, but missing generated output is only a source preflight warning', t => {
  const { dir, pkg } = fixture(t);
  const shortened = expected.filter(x => x.path !== 'dist/cli.js');
  const before = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), packedFiles: shortened, built: false });
  assert.equal(before.errors.length, 0);
  assert.equal(before.warnings.some(x => x.code === 'NOT_BUILT'), true);
  const after = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), packedFiles: shortened, built: true });
  assert.equal(after.errors.some(x => x.code === 'EXPORT_NOT_PACKED'), true);
});
test('private dependency and unpinned workspace reference are release blockers', t => {
  const { dir, pkg } = fixture(t); pkg.dependencies = { '@zeruxjs/internal': '*' };
  const entries = new Map([['@zeruxjs/internal', { pkg: { private: true } }]]);
  const report = inspectPublishablePackage({ name: 'example', dir, pkg, entries, packedFiles: expected, built: true });
  assert.ok(report.errors.some(x => x.code === 'PRIVATE_DEPENDENCY'));
  assert.ok(report.errors.some(x => x.code === 'UNPINNED_WORKSPACE_DEPENDENCY'));
});
test('malicious or accidental files are rejected from packed artifacts', t => {
  const { dir, pkg } = fixture(t);
  const report = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), packedFiles: [...expected, { path: 'src/index.ts' }, { path: '.env.production' }, {path:'test/test.js'}], built: true });
  assert.equal(report.errors.filter(x => x.code === 'UNWANTED_PACK_FILE').length, 3);
});
test('private workspace is never audited as publishable', t => {
  const { dir, pkg } = fixture(t); pkg.private = true;
  const report = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), built: true });
  assert.equal(report.private, true); assert.equal(report.errors.length, 0);
});
test('archive preview is read-only, with explicit files allowlist preventing source leakage', t => {
  const { root, dir } = fixture(t);
  fs.mkdirSync(path.join(dir, 'dist')); for(const name of ['index.js','index.d.ts','cli.js'])fs.writeFileSync(path.join(dir,'dist',name),'export {}');
  fs.mkdirSync(path.join(dir,'src')); fs.writeFileSync(path.join(dir,'src','secret.ts'),'SENSITIVE');
  const result = inspectPublishableWorkspaces(root, { built: true });
  assert.equal(result.ok, true);
  assert.equal(result.packages[0].files, expected.length);
  assert.equal(fs.readdirSync(dir).includes('example-1.0.0.tgz'), false);
});
test('public dependency chain cannot conceal a private second-hop dependency', t => {
  const { dir, pkg } = fixture(t);
  pkg.dependencies = { 'middle': '^1.0.0' };
  const entries = new Map([
    ['example', { pkg }],
    ['middle', { pkg: { private: false, dependencies: { 'secret': '^1.0.0' } } }],
    ['secret', { pkg: { private: true } }],
  ]);
  const result = inspectPublishablePackage({ name: 'example', dir, pkg, entries, packedFiles: expected, built: true });
  assert.ok(result.errors.some(x => x.code === 'TRANSITIVE_PRIVATE_DEPENDENCY' && x.detail.includes('example -> middle -> secret')));
});
test('0.x stable semver is a compatibility advisory; alpha is not stable release ready', t => {
  const { dir, pkg } = fixture(t);
  pkg.version = '0.2.0';
  const stable = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), packedFiles: expected, built: true });
  assert.ok(stable.warnings.some(x => x.code === 'PRE_1_SEMVER'));
  assert.ok(!stable.warnings.some(x => x.code === 'PRERELEASE_VERSION'));
  pkg.version = '0.2.1-alpha.1';
  const prerelease = inspectPublishablePackage({ name: 'example', dir, pkg, entries: new Map(), packedFiles: expected, built: true });
  assert.ok(prerelease.warnings.some(x => x.code === 'PRERELEASE_VERSION'));
});

test('private optional peers are documented but do not block a public core tarball', t => {
  const { dir, pkg } = fixture(t);
  pkg.peerDependencies = { '@zeruxjs/queue': '0.1.0-alpha.1' };
  pkg.peerDependenciesMeta = { '@zeruxjs/queue': { optional: true } };
  const entries = new Map([['@zeruxjs/queue', { pkg: { private: true, version: '0.1.0-alpha.1' } }]]);
  const result = inspectPublishablePackage({ name: 'example', dir, pkg, entries, packedFiles: expected, built: true });
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some(x => x.code === 'OPTIONAL_PRIVATE_PEER'));
  pkg.peerDependenciesMeta['@zeruxjs/queue'].optional = false;
  const mandatory = inspectPublishablePackage({ name: 'example', dir, pkg, entries, packedFiles: expected, built: true });
  assert.ok(mandatory.errors.some(x => x.code === 'PRIVATE_DEPENDENCY'));
});
test('local dependency version skew is an error, even with non-wildcard semver', t => {
  const { dir, pkg } = fixture(t);
  pkg.dependencies = { zwatch: '0.3.0' };
  const entries = new Map([['zwatch', { pkg: { private: false, version: '0.0.1-alpha.2' } }]]);
  const result = inspectPublishablePackage({ name: 'example', dir, pkg, entries, packedFiles: expected, built: true });
  assert.ok(result.errors.some(x => x.code === 'WORKSPACE_VERSION_MISMATCH'));
});
