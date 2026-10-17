import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readLimitedBody, localDevHost } from '../dist/request.js';
test('local authority parsing rejects crafted hosts', () => {
  assert.equal(localDevHost('localhost:3000'), true);
  assert.equal(localDevHost('[::1]:3000'), true);
  for (const host of ['localhost@evil.com','localhost/path','evil-localhost','']) assert.equal(localDevHost(host), false);
});
test('body reader enforces limit, accepts empty body', async () => {
  const a = new PassThrough(); const accepted = readLimitedBody(a, 3); a.end('abc');
  assert.equal((await accepted).toString(), 'abc');
  const b = new PassThrough(); const rejected = readLimitedBody(b, 2); b.write('abc');
  await assert.rejects(rejected, error => error.statusCode === 413);
  b.destroy();
});
