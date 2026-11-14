import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAssetManager } from '@zeruxjs/asset-manager';
import { createAssetStorage } from '@zeruxjs/asset-manager/storage';
import { createFileManager, createLocalStorage } from '@zeruxjs/files';
import { createMediaAssetService } from '../dist/assets.js';
/** Synthetic explicit payload bytes; no real tenant content or remote files are used. */
const bytes = Buffer.from('hello');
/** Fixture SHA-256 helper/value used to assert byte integrity independently of authorization. */
const sha = createHash('sha256').update(bytes).digest('hex');
/** Explicit synthetic operation facts used to exercise validation and commit outcomes. */
const input = {
  asset: {
    id: 'document',
    name: 'Report',
    type: 'document',
    variants: { small: { url: 'https://cdn.test/secret?signature=PRIVATE' } },
  },
  size: 5,
  sha256: sha,
  contentType: 'text/plain',
};
/** Create isolated synthetic dependency/DOM/job state; the caller or callback owns documented teardown.
 * @param {function} fn - Fixture callback; operation-specific cleanup remains in the enclosing finally.
 * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
 */
async function fixture(fn) {
  /** Owned isolated temporary fixture directory, removed by the enclosing cleanup. */
  const root = await mkdtemp(join(tmpdir(), 'zx-media-assets-'));
  /** Fixture-owned local storage manager; close after its dependent media/journal work. */
  const files = createFileManager({
    stores: [{ name: 'disk', driver: createLocalStorage({ root }) }],
  });
  /** Isolated in-memory catalog with synthetic metadata only. */
  const catalog = createAssetManager();
  /** Fixture-owned asset adapter; close after the dependent media service drains. */
  const assets = createAssetStorage({
    catalog,
    files,
    namespace: 'media',
    location: () => ({ storage: 'disk', bucket: 'uploads' }),
    allowedTypes: ['text/plain'],
    authorize: (identity) => identity.tenant === 'tenant-a',
  });
  /** Fixture media facade or native element; ownership is explicit in this test. */
  const media = createMediaAssetService({
    assets,
    identify: (request) => ({
      tenant:
        request.headers.get('authorization') === 'Bearer allowed'
          ? 'tenant-a'
          : 'other',
      subject: 'user',
    }),
    authorizeRequest: (request) =>
      request.headers.get('authorization') === 'Bearer allowed',
  });
  try {
    await fn({ root, files, catalog, assets, media });
  } finally {
    try {
      await media.close();
    } finally {
      try {
        await assets.close();
      } finally {
        try {
          await files.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }
}
/** Synthetic Fetch request or fixed subprocess arguments; never operator credentials.
 * @param {BodyInit} body - Explicit synthetic request body.
 * @param {HeadersInit} headers - Synthetic verified-request headers.
 * @returns {unknown} Observed synthetic result; failures stay explicit to the enclosing assertion.
 */
const request = (body = bytes, headers = {}) =>
  new Request('https://media.test', {
    method: 'PUT',
    body,
    headers: {
      authorization: 'Bearer allowed',
      'content-type': 'text/plain',
      ...headers,
    },
  });
test('asset metadata is committed after integrity-checked bytes and request-facing metadata is redacted/authorized', () =>
  fixture(async ({ media, catalog, files }) => {
    /** Successful synthetic committed metadata receipt used by later assertions. */
    const stored = await media.upload(request(), input);
    assert.equal(catalog.size, 1);
    assert.equal(stored.size, 5);
    assert.deepEqual(stored.variants, ['small']);
    assert.doesNotMatch(
      JSON.stringify(stored),
      /PRIVATE|storage|bucket|\/secret/
    );
    await assert.rejects(
      media.metadata(new Request('https://media.test'), 'document'),
      { code: 'FORBIDDEN' }
    );
    /** Synthetic host authorization decision; no browser role is treated as trusted. */
    const auth = new Request('https://media.test', {
      headers: { authorization: 'Bearer allowed' },
    });
    /** Synthetic/native response whose body is explicitly consumed or cancelled by the fixture. */
    const response = await media.download(auth, 'document', stored.versionId);
    assert.equal(await response.text(), 'hello');
    assert.match(response.headers.get('content-disposition'), /^attachment/);
    assert.equal(response.headers.get('x-media-sha256'), sha);
    await assert.rejects(
      media.remove(auth, stored.versionId, { binary: true }),
      /DELETE/
    );
    await media.remove(
      new Request(auth, { method: 'DELETE' }),
      stored.versionId,
      { binary: true }
    );
    assert.equal((await media.metadata(auth, 'document'))[0].retired, true);
    await media.close();
    assert.ok(await files.list('uploads', { storage: 'disk' }));
  }));
test('length/hash errors and cancelled partial bodies never register metadata and close readers', () =>
  fixture(async ({ media, catalog, root }) => {
    await assert.rejects(
      media.upload(request(bytes, { 'content-length': '6' }), input),
      /length mismatch/
    );
    await assert.rejects(
      media.upload(request(), { ...input, sha256: '0'.repeat(64) }),
      /integrity/
    );
    let cancelled = 0;
    /** Fixture cancellation controller; aborting it does not imply a durable session was deleted. */
    const controller = new AbortController();
    /** Synthetic request byte stream used to exercise bounded transfer cleanup. */
    const body = new ReadableStream({
      /** Seed the explicit synthetic request stream without remote input.
       * @param {ReadableStreamDefaultController} c - Owned synthetic stream controller.
       * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
       */
      start(c) {
        c.enqueue(new Uint8Array([1]));
      },
      /** Record cooperative cancellation of this synthetic source.
       * @returns {unknown} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
       */
      cancel() {
        cancelled++;
      },
    });
    /** Synthetic Fetch request for the specific method/body/authorization case. */
    const req = new Request('https://media.test', {
      method: 'PUT',
      body,
      duplex: 'half',
      signal: controller.signal,
      headers: {
        authorization: 'Bearer allowed',
        'content-type': 'text/plain',
      },
    });
    /** Admitted fixture operation retained until its actual settlement is observed. */
    const work = media.upload(req, input);
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await assert.rejects(work, /cancel/);
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
    assert.equal(catalog.size, 0);
  }));
