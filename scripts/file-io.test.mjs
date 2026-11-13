import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import fileIO from './file-io.cjs';
test('tool reads are bounded and no-follow; log reset replaces a link without changing its target', async () => {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zerux-file-io-'));
  try {
    /** Local value for target. */
    const target = path.join(root, 'target'),
      link = path.join(root, 'log');
    fs.writeFileSync(target, 'retained');
    fs.symlinkSync(target, link);
    assert.throws(() => fileIO.readRegularFileSync(link));
    await assert.rejects(fileIO.readRegularFile(link));
    assert.throws(() => fileIO.readRegularFileSync(target, 2), /oversized/);
    assert.equal(
      (await fileIO.readRegularFile(target, 32)).toString(),
      'retained'
    );
    /** Local value for fd. */
    const fd = fileIO.resetLogFileSync(link);
    try {
      fs.writeFileSync(fd, 'new log');
    } finally {
      fs.closeSync(fd);
    }
    assert.equal(fileIO.readRegularFileSync(target).toString(), 'retained');
    assert.equal(fileIO.readRegularFileSync(link).toString(), 'new log');
    assert.equal(fs.statSync(link).mode & 0o077, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
