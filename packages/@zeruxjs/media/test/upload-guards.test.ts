import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MediaStore,
  uploadMediaRequest,
  createMediaResponse,
} from '../dist/index.js';
/** Create isolated synthetic dependency/DOM/job state; the caller or callback owns documented teardown.
 * @param {function} fn - Fixture callback; operation-specific cleanup remains in the enclosing finally.
 * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
 */
async function fixture(fn) {
  /** Owned isolated temporary fixture directory, removed by the enclosing cleanup. */
  const root = await mkdtemp(join(tmpdir(), 'media-guard-'));
  /** Inert fixture disk-store configuration; operations own individual file handles. */
  const store = new MediaStore(root);
  try {
    await fn(store, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('stream declared length errors roll back before final metadata commit', () =>
  fixture(async (store, root) => {
    // Exercise the fixed synthetic cases or release only handles owned by this fixture.
    for (const [length, data] of [
      ['2', 'abc'],
      ['4', 'abc'],
    ]) {
      /** Synthetic Fetch request for the specific method/body/authorization case. */
      const req = new Request('https://example.test/upload', {
        method: 'POST',
        headers: { 'content-length': length },
        body: data,
      });
      await assert.rejects(uploadMediaRequest(store, req), /length mismatch/i);
      assert.deepEqual(await readdir(root), []);
    }
    /** Synthetic Fetch request for the specific method/body/authorization case. */
    const req = new Request('https://example.test/upload', {
      method: 'PUT',
      body: 'abc',
    });
    /** Fixture media facade or native element; ownership is explicit in this test. */
    const media = await uploadMediaRequest(store, req);
    assert.equal(media.size, 3);
    assert.equal((await store.list()).length, 1);
  }));
test('inline display allows inert content types but forces unknown HTML to download', () =>
  fixture(async (store) => {
    /** Synthetic untrusted HTML bytes; inline policy must not turn them into executable content. */
    const html = await store.upload(Buffer.from('<script>oops</script>'), {
      name: 'index.html',
      contentType: 'text/html',
    });
    /** Synthetic/native response whose body is explicitly consumed or cancelled by the fixture. */
    const response = await createMediaResponse(store, html.id, {
      inline: true,
    });
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    await response.body?.cancel();
    /** Synthetic declared PNG content used for the fixed inline MIME allowlist. */
    const png = await store.upload(Buffer.from('PNG'), {
      name: 'image.png',
      contentType: 'image/png',
    });
    /** Observed inline response; declared MIME is not decoding/antivirus certification. */
    const inline = await createMediaResponse(store, png.id, {
      inline: true,
      request: new Request('https://example.test/image'),
    });
    assert.match(inline.headers.get('content-disposition'), /^inline;/);
    await inline.body?.cancel();
  }));
