import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  lstatSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { readJsonFile, writeJsonFile } from '../dist/fs.js';
import { injectDevClient } from '../dist/inject.js';
import { readTailLines } from '../dist/state.js';

test('private atomic devtools state never follows an existing symlink', () => {
  /** Isolated private state/log directory removed after each boundary assertion. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zforge-state-'));
  try {
    /** Owned fixture state or log file used for descriptor and bounded-tail checks. */
    const file = path.join(dir, 'snapshot.json');
    writeJsonFile(file, { live: 1 });
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readJsonFile(file, {}), { live: 1 });
    assert.deepEqual(
      readJsonFile(path.join(dir, 'missing'), { missing: true }),
      { missing: true }
    );
    /** Separate private JSON target that linked writes and reads must leave untouched. */
    const target = path.join(dir, 'target.json');
    writeFileSync(target, '{"safe":true}');
    /** Forbidden symlink leaf used to prove state operations never follow it. */
    const link = path.join(dir, 'link.json');
    symlinkSync(target, link);
    assert.throws(() => writeJsonFile(link, { unsafe: true }), /Unsafe/);
    assert.throws(() => readJsonFile(link, {}), /Unsafe/);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { safe: true });
    assert.throws(
      () => writeJsonFile(file, { huge: 'x'.repeat(5_000_000) }),
      /exceeds/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('log tail is bounded and does not load the entire file', () => {
  /** Isolated private state/log directory removed after each boundary assertion. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zforge-tail-'));
  try {
    /** Owned fixture state or log file used for descriptor and bounded-tail checks. */
    const file = path.join(dir, 'app.log');
    writeFileSync(file, 'first\n' + 'long line\n'.repeat(35000) + 'last\n');
    assert.deepEqual(readTailLines(file, 1), ['last']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injection escapes script ending, quotes and Unicode separators; is idempotent', () => {
  /** Generated development markup carrying deliberately hostile bootstrap data. */
  const injected = injectDevClient('<BODY><h1>Hello</h1></BODY>', {
    routeName: "</script><script>alert(1)</script>'\\\u2028",
    serviceName: "s'evil",
    devServerUrl: 'http://127.0.0.1:9000',
    allowedDevDomain: null,
    devPortLessAlias: { value: null },
  });
  assert.equal((injected.match(/<script\b/gi) ?? []).length, 1);
  assert.ok(!injected.includes('</script><script>alert'));
  // The producer emits fixed canonical delimiters; this extracts its owned
  // script for a syntax check, rather than treating a regex as an HTML parser.
  /** Offset of the producer-owned script delimiter; this is not a general HTML parser. */
  const opening = injected.indexOf('<script');
  /** Start of the known producer script body used only for a syntax check. */
  const start = injected.indexOf('>', opening) + 1;
  /** Final known producer closing-script delimiter checked before extraction. */
  const end = injected.lastIndexOf('</script>');
  assert.ok(opening >= 0 && start > opening && end >= start);
  /** Fixed framework-authored client program syntax checked without executing remote data. */
  const script = injected.slice(start, end);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.equal(
    injectDevClient(injected, {
      routeName: 'x',
      serviceName: 'z',
      devServerUrl: 'https://a',
      devPortLessAlias: { value: false },
    }),
    injected
  );
});

test('script-ending variants in bootstrap data remain escaped inside the owned script', () => {
  for (const routeName of [
    '</ScRiPt\t\n bar><script>alert(1)</script>',
    '</script data-x="value"><script>alert(2)</script>',
  ]) {
    /** Generated development markup carrying deliberately hostile bootstrap data. */
    const injected = injectDevClient('<body><h1>Known document</h1></body>', {
      routeName,
      serviceName: 'fixture',
      devServerUrl: 'http://127.0.0.1:9000',
      allowedDevDomain: null,
      devPortLessAlias: { value: null },
    });
    assert.equal((injected.match(/<script\b/gi) ?? []).length, 1);
    /** Start of the known producer script body used only for a syntax check. */
    const start = injected.indexOf('>', injected.indexOf('<script')) + 1;
    /** Final known producer closing-script delimiter checked before extraction. */
    const end = injected.lastIndexOf('</script>');
    assert.ok(start > 0 && end > start);
    assert.doesNotThrow(() => new vm.Script(injected.slice(start, end)));
  }
});
