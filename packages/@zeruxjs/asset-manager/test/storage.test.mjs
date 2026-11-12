import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileManager, createLocalStorage } from '@zeruxjs/files';
import {
  createAssetManager,
  AssetRevisionError,
  saveAssetCatalog,
  loadAssetCatalog,
} from '../dist/index.js';
import { createAssetStorage } from '../dist/storage.js';
/** Synthetic host-verified actor/tenant used only inside isolated fixtures. */
const actor = { tenant: 'tenant-a', subject: 'alice' };
/** Finite synthetic binary content, never decoded or executed. */
const bytes = Buffer.from('asset body');
/** Hash explicit fixture bytes, not metadata or permissions.
 * @param {Uint8Array} data - Synthetic binary content.
 * @returns {string} Lowercase SHA-256 digest.
 */
const sha = (data) => createHash('sha256').update(data).digest('hex');
/** Build one explicit synthetic upload declaration.
 * @param {string} id - Logical fixture asset ID, default document.
 * @param {Uint8Array} data - Synthetic bytes, default shared fixture body.
 * @returns {object} Metadata and exact integrity declaration.
 */
const input = (id = 'document', data = bytes) => ({
  asset: { id, name: id, type: 'document' },
  size: data.length,
  sha256: sha(data),
  contentType: 'text/plain',
});
/** Run a callback with disposable local storage and always drain adapters/files before removing owned paths.
 * @param {Function} fn - Fixture-only callback receiving local resources and policies.
 * @returns {Promise<void>} Settles after callback and owned teardown, preserving assertion failures.
 */
async function fixture(fn) {
  /** Owned temporary consumer/storage directory, removed recursively in teardown. */
  const root = await mkdtemp(join(tmpdir(), 'zx-assets-'));
  /** Owned local files fixture; teardown closes it after borrowed adapters drain. */
  const files = createFileManager({
    stores: [
      {
        name: 'disk',
        driver: createLocalStorage({ root: join(root, 'files') }),
        allowedBuckets: ['assets'],
        maxBytes: 1024,
      },
    ],
  });
  /** Borrowed fixture metadata catalog; it owns no binary storage. */
  const catalog = createAssetManager();
  /** Explicit private namespace, MIME and verified-principal fixture policies. */
  const config = {
    catalog,
    files,
    namespace: 'test',
    location: () => ({ storage: 'disk', bucket: 'assets', prefix: 'private/' }),
    allowedTypes: ['text/plain'],
    authorize: (who) => who.subject === 'alice',
    maxBytes: 1024,
  };
  /** Owned asset storage adapter borrowing only the fixture files/catalog. */
  const adapter = createAssetStorage(config);
  try {
    await fn({ root, files, catalog, adapter, config });
  } finally {
    await adapter.close();
    await files.close();
    await rm(root, { recursive: true, force: true });
  }
}
test('immutable upload versions preserve snapshots, duplicate IDs reject and persisted catalogs retain history', () =>
  fixture(async ({ root, files, catalog, adapter, config }) => {
    /** First immutable upload receipt; its historical record must remain unchanged. */
    const first = await adapter.upload(actor, input(), bytes);
    /** Detached pre-operation catalog/history used for immutability assertions. */
    const snapshot = catalog.snapshot();
    assert.deepEqual(
      await adapter.download(actor, first.reference.versionId),
      bytes
    );
    await assert.rejects(adapter.upload(actor, input(), bytes), {
      code: 'ASSET_EXISTS',
    });
    /** New immutable version with an explicit parent, independent address and identity. */
    const second = await adapter.upload(
      actor,
      { ...input(), previousVersionId: first.reference.versionId },
      bytes
    );
    assert.notEqual(first.reference.versionId, second.reference.versionId);
    assert.notEqual(first.reference.address.key, second.reference.address.key);
    assert.deepEqual(snapshot.assets[0], catalog.snapshot().assets[0]);
    assert.equal((await adapter.versions(actor, 'document')).length, 2);
    await assert.rejects(
      adapter.upload(
        actor,
        { ...input(), previousVersionId: first.reference.versionId },
        bytes
      ),
      { code: 'ASSET_VERSION_CONFLICT' }
    );
    /** Private catalog file under the owned fixture directory. */
    const path = join(root, 'catalog.json');
    await saveAssetCatalog(catalog, path);
    /** New fixture catalog/workflow loaded from persisted history. */
    const restored = await loadAssetCatalog(path);
    /** Adapter borrowing the restored persisted catalog; drained separately. */
    const resumed = createAssetStorage({ ...config, catalog: restored });
    try {
      assert.equal((await resumed.versions(actor, 'document')).length, 2);
      assert.deepEqual(
        await resumed.download(actor, first.reference.versionId),
        bytes
      );
    } finally {
      await resumed.close();
    }
    assert.equal(
      (await files.list('assets', { storage: 'disk' })).items.length,
      2
    );
  }));
