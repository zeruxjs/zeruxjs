import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createZeruxProject } from '../dist/index.js';
import { runZcli } from '../dist/bin.js';

test('generates JavaScript starter in new directory with smoke test and refuses overwrite', () => {
  /** Owned temporary starter parent removed in finally. */
  const root = mkdtempSync(join(tmpdir(), 'zclivo-scaffold-'));
  /** New exclusive synthetic project directory; existing targets must reject. */
  const dir = join(root, 'demo-js');
  try {
    /** Explicit minimal starter write receipt checked before running its synthetic smoke test. */
    const result = createZeruxProject(dir, { language: 'javascript' });
    assert.equal(result.created, true);
    assert.ok(result.files.includes('tests/smoke.test.mjs'));
    assert.equal(
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).private,
      true
    );
    assert.ok(
      readFileSync(join(dir, 'zerux.config.mjs'), 'utf8').includes('type')
    );
    execFileSync(process.execPath, ['--test', 'tests/smoke.test.mjs'], {
      cwd: dir,
      stdio: 'pipe',
    });
    assert.throws(() => createZeruxProject(dir), /already exists/);
    assert.ok(existsSync(join(dir, 'src/index.mjs')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('TypeScript starter and dry-run do not create files and JS CLI validates flags', () => {
  /** Owned temporary starter parent removed in finally. */
  const root = mkdtempSync(join(tmpdir(), 'zclivo-scaffold-'));
  /** New exclusive synthetic project directory; existing targets must reject. */
  const dir = join(root, 'demo-ts');
  /** Captured synthetic legacy CLI public output. */
  const messages = [];
  /** Captured synthetic legacy CLI failure output. */
  const errors = [];
  try {
    /** Dry-run receipt proving no destination has been created. */
    const planned = createZeruxProject(dir, { dryRun: true });
    assert.equal(planned.created, false);
    assert.equal(existsSync(dir), false);
    assert.equal(
      runZcli(
        ['create', dir, '--ts'],
        (s) => messages.push(s),
        (s) => errors.push(s)
      ),
      0
    );
    assert.ok(
      readFileSync(join(dir, 'tsconfig.json'), 'utf8').includes('NodeNext')
    );
    assert.equal(
      runZcli(
        ['create', dir],
        (s) => messages.push(s),
        (s) => errors.push(s)
      ),
      1
    );
    assert.equal(
      runZcli(
        ['create', dir, '--unknown'],
        () => {},
        () => {}
      ),
      2
    );
    assert.throws(
      () => createZeruxProject(join(root, '.hidden')),
      /non-hidden/
    );
    assert.equal(errors.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('dangling symlink target is treated as occupied and never followed', () => {
  /** Owned temporary starter parent removed in finally. */
  const root = mkdtempSync(join(tmpdir(), 'zclivo-link-'));
  try {
    symlinkSync(join(root, 'nonexistent'), join(root, 'taken'));
    assert.throws(
      () => createZeruxProject(join(root, 'taken')),
      /already exists/
    );
    assert.equal(existsSync(join(root, 'nonexistent')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
