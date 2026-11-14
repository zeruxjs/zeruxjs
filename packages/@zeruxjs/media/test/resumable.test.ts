import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createFileManager,
  createLocalStorage,
  createResumableUploads,
} from '@zeruxjs/files';
import { createMediaResumableHandler } from '../dist/resumable.js';
import { createMediaTransfers } from '../dist/browser.mjs';
/** Fixture SHA-256 helper/value used to assert byte integrity independently of authorization.
 * @param {Uint8Array | string} value - Explicit synthetic bytes or tenant label used for deterministic hashing.
 * @returns {string} Lowercase digest of the explicit synthetic bytes.
 */
const sha = (value) => createHash('sha256').update(value).digest('hex');
/** Synthetic explicit payload bytes; no real tenant content or remote files are used. */
const bytes = Buffer.from('hello world');
/** Create isolated synthetic dependency/DOM/job state; the caller or callback owns documented teardown.
 * @param {function} fn - Fixture callback; operation-specific cleanup remains in the enclosing finally.
 * @param {object} extra - Explicit injected fixture overrides; never untrusted executable source.
 * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
 */
async function fixture(fn, extra = {}) {
  /** Owned isolated temporary fixture directory, removed by the enclosing cleanup. */
  const root = await mkdtemp(join(tmpdir(), 'zx-media-resume-'));
  /** Fixture-owned local storage manager; close after its dependent media/journal work. */
  const files = createFileManager({
    stores: [
      {
        name: 'disk',
        driver: createLocalStorage({ root: join(root, 'files') }),
      },
    ],
  });
  /** Owned files resumable coordinator with a private synthetic journal. */
  const uploads = createResumableUploads({
    files,
    root: join(root, 'sessions'),
    authorize: () => true,
    maxPartBytes: 5,
    maxBytes: 100,
  });
  /** Explicit synthetic tenant/mount/MIME/destination protocol configuration. */
  const config = {
    uploads,
    prefix: '/sessions',
    allowedTypes: ['text/plain'],
    partBytes: 5,
    maxBytes: 100,
    identify: (request) => ({
      tenant:
        request.headers.get('authorization') === 'Bearer other'
          ? 'other'
          : 'tenant-a',
      subject: 'user',
    }),
    authorizeRequest: (request) =>
      request.headers.get('authorization')?.startsWith('Bearer ') === true,
    destination: (who) => ({
      storage: 'disk',
      bucket: 'uploads',
      key: sha(who.tenant) + '/' + randomBytes(16).toString('hex'),
    }),
    ...extra,
  };
  /** Owned resumable Fetch handler; drain before closing its journal/storage. */
  const handler = createMediaResumableHandler(config);
  /** Injected in-process Fetch bridge, not a live server or external network client.
   * @param {string} url - Synthetic in-process protocol URL.
   * @param {RequestInit} init - Explicit synthetic request method/headers/body.
   * @returns {unknown} Observed synthetic result; failures stay explicit to the enclosing assertion.
   */
  const fetch = async (url, init = {}) => {
    /** Synthetic host verification/CSRF headers; production authorization stays host-owned. */
    const headers = new Headers(init.headers);
    headers.set('authorization', 'Bearer allowed');
    return handler.handle(new Request(url, { ...init, headers }));
  };
  /** Owned browser-transfer client; close and await actual admitted work at teardown. */
  const client = createMediaTransfers({
    baseUrl: 'https://media.test/',
    allowedOrigins: ['https://media.test'],
    fetch,
  });
  try {
    await fn({ root, files, uploads, handler, client, config });
  } finally {
    try {
      await client.close();
    } finally {
      try {
        await handler.close();
      } finally {
        try {
          await uploads.close();
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
}
/** Explicit synthetic whole-file size, MIME and expected integrity digest. */
const declaration = {
  name: 'document.txt',
  size: bytes.length,
  sha256: sha(bytes),
  contentType: 'text/plain',
};
test('request abort retains tenant session, explicit resume validates parts, completion returns no storage address', () =>
  fixture(async ({ client, files }) => {
    /** Tenant-bound synthetic durable journal receipt, not an AbortController. */
    const session = await client.initiateSession('sessions', declaration);
    /** Fixture cancellation controller; aborting it does not imply a durable session was deleted. */
    const controller = new AbortController();
    await assert.rejects(
      client.uploadSession('sessions', session.id, new Blob([bytes]), {
        sha256: sha(bytes),
        signal: controller.signal,
        onProgress: (p) => {
          if (p.loaded === 5) {
            controller.abort();
          }
        },
      }),
      /cancelled/
    );
    /** Observed interrupted request outcome; persistent session lifetime is separate. */
    const partial = await client.getSession('sessions', session.id);
    assert.equal(partial.parts.length, 1);
    assert.equal(partial.status, 'open');
    assert.doesNotMatch(JSON.stringify(partial), /bucket|storage|nativeId/);
    /** Observed accepted part references before separate explicit completion. */
    const sent = await client.uploadSession(
      'sessions',
      session.id,
      new Blob([bytes]),
      { sha256: sha(bytes) }
    );
    assert.deepEqual(sent.parts, [1, 2, 3]);
    /** Observed explicit committed protocol receipt. */
    const complete = await client.finalizeSession(
      'sessions',
      session.id,
      sent.parts
    );
    assert.equal(complete.sha256, sha(bytes));
    assert.equal(complete.size, bytes.length);
    assert.doesNotMatch(JSON.stringify(complete), /bucket|storage|nativeId/);
    assert.equal(
      (await client.getSession('sessions', session.id)).status,
      'complete'
    );
    assert.equal(
      (await files.list('uploads', { storage: 'disk' })).items.length,
      1
    );
  }));
test('cross-tenant/unauthorized session calls, altered file hashes and explicit abort are enforced', () =>
  fixture(async ({ client, handler, root }) => {
    /** Tenant-bound synthetic durable journal receipt, not an AbortController. */
    const session = await client.initiateSession('sessions', declaration);
    /** Deliberately unauthorized fixture principal/client; denial must occur before exposure. */
    const denied = await handler.handle(
      new Request('https://media.test/sessions/' + session.id, {
        headers: { authorization: 'Bearer other' },
      })
    );
    assert.equal(denied.status, 403);
    assert.equal(
      (
        await handler.handle(
          new Request('https://media.test/sessions/' + session.id, {
            headers: { 'x-forwarded-user': 'trusted' },
          })
        )
      ).status,
      403
    );
    await client.uploadSession('sessions', session.id, new Blob([bytes]), {
      sha256: sha(bytes),
    });
    /** Synthetic tampered part/body used for integrity rejection. */
    const altered = Buffer.from(bytes);
    altered[0] = 0;
    await assert.rejects(
      client.uploadSession('sessions', session.id, new Blob([altered]), {
        sha256: sha(bytes),
      }),
      /mismatch/
    );
    await client.abortSession('sessions', session.id);
    assert.equal(
      (await client.getSession('sessions', session.id)).status,
      'aborted'
    );
    assert.deepEqual(await readdir(join(root, 'sessions', session.id)), [
      'session.json',
    ]);
  }));
test('whole-object hash mismatch fails before commit and failed metadata integration reports committed uncertainty', () =>
  fixture(
    async ({ client, files }) => {
      /** Tenant-bound synthetic durable journal receipt, not an AbortController. */
      const session = await client.initiateSession('sessions', {
        ...declaration,
        sha256: '0'.repeat(64),
      });
      /** Synthetic ordered chunks or part references checked before completion. */
      const parts = await client.uploadSession(
        'sessions',
        session.id,
        new Blob([bytes]),
        { sha256: '0'.repeat(64) }
      );
      await assert.rejects(
        client.finalizeSession('sessions', session.id, parts.parts),
        (error) => error.code === 'INVALID_UPLOAD'
      );
      assert.equal(
        (await files.list('uploads', { storage: 'disk' })).items.length,
        0
      );
      await client.abortSession('sessions', session.id);
      /** Valid synthetic payload/receipt used as the normal-case control. */
      const good = await client.initiateSession('sessions', declaration);
      /** Synthetic successful upload receipt used for subsequent authorized checks. */
      const uploaded = await client.uploadSession(
        'sessions',
        good.id,
        new Blob([bytes]),
        { sha256: sha(bytes) }
      );
      await assert.rejects(
        client.finalizeSession('sessions', good.id, uploaded.parts),
        (error) =>
          error.code === 'METADATA_AFTER_COMMIT_FAILED' &&
          error.committed === true
      );
      assert.equal(
        (await client.getSession('sessions', good.id)).status,
        'complete'
      );
      assert.equal(
        (await files.list('uploads', { storage: 'disk' })).items.length,
        1
      );
    },
    {
      onCommitted: async () => {
        throw new Error('PRIVATE_CATALOG_FAILURE');
      },
    }
  ));
test('completed-session callback is explicit and can be idempotent; protocol body failures remain sanitized', () => {
  let calls = 0;
  /** Ordered verified part metadata used for explicit finalization. */
  const receipts = new Map();
  return fixture(
    async ({ client, handler }) => {
      /** Tenant-bound synthetic durable journal receipt, not an AbortController. */
      const session = await client.initiateSession('sessions', declaration);
      /** Synthetic ordered chunks or part references checked before completion. */
      const parts = await client.uploadSession(
        'sessions',
        session.id,
        new Blob([bytes]),
        { sha256: sha(bytes) }
      );
      /** First isolated synthetic tenant/client, never a shared production principal. */
      const a = await client.finalizeSession(
        'sessions',
        session.id,
        parts.parts
      );
      /** Second isolated synthetic tenant/client used to assert separation. */
      const b = await client.finalizeSession(
        'sessions',
        session.id,
        parts.parts
      );
      assert.deepEqual(a.asset, b.asset);
      assert.equal(calls, 1);
      /** Malformed synthetic protocol request expected to reject. */
      const invalid = await handler.handle(
        new Request('https://media.test/sessions', {
          method: 'POST',
          headers: {
            authorization: 'Bearer allowed',
            'content-type': 'application/json',
          },
          body: '{"__proto__":{"private":"SECRET"}}',
        })
      );
      assert.equal(invalid.status, 400);
      assert.doesNotMatch(await invalid.text(), /SECRET|stack/);
    },
    {
      onCommitted: async (who, id) => {
        /** Synthetic object key, caption identity or fixed protocol field used by this case. */
        const key = who.tenant + ':' + id;
        if (!receipts.has(key)) {
          calls++;
          receipts.set(key, {
            assetId: 'document',
            versionId: randomBytes(24).toString('hex'),
          });
        }
        return receipts.get(key);
      },
    }
  );
});
