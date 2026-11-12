import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMediaStore,
  createSignedMediaToken,
  verifySignedMediaToken,
} from '../dist/index.js';
test('streamed uploads, integrity, expiry cleanup and metadata', async () => {
  /** Owned isolated disk fixture directory, removed after the test settles. */
  const dir = await mkdtemp(join(tmpdir(), 'zerux-media-'));
  try {
    /** Inert fixture disk-store configuration; operations own individual file handles. */
    const store = createMediaStore(dir, 100);
    /** Synthetic stored metadata used to assert byte/HTTP behavior. */
    const meta = await store.uploadStream(
      (async function* () {
        yield Buffer.from('abc');
        yield Buffer.from('123');
      })(),
      { name: 'test.txt', contentType: 'text/plain' }
    );
    assert.equal(meta.size, 6);
    assert.equal((await store.download(meta.id)).data.toString(), 'abc123');
    assert.equal((await store.list()).length, 1);
    assert.equal(await store.exists(meta.id), true);
    let streamed = '';
    // Exercise the fixed synthetic cases or release only handles owned by this fixture.
    for await (const chunk of store.stream(meta.id)) {
      streamed += chunk.toString();
    }
    assert.equal(streamed, 'abc123');
    await assert.rejects(
      () =>
        store.uploadStream([Buffer.from('123456')], {
          name: 'too-big.txt',
          contentType: 'text/plain',
          maxBytes: 3,
        }),
      RangeError
    );
    /** Synthetic expiring metadata, distinct from persistent session ownership. */
    const exp = await store.upload(Buffer.from('x'), {
      name: 'exp',
      contentType: 'text/plain',
      expiresInMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(await store.exists(exp.id), false);
    /** Observed explicit cleanup scan/removal counts for synthetic records only. */
    const cleanup = await store.cleanupExpired();
    assert.equal(cleanup.removed, 1);
    await store.remove(meta.id);
    assert.equal(await store.exists(meta.id), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('signed tokens detect tampering and expiration', async () => {
  /** Opaque synthetic ID or fixed protocol request ID, not tenant authorization. */
  const id = '0c949a20-8e3c-42fe-a108-889114145172';
  /** Synthetic test-only signing material; never an operator/application secret. */
  const secret = 'secret-with-at-least-16-characters';
  /** Synthetic signed media token used only for expiry/tamper assertions. */
  const token = createSignedMediaToken(id, secret, Date.now() + 50000);
  assert.equal(verifySignedMediaToken(token, secret), id);
  assert.equal(verifySignedMediaToken(token.slice(0, -2) + 'ab', secret), null);
  assert.equal(verifySignedMediaToken(token, secret, Date.now() + 60000), null);
});
