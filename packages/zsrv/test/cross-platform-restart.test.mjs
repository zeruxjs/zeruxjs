import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProcessMarker, writeProcessMarker, stopMarkedProcess, processIdentityForPlatform, parseProcessMarker } from '../dist/portless/lifecycle.js';

test('identity retrieval rejects unsupported platforms and invalid process IDs', () => {
  assert.equal(processIdentityForPlatform(0, process.platform), null);
  assert.equal(processIdentityForPlatform(process.pid, 'freebsd'), null);
  if (process.platform === 'linux') assert.match(processIdentityForPlatform(process.pid, 'linux'), /^linux:\d+$/);
});

test('marker format accepts macOS and Windows creation fingerprints', () => {
  const original = createProcessMarker();
  for (const identity of ['darwin:2026-10-10T00:00:00.000Z', 'win32:2026-10-10T00:00:00.000Z']) {
    assert.equal(parseProcessMarker(JSON.stringify({...original, identity}))?.identity, identity);
  }
  assert.equal(parseProcessMarker(JSON.stringify({...original, identity: 'win32:malformed'})), null);
});

test('bad stop timing cannot signal a marked process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-options-'));
  try {
    const markerFile = path.join(dir, 'proxy.pid');
    writeProcessMarker(markerFile, createProcessMarker());
    for (const waitMs of [-1, Number.NaN, Infinity, 300001]) {
      await assert.rejects(stopMarkedProcess(markerFile, async () => true, { waitMs }), RangeError);
      assert.equal(fs.existsSync(markerFile), true);
    }
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
