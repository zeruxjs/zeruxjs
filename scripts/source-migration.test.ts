import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getFolders, getSafeName, stopProcess } from './helper.ts';
import { inspectMigration } from './check-source-migration.ts';
import { optimizeStaticAssets } from './static-site-assets.ts';

test('typed manifest discovery remains inert and rejects an absent process identifier', async () => {
  /** Owned synthetic workspace tree; no operator process or environment state is accessed. */
  const root = await mkdtemp(join(tmpdir(), 'zerux-discovery-types-'));
  try {
    await mkdir(join(root, 'public'));
    await mkdir(join(root, 'private'));
    await writeFile(
      join(root, 'public/package.json'),
      JSON.stringify({
        name: '@example/public',
        scripts: { dev: 'must never execute' },
      })
    );
    await writeFile(
      join(root, 'private/package.json'),
      JSON.stringify({
        name: 'private',
        private: true,
        scripts: { dev: 'must never execute' },
      })
    );
    assert.deepEqual(getFolders([root], 'dev', true), [
      { dir: join(root, 'public'), pkgName: '@example/public' },
    ]);
    assert.equal(getSafeName('@example/public'), 'example-public');
    assert.equal(
      stopProcess({
        name: 'absent',
        safeName: 'absent',
        dir: root,
        pid: undefined,
        ports: [],
      }),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('typed browser entry compiles to the stable JavaScript URL and compiler scratch is cleaned on failure', async () => {
  /** Owned candidate tree; this test never builds or starts a workspace application. */
  const root = await mkdtemp(join(tmpdir(), 'zerux-browser-types-'));
  try {
    await mkdir(join(root, 'assets'));
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/docs/assets/site.css"></head><body><script type="module" src="/docs/assets/fixture.js"></script></body></html>'
    );
    await writeFile(
      join(root, 'fixture.ts'),
      'const value: number = 42; document.body.dataset.answer = String(value); export {};'
    );
    /** Explicit temporary candidate passed to the real shared build owner. */
    const options = {
      directory: root,
      htmlFiles: [join(root, 'index.html')],
      css: 'assets/site.css',
      entries: ['fixture.ts'],
      sourceRoot: root,
      basePath: '/docs',
      zuix: { preflight: false },
      production: true,
    };
    /** Actual output manifest, including the compiled representation hash. */
    const result = await optimizeStaticAssets(options);
    assert.ok(
      result.assets.some((asset) => asset.url === '/docs/assets/fixture.js')
    );
    assert.match(await readFile(join(root, 'assets/fixture.js'), 'utf8'), /42/);
    assert.equal(
      (await readdir(join(root, 'assets'))).includes('fixture.ts'),
      false
    );
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.asset-build-')),
      false
    );
    await writeFile(
      join(root, 'fixture.ts'),
      'import "missing-migration-fixture-dependency";'
    );
    await assert.rejects(optimizeStaticAssets(options));
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith('.asset-build-')),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('migration inventory rejects renamed-only JavaScript tests and stale handwritten exceptions', () => {
  /** Exact configuration exception used by this pure policy fixture. */
  const retained = [
    {
      kind: 'configuration',
      reason: 'Fixture tool requires ESM JavaScript',
      paths: ['fixture.config.mjs'],
    },
  ];
  assert.deepEqual(
    inspectMigration(
      ['fixture.config.mjs', 'fixture.test.mjs', 'typed.test.ts'],
      retained
    ),
    { unexpected: ['fixture.test.mjs'], stale: [] }
  );
  assert.deepEqual(inspectMigration(['typed.test.ts'], retained), {
    unexpected: [],
    stale: ['fixture.config.mjs'],
  });
  assert.throws(
    () => inspectMigration([], [...retained, ...retained]),
    /duplicate/
  );
});
