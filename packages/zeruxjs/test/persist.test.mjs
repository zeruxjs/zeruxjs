import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readRuntimeJson, writeRuntimeJson } from '../dist/bootstrap/persist.js';

test('atomic runtime metadata never follows symlinks; file permissions remain private', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zerux-state-'));
  try {
    const file = path.join(root, 'state.json');
    assert.deepEqual(readRuntimeJson(file, { absent: true }), { absent: true });
    writeRuntimeJson(file, { revision: 1 });
    writeRuntimeJson(file, { revision: 2 });
    assert.deepEqual(readRuntimeJson(file, {}), { revision: 2 });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const link = path.join(root, 'link.json');
    symlinkSync(file, link);
    assert.throws(() => readRuntimeJson(link, {}), /Unsafe/);
    assert.throws(() => writeRuntimeJson(link, { revision: 3 }), /Unsafe/);
    assert.deepEqual(readRuntimeJson(file, {}), { revision: 2 });
    writeFileSync(file, '{corrupt');
    assert.throws(() => readRuntimeJson(file, {}), /JSON/);
    assert.throws(() => writeRuntimeJson(file, { payload: 'x'.repeat(5_000_000) }), /exceeds/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
