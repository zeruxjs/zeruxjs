import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSearchIndex } from '../dist/index.js';
import { saveSearchSnapshot, loadSearchSnapshot } from '../dist/persistence.js';
import { createSearchHandler } from '../dist/http.js';
test('atomic snapshot restore and rollback on corrupted file', async () => {
  /** Owned temporary directory, removed recursively in finally; never an operator data path. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'search-snapshot-'));
  /** Snapshot path inside the owned temporary fixture directory. */
  const file = path.join(dir, 'index.json');
  try {
    /** Independent bounded in-memory index used only by this example or fixture. */
    const index = createSearchIndex();
    index.add({ id: 'a', text: 'hello' });
    assert.equal(await loadSearchSnapshot(file, index), false);
    await saveSearchSnapshot(file, index);
    index.add({ id: 'b', text: 'world' });
    assert.equal(await loadSearchSnapshot(file, index), true);
    assert.equal(index.size, 1);
    assert.equal(index.get('b'), undefined);
    await writeFile(file, 'corrupted JSON');
    await assert.rejects(loadSearchSnapshot(file, index));
    assert.equal(index.size, 1);
    await assert.rejects(
      saveSearchSnapshot(file, index, { maxBytes: 256 / 2 }),
      RangeError
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('snapshot refuses symlink targets and traversal directory aliases', async () => {
  /** Owned temporary directory, removed recursively in finally; never an operator data path. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'search-symlink-'));
  try {
    /** Independent bounded in-memory index used only by this example or fixture. */
    const index = createSearchIndex();
    /** Owned synthetic target whose bytes must survive rejected symlink writes. */
    const target = path.join(dir, 'real');
    /** Owned symlink fixture that persistence must reject rather than follow. */
    const link = path.join(dir, 'snapshot.json');
    await writeFile(target, '{}');
    await symlink(target, link);
    await assert.rejects(saveSearchSnapshot(link, index));
    await assert.rejects(loadSearchSnapshot(link, index));
    assert.equal(
      await (await import('node:fs/promises')).readFile(target, 'utf8'),
      '{}'
    );
    /** Owned directory symlink fixture used to reject traversal through canonical aliases. */
    const alias = path.join(dir, 'alias');
    await symlink(dir, alias, 'dir');
    await assert.rejects(
      saveSearchSnapshot(path.join(alias, 'snapshot.json'), index)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('filtered results cannot leak suggestions or get public cached', async () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex();
  index.add({ id: 'secret', text: 'private secret' });
  assert.throws(() =>
    createSearchHandler({ index, filter: () => false, cacheSeconds: 10 })
  );
  /** Inert synthetic request handler; tenant authorization remains outside its visibility predicate. */
  const handler = createSearchHandler({ index, filter: () => false });
  assert.equal(
    handler(new Request('http://localhost/?q=se&suggest=1')).status,
    403
  );
  /** Synthetic private response checked without a live listener. */
  const response = handler(new Request('http://localhost/?q=secret'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).results, []);
});
test('opt-in V2 disk snapshots reject analyzer mismatch without clearing the receiver', async () => {
  /** Owned temporary directory, removed recursively in finally; never an operator data path. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'search-v2-'));
  try {
    /** Snapshot path inside the owned temporary fixture directory. */
    const file = path.join(dir, 'index.json');
    /** Independent bounded in-memory index used only by this example or fixture. */
    const index = createSearchIndex({
      analyzer: { locale: 'en', diacritics: 'fold' },
    });
    index.add({ id: 'a', text: 'Café' });
    await saveSearchSnapshot(file, index, { snapshotVersion: 2 });
    /** Independent receiver with intentionally incompatible V2 analysis policy. */
    const incompatible = createSearchIndex({
      analyzer: { locale: 'en', caseSensitive: true },
    });
    incompatible.add({ id: 'keep', text: 'Keep' });
    await assert.rejects(
      loadSearchSnapshot(file, incompatible),
      /Incompatible/
    );
    assert.equal(incompatible.has('keep'), true);
    /** Independent receiver with compatible V2 policy used to prove durable reload. */
    const receiver = createSearchIndex({
      analyzer: { locale: 'en', diacritics: 'fold' },
    });
    await loadSearchSnapshot(file, receiver);
    assert.equal(receiver.search('cafe').length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
