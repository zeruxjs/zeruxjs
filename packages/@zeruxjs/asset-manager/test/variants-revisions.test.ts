import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAssetManager,
  AssetRevisionError,
  listAssetVariants,
  saveAssetCatalog,
  loadAssetCatalog,
} from '../dist/index.js';
/** Synthetic descriptive logo/variant fixture; no URL is fetched. */
const logo = {
  id: 'brand/logo',
  name: 'Logo',
  type: 'image',
  url: 'https://cdn.example/normal.png',
  variants: {
    dark: { url: 'https://cdn.example/dark.png', metadata: { theme: 'dark' } },
    small: { value: 'data-is-stored-only' },
  },
};
test('variant selection, defensive copies, and invalid untrusted variants', () => {
  /** Standalone metadata catalog for variant/revision assertions. */
  const manager = createAssetManager();
  manager.add(logo);
  assert.deepEqual(listAssetVariants(logo), ['dark', 'small']);
  /** Detached resolved variant; changing it must not mutate the original. */
  const dark = manager.resolve('brand/logo', 'dark');
  assert.equal(dark.url, 'https://cdn.example/dark.png');
  dark.metadata.theme = 'modified';
  assert.equal(manager.resolve('brand/logo', 'dark').metadata.theme, 'dark');
  assert.throws(() => manager.resolve('brand/logo', 'missing'), /Unknown/);
  assert.throws(
    () =>
      manager.add({
        ...logo,
        variants: { unsafe: { url: 'javascript:alert(1)' } },
      }),
    /Unsafe/
  );
  assert.equal(
    manager.resolve('brand/logo', 'dark').url,
    'https://cdn.example/dark.png'
  );
});
test('atomic operations, revision checks and snapshot restoration', () => {
  /** Standalone metadata catalog for variant/revision assertions. */
  const manager = createAssetManager();
  manager.add(logo);
  /** Expected local revision before staged atomic operations. */
  const current = manager.revision;
  assert.throws(
    () =>
      manager.apply(
        [
          {
            action: 'add',
            asset: { id: 'new', name: 'New', type: 'color', value: '#fff' },
          },
          { action: 'update', id: 'missing', changes: { name: 'oops' } },
        ],
        current
      ),
    /not found/
  );
  assert.equal(manager.size, 1);
  assert.equal(manager.revision, current);
  assert.throws(
    () => manager.apply([{ action: 'remove', id: 'brand/logo' }], current - 1),
    AssetRevisionError
  );
  /** Expected local catalog revision captured before the injected race. */
  const revision = manager.apply(
    [
      { action: 'update', id: 'brand/logo', changes: { name: 'Changed' } },
      {
        action: 'add',
        asset: { id: 'new', name: 'New', type: 'color', value: '#fff' },
      },
    ],
    current
  );
  assert.equal(revision, current + 1);
  assert.equal(manager.size, 2);
  /** Detached pre-operation catalog/history used for immutability assertions. */
  const snapshot = manager.snapshot();
  /** New fixture catalog/workflow loaded from persisted history. */
  const restored = createAssetManager();
  restored.load(snapshot);
  assert.equal(restored.revision, revision);
  assert.equal(
    restored.resolve('brand/logo', 'dark').url,
    'https://cdn.example/dark.png'
  );
  assert.throws(
    () =>
      restored.load({
        ...snapshot,
        assets: [snapshot.assets[0], snapshot.assets[0]],
      }),
    /Duplicate/
  );
  assert.equal(restored.size, 2);
});
test('atomic catalog persistence rejects symlinks', async () => {
  /** Owned temporary private persistence directory. */
  const dir = await mkdtemp(join(tmpdir(), 'zerux-asset-'));
  try {
    /** Standalone metadata catalog for variant/revision assertions. */
    const manager = createAssetManager();
    manager.add(logo);
    /** Private fixture snapshot path under the owned temporary directory. */
    const file = join(dir, 'catalog.json');
    await saveAssetCatalog(manager, file);
    assert.equal((await loadAssetCatalog(file)).revision, manager.revision);
    /** Deliberate symlink leaf that private persistence must reject. */
    const alias = join(dir, 'alias.json');
    await symlink(file, alias);
    await assert.rejects(loadAssetCatalog(alias), /ELOOP|symbolic/i);
    await assert.rejects(saveAssetCatalog(manager, alias), /not a regular/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
