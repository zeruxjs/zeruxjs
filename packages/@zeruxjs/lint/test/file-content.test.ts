import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  unlink,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readLintSource, writeLintSource } from '../dist/file-content.js';
test('explicit lint fixes reject replacement links and concurrent source changes', async () => {
  /** Owned synthetic fixture directory or resolved package root used by the following checks. */
  const root = await mkdtemp(path.join(tmpdir(), 'lint-file-'));
  try {
    /** Owned synthetic input path used for bounded source and no-write checks. Owned comparison file whose contents must survive a replacement symlink attempt. */
    const file = path.join(root, 'source.css'),
      other = path.join(root, 'other');
    await writeFile(file, 'a{}');
    await writeFile(other, 'retain');
    /** Descriptor-read fixture bytes used as the expected revision before an explicit fix. */
    const original = await readLintSource(file);
    await writeLintSource(file, original, 'a { color: red; }');
    assert.equal(await readFile(file, 'utf8'), 'a { color: red; }');
    await assert.rejects(writeLintSource(file, original, 'wrong'), /changed/);
    await unlink(file);
    await symlink(other, file);
    await assert.rejects(writeLintSource(file, 'retain', 'wrong'));
    assert.equal(await readFile(other, 'utf8'), 'retain');
    await assert.rejects(readLintSource(other, 1), /size/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