test('registration borrows verified bytes; active references protect binary ownership', () =>
  fixture(async ({ adapter, files }) => {
    /** Upload-owned version whose bytes can be deleted only under ownership/reference checks. */
    const owned = await adapter.upload(actor, input('owned'), bytes);
    /** Registered reference borrowing existing bytes; it must never gain binary ownership. */
    const borrowed = await adapter.register(
      actor,
      input('borrowed'),
      owned.reference.address
    );
    assert.equal(borrowed.reference.owned, false);
    await assert.rejects(
      adapter.delete(actor, borrowed.reference.versionId, { binary: true }),
      { code: 'ASSET_BORROWED_BINARY' }
    );
    await assert.rejects(
      adapter.delete(actor, owned.reference.versionId, { binary: true }),
      { code: 'ASSET_REFERENCED' }
    );
    await adapter.delete(actor, borrowed.reference.versionId, {
      binary: false,
    });
    assert.ok(await files.stat(owned.reference.address));
    await adapter.delete(actor, owned.reference.versionId, { binary: true });
    assert.equal(await files.stat(owned.reference.address), null);
    assert.equal((await adapter.versions(actor, 'owned'))[0].retired, true);
    await assert.rejects(adapter.download(actor, owned.reference.versionId), {
      code: 'ASSET_RETIRED',
    });
  }));
test('stream lengths, MIME policy, hashes and tenant address checks reject before metadata commit', () =>
  fixture(async ({ adapter, files, catalog, config }) => {
    await assert.rejects(
      adapter.upload(actor, { ...input(), contentType: 'text/html' }, bytes),
      { code: 'ASSET_CONTENT' }
    );
    await assert.rejects(
      adapter.upload(actor, { ...input(), sha256: '0'.repeat(64) }, bytes),
      { code: 'ASSET_INTEGRITY' }
    );
    await assert.rejects(
      adapter.upload(actor, { ...input(), size: bytes.length + 1 }, bytes),
      { code: 'ASSET_LENGTH' }
    );
    await assert.rejects(
      adapter.upload(
        actor,
        input(),
        (async function* () {
          yield bytes;
          throw new Error('source interrupted');
        })()
      ),
      /source interrupted/
    );
    assert.equal(catalog.size, 0);
    assert.equal(
      (await files.list('assets', { storage: 'disk' })).items.length,
      0
    );
    /** Actual verified upload result before injecting a read/delete failure. */
    const stored = await adapter.upload(actor, input(), bytes);
    await assert.rejects(
      adapter.register(
        { ...actor, tenant: 'other' },
        input('stolen'),
        stored.reference.address
      ),
      { code: 'ASSET_FORBIDDEN' }
    );
    /** Injected backend returning wrong bytes; integrity must fail before exposure/publication. */
    const corrupt = createAssetStorage({
      ...config,
      files: {
        ...files,
        read: async () =>
          (async function* () {
            yield Buffer.alloc(bytes.length);
          })(),
      },
    });
    try {
      await assert.rejects(
        corrupt.download(actor, stored.reference.versionId),
        { code: 'ASSET_INTEGRITY' }
      );
    } finally {
      await corrupt.close();
    }
    await assert.rejects(
      adapter.download(
        { ...actor, subject: 'mallory' },
        stored.reference.versionId
      ),
      { code: 'ASSET_FORBIDDEN' }
    );
  }));
test('identical bytes do not share tenant addresses, references or permissions', () =>
  fixture(async ({ adapter, config }) => {
    /** First tenant-scoped immutable upload receipt. */
    const a = await adapter.upload(actor, input(), bytes);
    /** Independent synthetic tenant or repair adapter; no shared permission is inferred. */
    const other = { tenant: 'tenant-b', subject: 'alice' };
    /** Second tenant-scoped immutable upload receipt for identical bytes. */
    const b = await adapter.upload(other, input(), bytes);
    assert.notEqual(a.reference.address.key, b.reference.address.key);
    await assert.rejects(adapter.download(other, a.reference.versionId), {
      code: 'ASSET_NOT_FOUND',
    });
    assert.equal((await adapter.versions(other, 'document')).length, 1);
    /** Explicit adapter with a smaller binary verification ceiling. */
    const limited = createAssetStorage({ ...config, maxBytes: 1 });
    try {
      assert.equal((await limited.versions(other, 'document')).length, 1);
      await assert.rejects(limited.download(other, b.reference.versionId), {
        code: 'ASSET_SIZE',
      });
    } finally {
      await limited.close();
    }
    await adapter.delete(actor, a.reference.versionId, { binary: true });
    assert.deepEqual(
      await adapter.download(other, b.reference.versionId),
      bytes
    );
  }));
