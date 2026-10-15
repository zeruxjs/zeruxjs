import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, lstatSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { readJsonFile, writeJsonFile } from '../dist/fs.js';
import { injectDevClient } from '../dist/inject.js';
import { readTailLines } from '../dist/state.js';

test('private atomic devtools state never follows an existing symlink', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'z-dev-state-'));
  try {
    const file = path.join(dir, 'snapshot.json');
    writeJsonFile(file, { live: 1 });
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readJsonFile(file, {}), { live: 1 });
    assert.deepEqual(readJsonFile(path.join(dir, 'missing'), { missing: true }), { missing: true });
    const target = path.join(dir, 'target.json');
    writeFileSync(target, '{"safe":true}');
    const link = path.join(dir, 'link.json');
    symlinkSync(target, link);
    assert.throws(() => writeJsonFile(link, { unsafe: true }), /Unsafe/);
    assert.throws(() => readJsonFile(link, {}), /Unsafe/);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { safe: true });
    assert.throws(() => writeJsonFile(file, { huge: 'x'.repeat(5_000_000) }), /exceeds/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('log tail is bounded and does not load the entire file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'z-dev-tail-'));
  try {
    const file = path.join(dir, 'app.log');
    writeFileSync(file, 'first\n' + ('long line\n').repeat(35000) + 'last\n');
    assert.deepEqual(readTailLines(file, 1), ['last']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('injection escapes script ending, quotes and Unicode separators; is idempotent', () => {
  const injected = injectDevClient('<BODY><h1>Hello</h1></BODY>', {
    routeName: "</script><script>alert(1)</script>'\\\u2028",
    serviceName: "s'evil", devServerUrl: 'http://127.0.0.1:9000',
    allowedDevDomain: null, devPortLessAlias: { value: null }
  });
  assert.equal((injected.match(/<script\b/gi) ?? []).length, 1);
  assert.ok(!injected.includes('</script><script>alert'));
  const script = injected.match(/<script[^>]*>([\s\S]*?)<\/script>/i)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.equal(injectDevClient(injected, { routeName: 'x', serviceName: 'z', devServerUrl: 'https://a', devPortLessAlias: {value: false} }), injected);
});
