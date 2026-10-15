import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProjectSources, resolveProductionStructure } from '../dist/commands/project-builder.js';

async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-production-'));
  await fs.mkdir(path.join(rootDir, 'app'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'public'), { recursive: true });
  await fs.writeFile(path.join(rootDir, 'app', 'route.ts'), 'export const answer: number = 42;');
  await fs.writeFile(path.join(rootDir, 'public', 'site.txt'), 'static');
  return { rootDir, close: () => fs.rm(rootDir, { recursive: true, force: true }) };
}

test('build stages compiled source, assets and manifest, production selects staged folders', async () => {
  const f = await fixture();
  try {
    const manifest = await buildProjectSources({ rootDir: f.rootDir, transform: source => source.replace(': number', '') });
    assert.equal(manifest.files, 2);
    assert.equal((await fs.readFile(path.join(f.rootDir, '.zerux/build/app/route.js'), 'utf8')), 'export const answer = 42;');
    assert.equal((await fs.readFile(path.join(f.rootDir, '.zerux/build/public/site.txt'), 'utf8')), 'static');
    const config = await resolveProductionStructure(f.rootDir, 'zerux', {});
    assert.equal(config.structure.app, '.zerux/build/app');
    assert.equal(config.structure.public, '.zerux/build/public');
    assert.ok(!JSON.stringify(manifest).includes('secret'));
  } finally { await f.close(); }
});

test('failed compilation retains previous complete build and removes staging directories', async () => {
  const f = await fixture();
  try {
    await buildProjectSources({ rootDir: f.rootDir, transform: () => 'previous' });
    await assert.rejects(buildProjectSources({ rootDir: f.rootDir, transform: () => { throw Error('syntax invalid'); } }), /syntax invalid/);
    assert.equal(await fs.readFile(path.join(f.rootDir, '.zerux/build/app/route.js'), 'utf8'), 'previous');
    const listing = await fs.readdir(path.join(f.rootDir, '.zerux'));
    assert.deepEqual(listing, ['build']);
  } finally { await f.close(); }
});

test('symlink build sources are blocked; project traversal is rejected', async () => {
  const f = await fixture();
  try {
    await fs.symlink('/etc/hosts', path.join(f.rootDir, 'app', 'untrusted.txt'));
    await assert.rejects(buildProjectSources({ rootDir: f.rootDir, transform: s => s }), /Symlink/);
    await assert.rejects(buildProjectSources({ rootDir: f.rootDir, config: { structure: { app: '../outside' } }, transform: s => s }), /Invalid project source/);
  } finally { await f.close(); }
});

test('missing manifest uses source directories; malformed manifest fails closed', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await resolveProductionStructure(f.rootDir, 'zerux', {}), {});
    await fs.mkdir(path.join(f.rootDir, '.zerux/build'), { recursive: true });
    await fs.writeFile(path.join(f.rootDir, '.zerux/build/build-manifest.json'), '{"schema":2}');
    await assert.rejects(resolveProductionStructure(f.rootDir, 'zerux', {}), /Invalid production build manifest/);
  } finally { await f.close(); }
});

test('custom output directory and source entry point are supported without activating source in production', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.rootDir, 'index.ts'), 'export default function start() { return 1; }');
    const config = { outDir: '.local-runtime' };
    await buildProjectSources({ rootDir: f.rootDir, config, transform: src => src });
    const resolved = await resolveProductionStructure(f.rootDir, 'zerux', config);
    assert.equal(resolved.entryPoint, '.local-runtime/build/index');
    assert.equal(resolved.structure.app, '.local-runtime/build/app');
    assert.equal(await fs.readFile(path.join(f.rootDir, '.local-runtime/build/index.js'), 'utf8'), 'export default function start() { return 1; }');
  } finally { await f.close(); }
});

test('production build never follows linked output directories or manifest files', async () => {
  const f = await fixture(); const other = await fixture();
  try {
    await fs.symlink(other.rootDir, path.join(f.rootDir, '.zerux'));
    await assert.rejects(buildProjectSources({ rootDir: f.rootDir, transform: src => src }), /Unsafe build output/);
    await fs.unlink(path.join(f.rootDir, '.zerux'));
    await buildProjectSources({ rootDir: f.rootDir, transform: src => src });
    const file = path.join(f.rootDir, '.zerux/build/build-manifest.json');
    await fs.unlink(file);
    await fs.symlink('/etc/hosts', file);
    await assert.rejects(resolveProductionStructure(f.rootDir, 'zerux', {}), /Unsafe production build manifest/);
  } finally { await f.close(); await other.close(); }
});

test('real installed TypeScript compiler emits executable JS, not just a manifest', async t => {
  const globalTs = path.resolve(path.dirname(process.execPath), '../lib/node_modules/typescript');
  if (!(await fs.stat(globalTs).catch(() => null))) return t.skip('Installed TypeScript unavailable');
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.rootDir, 'package.json'), JSON.stringify({ type: 'module' }));
    await fs.mkdir(path.join(f.rootDir, 'node_modules'), { recursive: true });
    await fs.symlink(globalTs, path.join(f.rootDir, 'node_modules', 'typescript'));
    const built = await buildProjectSources({ rootDir: f.rootDir });
    assert.equal(built.files, 2);
    const { answer } = await import('file://' + path.join(f.rootDir, '.zerux/build/app/route.js'));
    assert.equal(answer, 42);
  } finally { await f.close(); }
});

test('output nested inside a source tree is refused without modifying that tree', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      buildProjectSources({ rootDir: f.rootDir, config: { outDir: 'public/generated' }, transform: s => s }),
      /overlaps application source/
    );
    assert.equal(await fs.readFile(path.join(f.rootDir, 'public/site.txt'), 'utf8'), 'static');
    assert.equal(await fs.stat(path.join(f.rootDir, 'public/generated')).catch(() => null), null);
  } finally { await f.close(); }
});

test('nested symlink output parents are rejected in build and production modes', async () => {
  const f = await fixture(); const external = await fixture();
  try {
    await fs.mkdir(path.join(f.rootDir, '.artifacts'));
    await fs.symlink(external.rootDir, path.join(f.rootDir, '.artifacts', 'linked'));
    const config = { outDir: '.artifacts/linked/output' };
    await assert.rejects(buildProjectSources({ rootDir: f.rootDir, config, transform: s => s }), /Unsafe build output directory/);
    await assert.rejects(resolveProductionStructure(f.rootDir, 'zerux', config), /Unsafe build output directory/);
    assert.equal((await fs.readdir(external.rootDir)).includes('output'), false);
  } finally { await f.close(); await external.close(); }
});