test('failed upload and revision conflicts leave metadata untouched; approved repair rechecks candidates', () =>
  fixture(async ({ adapter, files, catalog, config }) => {
    /** Injected definite backend failure; catalog metadata must remain unchanged. */
    const failed = createAssetStorage({
      ...config,
      files: {
        ...files,
        put: async () => {
          throw new Error('backend unavailable');
        },
      },
    });
    try {
      await assert.rejects(
        failed.upload(actor, input(), bytes),
        /backend unavailable/
      );
      assert.equal(catalog.size, 0);
    } finally {
      await failed.close();
    }
    /** Backend injects a catalog revision change after bytes commit, requiring explicit repair. */
    const conflicting = createAssetStorage({
      ...config,
      files: {
        ...files,
        put: async (...args) => {
          /** Actual verified upload result before injecting a read/delete failure. */
          const stored = await files.put(...args);
          catalog.add({
            id: 'unrelated',
            name: 'other',
            type: 'color',
            value: '#fff',
          });
          return stored;
        },
      },
    });
    try {
      await assert.rejects(
        conflicting.upload(actor, input(), bytes),
        AssetRevisionError
      );
    } finally {
      await conflicting.close();
    }
    assert.equal(catalog.size, 1);
    /** Metadata-only orphan inventory; this read never deletes candidates. */
    const preview = await adapter.previewRepair(actor);
    assert.equal(preview.items.length, 1);
    await assert.rejects(adapter.repair(actor, preview.items), {
      code: 'ASSET_FORBIDDEN',
    });
    /** Adapter with explicit trusted synthetic repair approval. */
    const repair = createAssetStorage({ ...config, approveRepair: () => true });
    try {
      catalog.add({ id: 'changed', name: 'changed', type: 'other' });
      assert.equal(await repair.repair(actor, preview.items), 0);
      /** New preview after an earlier revision becomes stale. */
      const fresh = await repair.previewRepair(actor);
      assert.equal(await repair.repair(actor, fresh.items), 1);
      assert.equal((await adapter.previewRepair(actor)).items.length, 0);
    } finally {
      await repair.close();
    }
  }));
test('lost storage success remains an inventoried orphan and detached ownership is explicitly repairable', () =>
  fixture(async ({ files, catalog, config }) => {
    /** Backend commits bytes then loses its response; cleanup must remain explicitly previewed. */
    const lost = createAssetStorage({
      ...config,
      files: {
        ...files,
        put: async (...args) => {
          await files.put(...args);
          throw new Error('lost response');
        },
      },
      approveRepair: () => true,
    });
    try {
      await assert.rejects(lost.upload(actor, input(), bytes), /lost response/);
      assert.equal(catalog.size, 0);
      /** Bounded ownership-marked orphan candidates from the current preview. */
      const candidates = await lost.previewRepair(actor);
      assert.equal(candidates.items.length, 1);
      assert.equal(await lost.repair(actor, candidates.items), 1);
    } finally {
      await lost.close();
    }
    /** Owned asset storage adapter borrowing only the fixture files/catalog. */
    const adapter = createAssetStorage({
      ...config,
      approveRepair: () => true,
    });
    try {
      /** Actual verified upload result before injecting a read/delete failure. */
      const stored = await adapter.upload(actor, input('detached'), bytes);
      await adapter.delete(actor, stored.reference.versionId, {
        binary: false,
      });
      /** Exact positively identified unreferenced owned object considered for approved repair. */
      const candidate = (await adapter.previewRepair(actor)).items.find(
        (c) => c.versionId === stored.reference.versionId
      );
      assert.ok(candidate);
      assert.equal(await adapter.repair(actor, [candidate]), 1);
    } finally {
      await adapter.close();
    }
  }));
