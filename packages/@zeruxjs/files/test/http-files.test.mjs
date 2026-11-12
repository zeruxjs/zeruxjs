import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileManager,
  createLocalStorage,
  createFileResponse,
  createFileHttpHandler,
  createFileTokenAuthorizer,
  createFilesClient,
} from '../dist/index.js';
/** Run an isolated local HTTP fixture and close its manager/remove its owned root in finally.
 * @param {Function} fn - Borrowed async assertions over the fixture manager.
 * @returns {Promise<void>} Assertion completion with cleanup; no HTTP server is started.
 */
async function setup(fn) {
  /** Owned temporary local storage root, removed by the enclosing fixture finally. */
  const root = await mkdtemp(join(tmpdir(), 'zx-files-http-'));
  /** Fixture-owned local manager; no operator storage or remote endpoint is used. */
  const manager = createFileManager({
    stores: [{ name: 'local', driver: createLocalStorage({ root }) }],
  });
  try {
    await fn(manager);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
}
/** Fixed synthetic object address, not an authenticated tenant identity. */
const address = { bucket: 'my-bucket', key: 'document.txt' };
test('HTTP downloads: private auth, HEAD, ETag, suffix range, unsatisfiable range and cache headers', () =>
  setup(async (manager) => {
    await manager.put(address, Buffer.from('0123456789'), {
      visibility: 'private',
      contentType: 'text/plain',
    });
    /** Construct one synthetic Fetch request without opening a socket.
     * @param {string} method - HTTP method, default GET.
     * @param {object} headers - Synthetic request headers.
     * @returns {Request} In-memory request for the handler fixture. */
    const req = (method = 'GET', headers = {}) =>
      new Request('https://files.example/document.txt', { method, headers });
    assert.equal(
      (await createFileResponse(manager, address, req())).status,
      403
    );
    /** Allow the synthetic private read without consulting a real identity store.
     * @returns {boolean} Fixture-only permission approval.
     */
    const authorize = () => true;
    /** Synthetic handler response consumed below; no live browser transport. */
    const response = await createFileResponse(manager, address, req(), {
      authorize,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), '0123456789');
    /** Representation validator returned by the fixture, reused for conditional GET. */
    const etag = response.headers.get('etag');
    assert.equal(
      (
        await createFileResponse(
          manager,
          address,
          req('GET', { 'If-None-Match': etag }),
          { authorize }
        )
      ).status,
      304
    );
    /** HEAD fixture response expected to contain metadata without a body. */
    const head = await createFileResponse(manager, address, req('HEAD'), {
      authorize,
    });
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal(head.body, null);
    /** Single suffix-range fixture response, whose bytes are asserted independently. */
    const range = await createFileResponse(
      manager,
      address,
      req('GET', { Range: 'bytes=-4' }),
      { authorize }
    );
    assert.equal(range.status, 206);
    assert.equal(await range.text(), '6789');
    /** Unsatisfiable range response expected to reject without reading bytes. */
    const invalid = await createFileResponse(
      manager,
      address,
      req('GET', { Range: 'bytes=100-105' }),
      { authorize }
    );
    assert.equal(invalid.status, 416);
  }));
test('HTTP handler streams arbitrary binary, requires writes authorization and prevents encoded bodies', () =>
  setup(async (manager) => {
    /** Check only the synthetic bearer header; not a production auth policy.
     * @param {Request} req - In-memory request under test.
     * @param {object} _a - Unused fixed fixture address.
     * @param {string} _action - Unused fixture operation.
     * @returns {boolean} Whether the synthetic header matches.
     */
    const authorize = (req, _a, _action) =>
      req.headers.get('authorization') === 'Bearer good';
    /** Inert Fetch handler borrowing the enclosing owned file manager. */
    const handler = createFileHttpHandler(manager, {
      bucket: 'my-bucket',
      authorize,
      maxUploadBytes: 2 * 1024 * 1024,
      allowDelete: true,
    });
    /** Synthetic binary payload larger than 1 MiB, with deterministic byte values. */
    const content = Buffer.alloc(1024 * 1024 + 55, 213);
    /** Unauthorized write result, expected before any binary persistence. */
    const fail = await handler(
      new Request('https://files.example/data.bin', {
        method: 'PUT',
        body: content,
      })
    );
    assert.equal(fail.status, 403);
    /** Synthetic authorization/MIME headers; values are not real credentials. */
    const headers = {
      Authorization: 'Bearer good',
      'Content-Type': 'application/octet-stream',
    };
    /** Successful synthetic upload response with a JSON size receipt. */
    const uploaded = await handler(
      new Request('https://files.example/data.bin', {
        method: 'PUT',
        headers,
        body: content,
      })
    );
    assert.equal(uploaded.status, 201);
    assert.equal((await uploaded.json()).size, content.length);
    /** Authorized synthetic download whose binary bytes are checked exactly. */
    const read = await handler(
      new Request('https://files.example/data.bin', { headers })
    );
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), content);
    assert.equal(
      (
        await handler(
          new Request('https://files.example/data.bin', {
            method: 'DELETE',
            headers,
          })
        )
      ).status,
      204
    );
    assert.equal(
      (
        await handler(
          new Request('https://files.example/data.bin', { headers })
        )
      ).status,
      404
    );
    /** Encoded upload response expected to reject unsupported request encoding. */
    const encoded = await handler(
      new Request('https://files.example/data.bin', {
        method: 'PUT',
        headers: { ...headers, 'Content-Encoding': 'gzip' },
        body: 'abc',
      })
    );
    assert.equal(encoded.status, 400);
  }));
