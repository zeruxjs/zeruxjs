import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as ts from 'typescript';
import { buildTypescript, checkTypes, createTsConfig, registerTypescript, transformTypescript } from '@zeruxjs/typescript';
import { createTypeScriptPreset } from '@zeruxjs/typescript/presets';
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-ts-foundation-'));
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const format = diagnostics => ts.formatDiagnostics(diagnostics, {
  getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n'
});

test('installed exports, generated presets and package-owned declarations', { timeout: 120000 }, () => {
  const root = temporary();
  try {
    const npm = (args, cwd = root) => execFileSync('npm', [...args, '--cache', path.join(root, 'cache')], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    const packed = Object.values(JSON.parse(npm(['pack', path.resolve(import.meta.dirname, '..'), '--ignore-scripts', '--json', '--pack-destination', root])));
    write(root, 'package.json', JSON.stringify({ name: 'typescript-consumer', private: true, type: 'module' }));
    // Pack already installed dependencies too, keeping this check offline and
    // independent of the user's npm cache (which may be read-only).
    const localRequire = createRequire(import.meta.url);
    const dependencies = { '@zeruxjs/typescript': `file:${path.join(root, packed[0].filename)}` };
    for (const name of ['typescript', 'esbuild', '@types/node', '@types/ws', 'undici-types', `@esbuild/${process.platform}-${process.arch}`]) {
      const manifest = localRequire.resolve(name + '/package.json');
      const archive = Object.values(JSON.parse(npm(['pack', path.dirname(manifest), '--ignore-scripts', '--json', '--pack-destination', root])));
      dependencies[name] = `file:${path.join(root, archive[0].filename)}`;
    }
    write(root, 'package.json', JSON.stringify({ name: 'typescript-consumer', private: true, type: 'module', dependencies }));
    npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
    const installed = path.join(root, 'node_modules/@zeruxjs/typescript');
    assert.ok(!fs.existsSync(path.join(installed, 'src')));
    const req = createRequire(path.join(root, 'package.json'));
    // require.resolve uses require conditions; use ESM import.meta.resolve instead
    // since this tooling package intentionally exposes ESM-only entries.
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      for (const subpath of ['', '/presets', '/tsconfig', '/build', '/loader']) {
        assert.ok(import.meta.resolve('@zeruxjs/typescript' + subpath).includes('/node_modules/@zeruxjs/typescript/dist/'));
        await import('@zeruxjs/typescript' + subpath);
      }
      assert.throws(() => import.meta.resolve('@zeruxjs/typescript/src/index.js'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    `], { cwd: root });
    for (const preset of ['node-server', 'browser-library', 'mixed-exports']) {
      const directory = path.join(root, preset);
      const code = preset === 'node-server' ? "export const runtime: string = process.version;\n" : preset === 'browser-library' ? "import { createTypeScriptPreset } from '@zeruxjs/typescript/presets'; export const preset = createTypeScriptPreset('browser-library'); export const element: HTMLElement = document.createElement('div');\n" : "export const portable: string = 'hello';\n";
      const exports = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } };
      write(directory, 'package.json', JSON.stringify({ name: preset, type: 'module', exports }));
      write(directory, 'src/index.ts', code);
      createTsConfig(directory, { preset });
      const result = checkTypes({ cwd: directory, files: [] });
      assert.equal(result.status, 'passed', format(result.diagnostics));
      execFileSync(process.execPath, [req.resolve('typescript/bin/tsc'), '-p', directory], { cwd: directory });
      assert.ok(fs.existsSync(path.join(directory, 'dist/index.d.ts')));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).exports, exports);
    }
    write(root, 'src/index.ts', `import { checkTypes, type TypecheckResult } from '@zeruxjs/typescript';
import { createTypeScriptPreset, type TypeScriptPreset } from '@zeruxjs/typescript/presets';
import { createTsConfig } from '@zeruxjs/typescript/tsconfig';
import { buildTypescript } from '@zeruxjs/typescript/build';
import { load } from '@zeruxjs/typescript/loader';
export const preset: TypeScriptPreset = createTypeScriptPreset('node-server');
createTsConfig(process.cwd(), { compilerOptions: preset.compilerOptions, include: preset.include });
export const result: TypecheckResult = checkTypes({files: []});
export { buildTypescript, createTsConfig, load };\n`);
    createTsConfig(root, { preset: 'node-server', compilerOptions: { skipLibCheck: false } });
    const consumer = checkTypes({ cwd: root, files: [], checkDependencies: true });
    assert.equal(consumer.ok, true, format(consumer.diagnostics));
    const browser = path.join(root, 'browser-library');
    write(browser, 'src/denied.ts', 'export const leak = process.version; export const bytes = Buffer.alloc(1);');
    const denied = checkTypes({ cwd: browser, files: [] });
    assert.equal(denied.status, 'failed');
    for (const name of ['process', 'Buffer']) assert.ok(denied.diagnostics.some(d => ts.flattenDiagnosticMessageText(d.messageText, '\n').includes(name)));
    assert.doesNotMatch(fs.readFileSync(path.join(browser, 'dist/index.d.ts'), 'utf8'), /NodeJS|Buffer|node:/);
    delete dependencies.typescript;
    write(root, 'package.json', JSON.stringify({ name: 'typescript-consumer', private: true, type: 'module', dependencies }));
    write(root, 'src/invalid.ts', "import ts from 'typescript'; import '@zeruxjs/typescript/private'; export { ts };\n");
    const invalid = checkTypes({ cwd: root, files: [], checkDependencies: true });
    assert.equal(invalid.status, 'failed');
    assert.ok(invalid.diagnostics.some(d => d.code === 95001));
    assert.ok(invalid.diagnostics.some(d => d.code === 2307));
    dependencies['untyped-fixture'] = '1.0.0';
    write(root, 'package.json', JSON.stringify({ name: 'typescript-consumer', private: true, type: 'module', dependencies }));
    write(root, 'node_modules/untyped-fixture/package.json', JSON.stringify({ name: 'untyped-fixture', type: 'module', exports: './index.js' }));
    write(root, 'node_modules/untyped-fixture/index.js', 'export const value = 1;');
    write(root, 'src/untyped.ts', "import { value } from 'untyped-fixture'; export { value };");
    assert.ok(checkTypes({ cwd: root, files: [], checkDependencies: true }).diagnostics.some(d => d.code === 7016));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preset validation and hook registration have no partial mutation', () => {
  assert.throws(() => createTypeScriptPreset('unknown'), /Unknown/);
  assert.throws(() => transformTypescript(42), /source/);
  assert.throws(() => transformTypescript('', { format: 'unknown' }), /format/);
  const preset = createTypeScriptPreset('browser-library'); preset.compilerOptions.types.push('node');
  assert.deepEqual(createTypeScriptPreset('browser-library').compilerOptions.types, []);
  const req = createRequire(import.meta.url); const before = req.extensions['.ts'];
  assert.throws(() => registerTypescript({ extensions: ['.ts', '.js'] }), /extensions/);
  assert.equal(req.extensions['.ts'], before);
  const dispose = registerTypescript({ extensions: ['.ts'] }); dispose(); dispose();
  assert.equal(req.extensions['.ts'], before);
  const root = temporary();
  try {
    assert.throws(() => createTsConfig(root, { preset: 'invalid' }), /Unknown/);
    assert.throws(() => createTsConfig(root, { compilerOptions: { module: 'invalid' } }), /module/);
    assert.ok(!fs.existsSync(path.join(root, 'tsconfig.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('typecheck cancellation, configuration and dependency failures', () => {
  const root = temporary();
  try {
    write(root, 'src/index.ts', "export const value: number = 'bad';");
    assert.ok(transformTypescript("export const value: number = 'bad';").code);
    const controller = new AbortController(); controller.abort('cancel requested');
    const cancelled = checkTypes({ cwd: root, files: ['src/index.ts'], signal: controller.signal });
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.reason, 'cancel requested'); assert.equal(cancelled.ok, false);
    const failed = checkTypes({ cwd: root, files: ['src/index.ts'] });
    assert.equal(failed.status, 'failed');
    assert.ok(failed.diagnostics.some(d => d.code === 2322));
    assert.ok(checkTypes({ cwd: root, files: ['src/index.ts'], checkDependencies: true }).diagnostics.some(d => d.code === 95002));
    assert.equal(checkTypes({ cwd: root, files: [], configFile: 'missing.json' }).status, 'failed');
    write(root, 'package.json', '{');
    assert.ok(checkTypes({ cwd: root, files: ['src/index.ts'], checkDependencies: true }).diagnostics.some(d => d.code === 95002));
    assert.throws(() => checkTypes({ files: 'src/index.ts' }), /array/);
    assert.equal(checkTypes({ files: [], cancellationToken: { isCancellationRequested: () => true, throwIfCancellationRequested() {} } }).status, 'cancelled');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('browser bundle, raw dependency failures and cancellation cleanup', async () => {
  const root = temporary();
  try {
    write(root, 'src/index.ts', "export const title: string = document.title;");
    const controller = new AbortController();
    await buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: 'dist', platform: 'browser', bundle: true, signal: controller.signal });
    assert.match(fs.readFileSync(path.join(root, 'dist/index.js'), 'utf8'), /document.title/);
    controller.abort();
    await assert.rejects(buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: 'cancelled', signal: controller.signal }), { name: 'AbortError' });
    assert.ok(!fs.existsSync(path.join(root, 'cancelled')));
    const active = new AbortController();
    const pending = buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: 'interrupted', signal: active.signal });
    const abortTimer = setTimeout(() => active.abort('stop'), 0);
    try { await assert.rejects(pending, { name: 'AbortError' }); }
    finally { clearTimeout(abortTimer); }
    // Rebuild after cancellation demonstrates no retained context blocks reuse.
    await buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: 'resumed', signal: new AbortController().signal });
    write(root, 'src/index.ts', "import 'missing-zerux-test-dependency';");
    await assert.rejects(buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: 'bad', bundle: true }), error => error.errors?.some(d => /missing-zerux-test-dependency/.test(d.text)));
    write(root, 'src/index.ts', "import fs from 'node:fs'; export { fs };");
    await assert.rejects(buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: 'bad', bundle: true, platform: 'browser' }), error => error.errors?.length > 0);
    await assert.rejects(buildTypescript({ cwd: root, entryPoints: [], outdir: 'bad' }), /entry point/);
    await assert.rejects(buildTypescript({ cwd: root, entryPoints: ['src/index.ts'], outdir: '.' }), /project root/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
