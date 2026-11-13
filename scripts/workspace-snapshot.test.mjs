import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCleanWorkspaceSnapshot } from './workspace-snapshot.mjs';

/** Perform the fixture operation.
 * @param {unknown} t - Input value for t.
 * @returns {unknown} Result produced by fixture.
 */
function fixture(t) {
  /** Local value for base. */
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-snapshot-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  /** Local value for src. */
  const src = path.join(base, 'source');
  /** Local value for dest. */
  const dest = path.join(base, 'clean');
  /**
   * Run the write callback.
   * @param {unknown} rel - Input value for rel.
   * @param {unknown} data - Input value for data.
   * @returns {unknown} Result produced by write.
   */
  const write = (rel, data = 'source') => {
    /** Local value for p. */
    const p = path.join(src, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };
  write('package.json', '{}');
  write('package-lock.json', '{}');
  return { src, dest, write };
}

test('clean workspace snapshot includes application, config, route assets, package tests and scripts', (t) => {
  /** Local value for destructured values. */
  const { src, dest, write } = fixture(t);
  for (const f of [
    'app/api/health.ts',
    'zerux.config.ts',
    'tsconfig.json',
    'public/admin/index.html',
    'packages/zeruxjs/test/main.test.mjs',
    'scripts/workspace-lock.mjs',
    'tests/integration/db.test.mjs',
  ]) {
    write(f);
  }
  /** Local value for copied. */
  const copied = createCleanWorkspaceSnapshot(src, dest);
  assert.equal(copied.copiedFiles, 9);
  for (const f of [
    'app/api/health.ts',
    'zerux.config.ts',
    'tsconfig.json',
    'public/admin/index.html',
    'packages/zeruxjs/test/main.test.mjs',
    'scripts/workspace-lock.mjs',
    'tests/integration/db.test.mjs',
  ]) {
    assert.ok(fs.existsSync(path.join(dest, f)), f);
  }
});

test('clean snapshot excludes secrets, outputs, symlinks and caches without modifying source', (t) => {
  /** Local value for destructured values. */
  const { src, dest, write } = fixture(t);
  write('.env', 'SECRET');
  write('.env.local', 'SECRET');
  write('.env.example', 'EXAMPLE');
  write('.npmrc', '//registry.npmjs.org/:_authToken=SECRET');
  write('.netrc', 'machine example.com login x password secret');
  write('packages/test/dist/index.js');
  write('packages/test/src/index.ts');
  write('node_modules/package/index.js');
  write('.git/config');
  write('coverage/data');
  write('tsconfig.tsbuildinfo');
  fs.symlinkSync(path.join(src, '.env'), path.join(src, 'secret-alias'));
  /** Local value for copied. */
  const copied = createCleanWorkspaceSnapshot(src, dest);
  assert.equal(copied.copiedFiles, 4);
  for (const excluded of [
    '.env',
    '.env.local',
    '.npmrc',
    '.netrc',
    'packages/test/dist/index.js',
    'node_modules/package/index.js',
    '.git/config',
    'coverage/data',
    'tsconfig.tsbuildinfo',
    'secret-alias',
  ]) {
    assert.equal(fs.existsSync(path.join(dest, excluded)), false, excluded);
  }
  assert.equal(fs.readFileSync(path.join(src, '.env'), 'utf8'), 'SECRET');
  assert.equal(
    fs.readFileSync(path.join(dest, '.env.example'), 'utf8'),
    'EXAMPLE'
  );
});

test('snapshot rejects destination within source and missing lockfile', (t) => {
  /** Local value for destructured values. */
  const { src, dest } = fixture(t);
  assert.throws(
    () => createCleanWorkspaceSnapshot(src, path.join(src, 'clean')),
    /outside/
  );
  fs.rmSync(path.join(src, 'package-lock.json'));
  assert.throws(() => createCleanWorkspaceSnapshot(src, dest), /package-lock/);
});
