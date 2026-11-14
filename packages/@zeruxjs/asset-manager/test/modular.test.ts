import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAssetManager,
  saveAssetCatalog,
  loadAssetCatalog,
} from '../dist/index.js';
test('asset catalog mutation, filtering, snapshots and persistence', async () => {
  /** Standalone fixture metadata catalog. */
  const assets = createAssetManager();
  /** Synthetic descriptive logo/variant fixture; no URL is fetched. */
  const logo = {
    id: 'brand/logo',
    name: 'Brand Logo',
    type: 'image',
    url: 'https://example.com/logo.png',
    tags: ['branding'],
  };
  assets.add(logo);
  assert.equal(assets.size, 1);
  assets.update('brand/logo', { name: 'New Logo' });
  assert.equal(assets.list({ tag: 'branding' }).length, 1);
  assert.equal(assets.get('brand/logo').name, 'New Logo');
  assert.throws(() =>
    assets.import(
      JSON.stringify([
        { id: 'good', name: 'Ok', type: 'other' },
        { id: 'bad', name: 'Not okay', type: 'wrong' },
      ])
    )
  );
  assert.equal(assets.size, 1, 'import should be atomic');
  /** Owned temporary private persistence directory. */
  const dir = await mkdtemp(join(tmpdir(), 'zerux-assets-'));
  /** Private fixture snapshot path under the owned temporary directory. */
  const file = join(dir, 'assets.json');
  try {
    await saveAssetCatalog(assets, file);
    /** New fixture catalog/workflow loaded from persisted history. */
    const restored = await loadAssetCatalog(file);
    assert.equal(restored.get('brand/logo').name, 'New Logo');
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
  assert.throws(
    () => assets.add({ ...logo, url: 'javascript:alert(1)' }),
    /Unsafe/
  );
});
