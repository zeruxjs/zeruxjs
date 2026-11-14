import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalStorage, createFileManager } from '../dist/index.js';
/** Allocate an owned disposable local root and remove it after synthetic assertions.
 * @param {Function} fn - Borrowed async assertions receiving the owned root.
 * @returns {Promise<void>} Test completion or propagated assertion failure after cleanup.
 */
async function temporary(fn) {
  /** Owned temporary fixture root; outer finally removes it even on assertion failure. */
  const root = await mkdtemp(join(tmpdir(), 'zx-files-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
/** Construct a synthetic local object address.
 * @param {string} key - Relative fixture key.
 * @param {string} storage - Explicit fixture connection, default private.
 * @returns {object} Fixed-bucket synthetic address. */
const address = (key, storage = 'private') => ({
  storage,
  bucket: 'my-bucket',
  key,
});
test('S3-lite preserves arbitrary binary files, ranges, listing and private mode', async () =>
  temporary(async (root) => {
    /** Fixture-owned named manager with local or injected drivers only. */
    const manager = createFileManager({
      stores: [{ name: 'private', driver: createLocalStorage({ root }) }],
    });
    /** Small deterministic binary input used to verify byte-preserving reads/ranges. */
    const bytes = Buffer.from([0, 1, 2, 3, 4, 255]);
    /** Synthetic addressed object under the explicitly selected fixture storage. */
    const a = address('nested/binary.bin');
    /** Committed synthetic metadata receipt, checked separately from object bytes. */
    const info = await manager.put(a, bytes, {
      contentType: 'application/octet-stream',
    });
    assert.equal(info.size, 6);
    assert.equal(info.visibility, 'private');
    assert.deepEqual(await manager.get(a), bytes);
    /** Opened bounded local read iterable, consumed completely below. */
    const stream = await manager.read(a, { start: 1, end: 3 });
    /** Read chunks retained only for this small fixed test object. */
    const parts = [];
    // Consume this bounded fixture stream completely before manager teardown.
    for await (const chunk of stream) {
      parts.push(chunk);
    }
    assert.deepEqual(Buffer.concat(parts), Buffer.from([1, 2, 3]));
    await assert.rejects(manager.put(a, bytes), { code: 'FILE_EXISTS' });
    /** One synthetic local listing page with expected named storage metadata. */
    const page = await manager.list('my-bucket');
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].storage, 'private');
    assert.equal(await manager.delete(a), true);
    assert.equal(await manager.stat(a), null);
    await manager.close();
    await assert.rejects(manager.stat(a), /closed/);
  }));
test('multiple independent local stores, prefix and bucket policies, streaming cross-store copy', async () =>
  temporary(async (root) => {
    /** First local driver rooted in its own owned temporary subdirectory. */
    const a = createLocalStorage({ root: join(root, 'a') });
    /** Second local driver with a distinct temporary root. */
    const b = createLocalStorage({ root: join(root, 'b') });
    /** Fixture-owned local manager; explicit close stops future calls. */
    const m = createFileManager({
      defaultStorage: 'first',
      stores: [
        {
          name: 'first',
          driver: a,
          allowedBuckets: ['my-bucket'],
          keyPrefix: 'tenant/',
        },
        { name: 'second', driver: b },
      ],
    });
    /** Explicit synthetic source address for copy-policy checks. */
    const source = address('tenant/file.txt', 'first');
    /** Separate synthetic destination address for streamed cross-store copy. */
    const target = address('second-file.txt', 'second');
    /** Yield deterministic chunks to exercise cross-store streaming without full buffering.
     * @returns {AsyncGenerator<Buffer>} Two bounded synthetic source chunks.
     */
    async function* bytes() {
      yield Buffer.from('hello ');
      yield Buffer.from('world');
    }
    await m.put(source, bytes(), {
      contentType: 'text/plain',
      visibility: 'public',
    });
    await m.copy(source, target);
    assert.equal((await m.get(target)).toString(), 'hello world');
    await assert.rejects(
      m.get(address('other/file', 'first')),
      /Key not allowed/
    );
    await assert.rejects(
      m.get({
        storage: 'first',
        bucket: 'other-bucket',
        key: 'tenant/file.txt',
      }),
      /Bucket not allowed/
    );
    assert.equal(
      (await m.list('my-bucket', { storage: 'first' })).items.length,
      1
    );
    await m.close();
  }));
test('cache version/invalidation prevents stale data after overwrite and protects private reads', async () =>
  temporary(async (root) => {
    /** Fixture-owned local manager; explicit close stops future calls. */
    const m = createFileManager({
      stores: [{ name: 'private', driver: createLocalStorage({ root }) }],
      cache: { maxEntries: 2, maxBytes: 2000, ttlMs: 60000 },
    });
    /** Synthetic addressed object under the explicitly selected fixture storage. */
    const a = address('cache/item');
    await m.put(a, Buffer.from('before'), { visibility: 'public' });
    assert.equal((await m.get(a)).toString(), 'before');
    assert.equal(m.cacheStats().entries, 1);
    await m.put(a, Buffer.from('after'), {
      visibility: 'public',
      ifNoneMatch: false,
    });
    assert.equal(m.cacheStats().entries, 0);
    assert.equal((await m.get(a)).toString(), 'after');
    assert.equal(m.cacheStats().entries, 1);
    await m.delete(a);
    assert.equal(m.cacheStats().entries, 0);
    await m.put(a, Buffer.from('secret'), { visibility: 'private' });
    await m.get(a);
    assert.equal(m.cacheStats().entries, 0);
    await m.close();
  }));
test('encrypted local files are physically opaque and tag tampering is detected', async () =>
  temporary(async (root) => {
    /** Ephemeral random encryption key used only in this isolated fixture. */
    const secret = randomBytes(32);
    /** Fixture-owned local manager; explicit close stops future calls. */
    const m = createFileManager({
      stores: [
        {
          name: 'private',
          driver: createLocalStorage({ root, encryptionKey: secret }),
        },
      ],
    });
    /** Synthetic addressed object under the explicitly selected fixture storage. */
    const a = address('secret/file.txt');
    await m.put(a, Buffer.from('confidential document'), {
      visibility: 'private',
    });
    /** Owned ciphertext bytes read from the temporary fixture for tamper validation. */
    const raw = await readFile(
      join(root, 'objects', 'my-bucket', 'secret', 'file.txt')
    );
    assert.equal(raw.includes(Buffer.from('confidential')), false);
    assert.equal((await m.get(a)).toString(), 'confidential document');
    raw[0] ^= 1;
    await writeFile(
      join(root, 'objects', 'my-bucket', 'secret', 'file.txt'),
      raw
    );
    await assert.rejects(m.get(a), /authenticat|decrypt|Unsupported state/i);
    await m.close();
  }));
test('storage path traversal, symlinks, content types, invalid configuration rejected', async () =>
  temporary(async (root) => {
    /** Fixture-owned local manager; explicit close stops future calls. */
    const m = createFileManager({
      stores: [
        {
          name: 'private',
          driver: createLocalStorage({ root }),
          allowedTypes: ['image/*'],
          maxBytes: 8,
        },
      ],
    });
    // Each literal traversal spelling must reject before any object is persisted.
    for (const bad of [
      '../etc/passwd',
      '/root',
      'a//b',
      'a/./b',
      'a/../b',
      'foo\\bar',
    ]) {
      await assert.rejects(m.put(address(bad), Buffer.from('x')));
    }
    await assert.rejects(
      m.put(address('content.jpg'), Buffer.from('data'), {
        contentType: 'text/plain',
      }),
      /not allowed/
    );
    await assert.rejects(
      m.put(address('photo.jpg'), Buffer.alloc(9), {
        contentType: 'image/jpeg',
      }),
      /size/
    );
    await m.put(address('photo.jpg'), Buffer.from('data'), {
      contentType: 'image/jpeg',
    });
    /** Owned fixture object path replaced with a symlink to verify no-follow rejection. */
    const file = join(root, 'objects', 'my-bucket', 'photo.jpg');
    await rm(file);
    await symlink('/etc/passwd', file);
    await assert.rejects(
      m.stat(address('photo.jpg')),
      /Unsafe|symbolic|mismatch|file/i
    );
    await m.close();
  }));
test('copy enforces destination content type and size policies before using native copy', async () => {
  let copied = 0;
  /** Explicit synthetic source address for copy-policy checks. */
  const source = { storage: 'one', bucket: 'my-bucket', key: 'item.txt' };
  /** Synthetic destination address checked before any native-copy dispatch. */
  const dest = { storage: 'one', bucket: 'my-bucket', key: 'item-copy.txt' };
  /** Injected native-copy sentinel; it must never run when destination policy denies. */
  const driver = {
    kind: 'native',
    async stat(a) {
      return a.key === source.key
        ? {
            ...a,
            size: 12,
            contentType: 'text/plain',
            modifiedAt: new Date().toISOString(),
            etag: 'etag',
            visibility: 'private',
            metadata: {},
          }
        : null;
    },
    async copy() {
      copied++;
      throw new Error('must not copy');
    },
    async put() {
      throw Error('unused');
    },
    async read() {
      throw Error('unused');
    },
    async delete() {
      return false;
    },
    async list() {
      return { items: [] };
    },
  };
  /** Fixture-owned named manager with local or injected drivers only. */
  const manager = createFileManager({
    stores: [{ name: 'one', driver, allowedTypes: ['image/*'], maxBytes: 10 }],
  });
  await assert.rejects(manager.copy(source, dest), /Content type not allowed/);
  await assert.rejects(
    manager.copy(source, dest, { contentType: 'image/png' }),
    /size exceeds limit/
  );
  assert.equal(copied, 0);
  await manager.close();
});
