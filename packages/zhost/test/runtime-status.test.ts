import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createRuntimeStatusWriter,
  listRuntimeStatus,
} from '../dist/portless/runtime-status.js';

/** Synthetic current-process diagnostic snapshot; no operator runtime is managed. */
const status = {
  phase: 'running',
  pid: process.pid,
  generation: 2,
  automaticRestarts: 1,
  lastExit: null,
  updatedAt: new Date().toISOString(),
};

test('writes private atomic status snapshots and validates live owner identity', () => {
  /** Owned private temporary diagnostic root removed after assertions. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-status-'));
  try {
    /** Diagnostic writer bound to this fixture process and unique private record. */
    const write = createRuntimeStatusWriter(dir, 'api.localhost');
    write(status);
    /** Detached inspected fixture records, including separately observed process liveness. */
    const rows = listRuntimeStatus(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hostname, 'api.localhost');
    assert.equal(rows[0].alive, true);
    assert.equal(rows[0].status.generation, 2);
    assert.deepEqual(listRuntimeStatus(dir, 'missing.localhost'), []);
    write({ ...status, phase: 'stopped', pid: null });
    assert.equal(listRuntimeStatus(dir)[0].alive, false);
    assert.throws(() => listRuntimeStatus(dir, '../bad'), /hostname/);
    assert.throws(
      () => createRuntimeStatusWriter(dir, '../../../bad'),
      /hostname/
    );
    /** Synthetic per-user diagnostic subdirectory selected for permission/symlink assertions. */
    const sub = fs.readdirSync(dir).find((x) => x.startsWith('app-status-'));
    /** Fixture record filenames used to prove updates replace one candidate rather than accumulating records. */
    const files = fs.readdirSync(path.join(dir, sub));
    assert.equal(
      files.length,
      1,
      'snapshots overwrite atomically instead of accumulating per update'
    );
    assert.equal(
      fs.statSync(path.join(dir, sub, files[0])).mode & 0o777,
      0o600
    );
    assert.equal(fs.statSync(path.join(dir, sub)).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects symlinked status directories and ignores invalid status records', () => {
  /** Owned private temporary diagnostic root removed after assertions. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-status-symlink-'));
  try {
    /** Synthetic sibling directory used only to construct a rejected symlink fixture. */
    const external = path.join(dir, 'external');
    fs.mkdirSync(external);
    /** Synthetic per-user diagnostic subdirectory selected for permission/symlink assertions. */
    const sub = path.join(
      dir,
      `app-status-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`
    );
    fs.symlinkSync(external, sub);
    assert.throws(
      () => createRuntimeStatusWriter(dir, 'demo.localhost'),
      /Unsafe/
    );
    assert.throws(() => listRuntimeStatus(dir), /Unsafe/);
    fs.unlinkSync(sub);
    fs.mkdirSync(sub, { mode: 0o700 });
    fs.writeFileSync(
      path.join(sub, 'aaaaaaaaaaaaaaaa-12-aaaaaaaaaaaaaaaa.json'),
      '{ invalid json'
    );
    assert.deepEqual(listRuntimeStatus(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
