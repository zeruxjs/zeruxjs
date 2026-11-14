import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readLimitedBody, localDevHost } from '../dist/request.js';
test('local authority parsing rejects crafted hosts', () => {
  assert.equal(localDevHost('localhost:3000'), true);
  assert.equal(localDevHost('[::1]:3000'), true);
  for (const host of [
    'localhost@evil.com',
    'localhost/path',
    'evil-localhost',
    '',
  ]) {
    assert.equal(localDevHost(host), false);
  }
});
test('body reader enforces limit, accepts empty body', async () => {
  /** Owned readable fixture providing exactly the accepted request byte budget. */
  const a = new PassThrough();
  /** Pending bounded read resolved only after the fixture emits end. */
  const accepted = readLimitedBody(a, 3);
  a.end('abc');
  assert.equal((await accepted).toString(), 'abc');
  /** Owned readable fixture exceeding its declared aggregate body limit. */
  const b = new PassThrough();
  /** Expected read rejection attached before destroying the oversized source. */
  const rejected = readLimitedBody(b, 2);
  b.write('abc');
  await assert.rejects(rejected, (error) => error.statusCode === 413);
  b.destroy();
});