test('token authorizer uses scoped bearer tokens and optional public reads', async () => {
  /** Injected scoped identity fixture; no real auth store or tokens are queried. */
  const verifier = {
    verify(token, scope) {
      return token === 'zx_demo' && scope === 'files:read:my-bucket'
        ? { subject: 'alice', scopes: [scope] }
        : null;
    },
  };
  /** Borrowed-verifier authorizer under test; no native cleanup handle. */
  const auth = createFileTokenAuthorizer(verifier);
  assert.equal(
    await auth(new Request('https://x', {}), address, 'read'),
    false
  );
  assert.equal(
    await auth(
      new Request('https://x', {
        headers: { Authorization: 'Bearer zx_demo' },
      }),
      address,
      'read'
    ),
    true
  );
  assert.equal(
    await auth(
      new Request('https://x', {
        headers: { Authorization: 'Bearer zx_demo' },
      }),
      address,
      'write'
    ),
    false
  );
  assert.equal(
    await createFileTokenAuthorizer(verifier, { publicRead: true })(
      new Request('https://x'),
      address,
      'read',
      { visibility: 'public' }
    ),
    true
  );
});
test('browser Fetch client supports upload/download/ranges with mocked Fetch routes', () =>
  setup(async (manager) => {
    /** Inert Fetch handler borrowing the enclosing owned file manager. */
    const handler = createFileHttpHandler(manager, {
      bucket: 'my-bucket',
      authorize: () => true,
    });
    /** Borrowed-Fetch browser client pointed directly at an in-memory handler. */
    const client = createFilesClient({
      baseUrl: 'https://files.example/',
      fetch: (url, init) => handler(new Request(url, init)),
    });
    /** Deterministic binary fixture including a non-ASCII byte. */
    const bytes = Buffer.from([0, 255, 1, 2]);
    /** Decoded server upload receipt, checked against actual fixture size. */
    const created = await client.upload('folder/data.bin', bytes);
    assert.equal(created.size, 4);
    /** Synthetic handler response consumed below; no live browser transport. */
    const response = await client.download('folder/data.bin', {
      range: 'bytes=1-2',
    });
    assert.equal(response.status, 206);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      Buffer.from([255, 1])
    );
    assert.deepEqual(Buffer.from(await client.bytes('folder/data.bin')), bytes);
    /** Observe the pending HEAD before fixture teardown closes its borrowed manager. */
    const pendingHead = client.head('folder/data.bin');
    assert.equal(pendingHead instanceof Promise, true);
    await pendingHead;
  }));
test('stream Content-Length mismatch rejects before creating an object', () =>
  setup(async (manager) => {
    /** Public raw-upload helper imported for precommit length enforcement. */
    const { uploadFileRequest } = await import('../dist/index.js');
    /** Synthetic destination checked after failed uploads to prove no commit/removal. */
    const id = { bucket: 'my-bucket', key: 'mismatch.bin' };
    // Test both shorter and longer bodies against their exact declared byte counts.
    for (const [declared, payload] of [
      ['4', 'abc'],
      ['2', 'abc'],
    ]) {
      /** Construct one synthetic Fetch request without opening a socket.
       * @param {string} method - HTTP method, default GET.
       * @param {object} headers - Synthetic request headers.
       * @returns {Request} In-memory request for the handler fixture. */
      const req = new Request('https://files.example/mismatch.bin', {
        method: 'PUT',
        headers: { 'Content-Length': declared },
        body: payload,
      });
      await assert.rejects(
        uploadFileRequest(manager, id, req),
        /length mismatch/i
      );
      assert.equal(
        await manager.stat(id),
        null,
        'length errors must not commit a file'
      );
    }
    await manager.put(id, Buffer.from('untouched'));
    /** Construct one synthetic Fetch request without opening a socket.
     * @param {string} method - HTTP method, default GET.
     * @param {object} headers - Synthetic request headers.
     * @returns {Request} In-memory request for the handler fixture. */
    const req = new Request('https://files.example/mismatch.bin', {
      method: 'PUT',
      headers: { 'Content-Length': '99' },
      body: 'abc',
    });
    await assert.rejects(
      uploadFileRequest(manager, id, req),
      /length mismatch|exists/i
    );
    assert.equal(
      (await manager.get(id)).toString(),
      'untouched',
      'failed writes never delete a pre-existing object'
    );
  }));
