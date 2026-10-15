import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverWorkspaces, planWorkspaces, executeWorkspacePlan } from './workspace-graph.mjs';
import { parseBuildOptions, runWorkspaceBuild, verifyWorkspaceArtifacts, runNpmWorkspaceBuild } from './workspace-build.mjs';

function fixture(defs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-workspaces-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  for (const [name, deps] of Object.entries(defs)) {
    const dir = path.join(root, 'packages', name); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, scripts: { build: 'echo built' }, main: './dist/index.js', dependencies: Object.fromEntries(deps.map(dep => [dep, '*'])) }));
  }
  return { root, entries: discoverWorkspaces(root), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('dependency planning respects local workspace relationships', () => {
  const f = fixture({ base: [], ui: ['base'], app: ['ui'], other: [] });
  try {
    const plan = planWorkspaces(f.entries, { scopes: ['app'] });
    assert.deepEqual(plan.ordered, ['base', 'ui', 'app']);
    assert.deepEqual(planWorkspaces(f.entries, { scopes: ['base'], includeDependents: true }).ordered, ['base', 'ui', 'app']);
  } finally { f.close(); }
});

test('cycles and unknown scopes produce actionable errors', () => {
  const f = fixture({ first: ['second'], second: ['first'] });
  try { assert.throws(() => planWorkspaces(f.entries), /cycle/); }
  finally { f.close(); }
  const other = fixture({ first: [] });
  try { assert.throws(() => planWorkspaces(other.entries, { scopes: ['nope'] }), /Unknown workspace/); }
  finally { other.close(); }
});

test('parallel scheduler never builds a dependent before dependencies finish', async () => {
  const f = fixture({ base: [], ui: ['base'], app: ['ui'], other: [] });
  try {
    const done = new Set(), started = [];
    await executeWorkspacePlan(planWorkspaces(f.entries), {
      concurrency: 3,
      run: async name => {
        if (name === 'app') assert.ok(done.has('ui'));
        if (name === 'ui') assert.ok(done.has('base'));
        started.push(name);
        await new Promise(resolve => setTimeout(resolve, 2)); done.add(name);
      }
    });
    assert.equal(started.length, 4);
  } finally { f.close(); }
});

test('failed dependency cancels builds and never launches dependents', async () => {
  const f = fixture({ base: [], ui: ['base'], app: ['ui'], other: [] });
  try {
    const started = [];
    await assert.rejects(executeWorkspacePlan(planWorkspaces(f.entries), {
      concurrency: 2, run: async name => { started.push(name); if (name === 'base') throw Error('compile failed'); }
    }), /base.*compile failed/);
    assert.ok(!started.includes('ui')); assert.ok(!started.includes('app'));
  } finally { f.close(); }
});

test('dry run does not run build commands and CLI options are strictly validated', async () => {
  const f = fixture({ alpha: [] });
  try {
    const result = await runWorkspaceBuild(f.root, { ...parseBuildOptions(['--dry-run', '--scope', 'alpha', '--concurrency', '2']) }, { run: () => { throw Error('must not run'); } });
    assert.deepEqual(result.planned, ['alpha']);
    assert.deepEqual(result.completed, []);
    assert.throws(() => parseBuildOptions(['--something']), /Unknown/);
    assert.throws(() => parseBuildOptions(['--concurrency', '0']), /Concurrency/);
  } finally { f.close(); }
});

test('artifact verification checks declared entrypoints', () => {
  const f = fixture({ alpha: [] });
  try {
    assert.match(verifyWorkspaceArtifacts(f.entries, ['alpha'])[0], /alpha.*dist\/index\.js/);
    fs.mkdirSync(path.join(f.root, 'packages/alpha/dist'));
    fs.writeFileSync(path.join(f.root, 'packages/alpha/dist/index.js'), '');
    assert.deepEqual(verifyWorkspaceArtifacts(f.entries, ['alpha']), []);
  } finally { f.close(); }
});

test('export map verification includes subpath declarations, not only main', () => {
  const f = fixture({ alpha: [] });
  try {
    const item = f.entries.get('alpha');
    item.pkg.exports = { '.': { import: './dist/index.js' }, './extras': { types: './dist/extra.d.ts', default: './dist/extra.js' } };
    fs.mkdirSync(path.join(f.root, 'packages/alpha/dist'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'packages/alpha/dist/index.js'), '');
    const result = verifyWorkspaceArtifacts(f.entries, ['alpha']);
    assert.ok(result.some(item => item.includes('extra.d.ts')));
    assert.ok(result.some(item => item.includes('extra.js')));
  } finally { f.close(); }
});


test('build CLI validates finite per-package timeout', () => {
  assert.equal(parseBuildOptions(['--timeout-ms', '3500']).timeoutMs, 3500);
  assert.throws(() => parseBuildOptions(['--timeout-ms', 'abc']), /timeout/);
  assert.throws(() => parseBuildOptions(['--timeout-ms', '0']), /timeout/);
  assert.throws(() => parseBuildOptions(['--timeout-ms', '3600001']), /timeout/);
});

test('hung npm workspace build times out with a diagnostic and terminates', async t => {
  const f = fixture({ alpha: [] });
  try {
    const manifestPath = path.join(f.root, 'packages/alpha/package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.scripts.build = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    await assert.rejects(runNpmWorkspaceBuild(f.root, 'alpha', undefined, 400), /Build timed out/);
  } finally { f.close(); }
});


test('export verification rejects symlinked generated entrypoints', t => {
  const f = fixture({ alpha: [] });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-external-build-'));
  try {
    fs.mkdirSync(path.join(f.root, 'packages/alpha/dist'), { recursive: true });
    const destination = path.join(outside, 'external.js');
    fs.writeFileSync(destination, 'export {}');
    try { fs.symlinkSync(destination, path.join(f.root, 'packages/alpha/dist/index.js')); }
    catch (error) { if (error.code === 'EPERM') return t.skip('Platform disallows test symlinks'); throw error; }
    assert.ok(verifyWorkspaceArtifacts(f.entries, ['alpha']).some(x => x.includes('dist/index.js')));
  } finally { f.close(); fs.rmSync(outside, { recursive: true, force: true }); }
});
