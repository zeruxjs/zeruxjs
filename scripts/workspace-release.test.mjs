import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finalizeWorkspaceRelease, RELEASE_STEPS } from './workspace-release.mjs';
import { writePublicApiFreeze } from './workspace-api-freeze.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'packages', 'pkg');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const manifest = {
    name: 'release-fixture', version: '1.0.0', license: 'MIT',
    type: 'module', workspaces: ['packages/*'],
    scripts: { build: 'echo build' },
  };
  const pkg = { name: '@test/pkg', version: '1.0.0', main: './src/index.js', license: 'MIT' };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'export default 1;\n');
  const packages = {
    '': { name: manifest.name, version: manifest.version, license: 'MIT', workspaces: manifest.workspaces },
    'packages/pkg': { name: pkg.name, version: pkg.version, license: 'MIT' },
    'node_modules/@test/pkg': { resolved: 'packages/pkg', link: true },
  };
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  writePublicApiFreeze(root);
  return root;
}

test('release gate runs dependency install, clean install, 42-style workspace build, tests then commits lockfile', t => {
  const root = fixture(t);
  const original = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const events = [];
  const result = finalizeWorkspaceRelease(root, {
    onStep: name => events.push(name),
    run(step, cwd) {
      assert.ok(fs.existsSync(path.join(cwd, 'packages/pkg/src/index.js')));
      if (step.args[0] === 'install') {
        // Simulate a valid npm-resolved lockfile change in the isolated checkout.
        const lockPath = path.join(cwd, 'package-lock.json');
        const json = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        json.npmResolved = true;
        fs.writeFileSync(lockPath, JSON.stringify(json, null, 2) + '\n');
      }
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.lockfileWritten, true);
  assert.deepEqual(events, RELEASE_STEPS.map(step => step.name));
  assert.notEqual(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).npmResolved, true);
});

test('release gate leaves original lockfile untouched after a build failure', t => {
  const root = fixture(t);
  const lockPath = path.join(root, 'package-lock.json');
  const original = fs.readFileSync(lockPath, 'utf8');
  assert.throws(() => finalizeWorkspaceRelease(root, {
    run(step) { if (step.name === 'Build all workspaces') throw new Error('compiler failed'); },
  }), /compiler failed/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), original);
});

test('release gate fails closed if install alters a workspace manifest', t => {
  const root = fixture(t);
  const original = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  assert.throws(() => finalizeWorkspaceRelease(root, {
    run(step, cwd) {
      if (step.args[0] === 'install') {
        const file = path.join(cwd, 'packages/pkg/package.json');
        const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
        obj.version = '9.9.9';
        fs.writeFileSync(file, JSON.stringify(obj));
      }
    },
  }), /workspace manifest/);
  assert.equal(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), original);
});

test('release gate can verify without copying lockfile back', t => {
  const root = fixture(t);
  const file = path.join(root, 'package-lock.json');
  const original = fs.readFileSync(file, 'utf8');
  const result = finalizeWorkspaceRelease(root, {
    writeLock: false,
    run(step, cwd) {
      if (step.args[0] === 'install') {
        const staged = path.join(cwd, 'package-lock.json');
        fs.appendFileSync(staged, '\n');
      }
    },
  });
  assert.equal(result.lockfileWritten, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('release gate checks all package source contracts before install', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'packages/pkg/src/index.js'));
  assert.throws(() => finalizeWorkspaceRelease(root, { run() { throw new Error('should not run'); } }), /Source package exports/);
});


test('release gate fails fast on registry connectivity without mutating source lockfile', t => {
  const root = fixture(t);
  const lock = path.join(root, 'package-lock.json');
  const original = fs.readFileSync(lock, 'utf8');
  const observed = [];
  assert.throws(() => finalizeWorkspaceRelease(root, {
    run(step) {
      observed.push(step.name);
      if (step.name === 'Check npm registry connectivity') throw new Error('registry unavailable');
      throw new Error('later steps must not run');
    },
  }), /registry unavailable/);
  assert.deepEqual(observed, ['Check npm registry connectivity']);
  assert.equal(fs.readFileSync(lock, 'utf8'), original);
});

test('release fails closed on public API drift before invoking registry or install', t => {
 const root=fixture(t); const file=path.join(root,'packages/pkg/package.json');
 const pkg=JSON.parse(fs.readFileSync(file,'utf8')); pkg.exports={'.':'./src/next.js'}; fs.writeFileSync(file,JSON.stringify(pkg)); fs.writeFileSync(path.join(root,'packages/pkg/src/next.js'),'export default 2;');
 assert.throws(()=>finalizeWorkspaceRelease(root,{run(){throw new Error('should not run');}}),/API freeze/);
});