test('failed binary delete retains live metadata and a successful delete/revision race is surfaced', () =>
  fixture(async ({ adapter, files, catalog, config }) => {
    /** Actual verified upload result before injecting a read/delete failure. */
    const stored = await adapter.upload(actor, input(), bytes);
    /** Expected local catalog revision captured before the injected race. */
    const revision = catalog.revision;
    /** Injected definite backend failure; catalog metadata must remain unchanged. */
    const failed = createAssetStorage({
      ...config,
      files: {
        ...files,
        delete: async () => {
          throw new Error('delete outage');
        },
      },
    });
    try {
      await assert.rejects(
        failed.delete(actor, stored.reference.versionId, { binary: true }),
        /delete outage/
      );
      assert.equal(catalog.revision, revision);
      assert.deepEqual(
        await adapter.download(actor, stored.reference.versionId),
        bytes
      );
    } finally {
      await failed.close();
    }
    /** Injected successful delete followed by a catalog revision race. */
    const racing = createAssetStorage({
      ...config,
      files: {
        ...files,
        delete: async (address) => {
          /** Actual mutation/deletion receipt checked for explicit committed/audit status. */
          const result = await files.delete(address);
          catalog.add({ id: 'concurrent', name: 'concurrent', type: 'other' });
          return result;
        },
      },
    });
    try {
      await assert.rejects(
        racing.delete(actor, stored.reference.versionId, { binary: true }),
        AssetRevisionError
      );
      assert.equal(
        (await adapter.versions(actor, 'document'))[0].retired,
        false
      );
      await assert.rejects(
        adapter.download(actor, stored.reference.versionId),
        { code: 'ASSET_BINARY_MISSING' }
      );
    } finally {
      await racing.close();
    }
    await adapter.delete(actor, stored.reference.versionId, { binary: false });
    assert.equal((await adapter.versions(actor, 'document'))[0].retired, true);
  }));
test('shared catalog leases protect in-flight owned uploads from repair; close drains without closing files', () =>
  fixture(async ({ files, catalog, config }) => {
    let release, started;
    /** Host-controlled start gate avoids relying on scheduling delays. */
    const ready = new Promise((r) => (started = r));
    /** Host-controlled unresolved sink/backend work used to assert actual-settlement drain. */
    const wait = new Promise((r) => (release = r));
    /** Injected backend whose actual settlement remains controlled by the test gate. */
    const slow = createAssetStorage({
      ...config,
      files: {
        ...files,
        put: async (...args) => {
          /** Actual mutation/deletion receipt checked for explicit committed/audit status. */
          const result = await files.put(...args);
          started();
          await wait;
          return result;
        },
      },
    });
    /** Independent synthetic tenant or repair adapter; no shared permission is inferred. */
    const other = createAssetStorage({ ...config, approveRepair: () => true });
    /** Outstanding mutation promise; its actual settlement must precede close completion. */
    const work = slow.upload(actor, input(), bytes);
    await ready;
    assert.equal((await other.previewRepair(actor)).items.length, 0);
    let closed = false;
    /** Observed close promise; it must not finish before the injected work settles. */
    const closing = slow.close().then(() => (closed = true));
    await Promise.resolve();
    assert.equal(closed, false);
    await assert.rejects(slow.versions(actor, 'document'), {
      code: 'ASSET_CLOSED',
    });
    release();
    await work;
    await closing;
    assert.equal(catalog.size, 1);
    assert.ok(await files.list('assets', { storage: 'disk' }));
    await other.close();
  }));
test('readback failure does not publish metadata; authorization receives exact address/version context', () =>
  fixture(async ({ files, catalog, config }) => {
    /** Injected backend returning wrong bytes; integrity must fail before exposure/publication. */
    const corrupt = createAssetStorage({
      ...config,
      files: {
        ...files,
        read: async () =>
          (async function* () {
            yield Buffer.alloc(bytes.length);
          })(),
      },
    });
    try {
      await assert.rejects(corrupt.upload(actor, input(), bytes), {
        code: 'ASSET_INTEGRITY',
      });
      assert.equal(catalog.size, 0);
    } finally {
      await corrupt.close();
    }
    /** Captured authorization contexts checked for exact address/version/ownership. */
    const seen = [];
    /** Adapter whose explicit policy denies registration while allowing upload. */
    const restricted = createAssetStorage({
      ...config,
      authorize: (who, action, id, context) => {
        seen.push({ action, context });
        return action !== 'register';
      },
    });
    try {
      /** Verified owned upload receipt used to inspect authorization context. */
      const own = await restricted.upload(actor, input(), bytes);
      assert.equal(seen[0].context.versionId, own.reference.versionId);
      await assert.rejects(
        restricted.register(actor, input('denied'), own.reference.address),
        { code: 'ASSET_FORBIDDEN' }
      );
      assert.deepEqual(seen.at(-1).context.address, own.reference.address);
    } finally {
      await restricted.close();
    }
  }));
