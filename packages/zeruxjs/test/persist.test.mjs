import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readRuntimeJson,
  writeRuntimeJson,
} from '../dist/bootstrap/persist.js';

test('atomic runtime metadata never follows symlinks; file permissions remain private', () => {
  /** Isolated private metadata directory removed even when an assertion fails. */
  const root = mkdtempSync(path.join(os.tmpdir(), 'zerux-state-'));
  try {
    /** Fixture metadata path used to verify atomic replacement and permission policy. */
    const file = path.join(root, 'state.json');
    assert.deepEqual(readRuntimeJson(file, { absent: true }), { absent: true });
    writeRuntimeJson(file, { revision: 1 });
    writeRuntimeJson(file, { revision: 2 });
    assert.deepEqual(readRuntimeJson(file, {}), { revision: 2 });
    /** Symlink fixture that must never redirect metadata reads or writes. */
    const link = path.join(root, 'link.json');
    symlinkSync(file, link);
    assert.throws(() => readRuntimeJson(link, {}), /Unsafe/);
    assert.throws(() => writeRuntimeJson(link, { revision: 3 }), /Unsafe/);
    assert.deepEqual(readRuntimeJson(file, {}), { revision: 2 });
    writeFileSync(file, '{corrupt');
    assert.throws(() => readRuntimeJson(file, {}), /JSON/);
    assert.throws(
      () => writeRuntimeJson(file, { payload: 'x'.repeat(5_000_000) }),
      /exceeds/
    );
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Existing buggy double-encoded snapshots must not prevent bounded replacement.
test('oversized prior metadata can be replaced without reading it; repeated snapshots stay objects', () => {
  /** Isolated private metadata directory removed even when an assertion fails. */
  const root = mkdtempSync(path.join(os.tmpdir(), 'zerux-state-recovery-'));
  try {
    /** Fixture metadata path used to verify atomic replacement and permission policy. */
    const file = path.join(root, 'dev.json');
    writeFileSync(file, JSON.stringify('x'.repeat(5_000_000)), { mode: 0o600 });
    for (let generation = 1; generation <= 10; generation++) {
      writeRuntimeJson(file, { appName: 'fixture', reload: { generation } });
      assert.deepEqual(readRuntimeJson(file, {}), {
        appName: 'fixture',
        reload: { generation },
      });
      assert.ok(statSync(file).size < 128);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
