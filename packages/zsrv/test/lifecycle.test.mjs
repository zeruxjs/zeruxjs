import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePid, processExists, removeOwnedMarker } from '../dist/portless/lifecycle.js';

test('PID parser rejects malformed, zero and dangerous PID entries', () => {
  for (const entry of ['', '0', '1', '-1', '42oops', '2.5', '2\n3', '999999999999999999999']) assert.equal(parsePid(entry), null);
  assert.equal(parsePid(' 123\n'), 123);
  assert.equal(processExists(process.pid), true);
});
test('marker cleanup respects ownership and changed values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-lifecycle-'));
  const marker = path.join(dir, 'pid');
  try {
    fs.writeFileSync(marker, '20');
    assert.equal(removeOwnedMarker(marker, '21'), false);
    assert.equal(fs.readFileSync(marker, 'utf8'), '20');
    assert.equal(removeOwnedMarker(marker, '20'), true);
    assert.equal(removeOwnedMarker(marker, '20'), false);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
