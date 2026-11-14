import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
/** Promisified subprocess helper with fixed argument arrays and no shell interpolation. */
const exec = promisify(execFile);
/** Installed test dependency resolver; not arbitrary source evaluation. */
const require = createRequire(import.meta.url);
/** Print executable JavaScript separately from documentation before checking Node-only spellings.
 * @param {string} source - Emitted browser JavaScript inspected as syntax, never executed here.
 * @returns {string} Printed JavaScript with comments removed and executable tokens retained.
 */
function runtimeSource(source) {
  /** Installed test/compiler dependency; the browser package does not import this parser. */
  const parser = require('typescript');
  return parser
    .createPrinter({ removeComments: true })
    .printFile(
      parser.createSourceFile(
        import.meta.url,
        source,
        parser.ScriptTarget.Latest,
        true,
        parser.ScriptKind.JS
      )
    );
}
test('packed root stays independent of optional assets and browser example compiles without Node ambient types', async () => {
  /** Owned isolated temporary fixture directory, removed by the enclosing cleanup. */
  const root = await mkdtemp(join(tmpdir(), 'zx-media-consumer-'));
  /** Actual package source root used for local archive/export verification. */
  const packageRoot = resolve(import.meta.dirname, '..');
  /** Repository root used only to locate required local package/test inputs. */
  const workspace = resolve(packageRoot, '../../..');
  /** Pack and extract only a local workspace package into the owned consumer root; no dependency install or generated application execution.
   * @param {string} path - Local package path selected by the test.
   * @param {string} name - Expected public package identity for extraction.
   * @returns {Promise<unknown>} Fixture-owned result or explicit simulated failure; no live-provider guarantee.
   */
  async function install(path, name) {
    /** Local npm pack JSON result; archive shape is normalized for supported npm versions. */
    const output = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', root], {
          cwd: path,
          env: { ...process.env, npm_config_cache: join(root, 'cache') },
        })
      ).stdout
    );
    /** Selected local package archive receipt, never a downloaded dependency. */
    const packed = Array.isArray(output) ? output[0] : Object.values(output)[0];
    /** Owned isolated extraction destination inside the temporary consumer. */
    const destination = join(root, 'node_modules', name);
    await mkdir(destination, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(root, packed.filename),
      '--strip-components=1',
      '-C',
      destination,
    ]);
    return destination;
  }
  try {
    await install(join(workspace, 'packages/@zeruxjs/files'), '@zeruxjs/files');
    /** Extracted local package path used to inspect real shipped browser artifacts. */
    const installed = await install(packageRoot, '@zeruxjs/media');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module' })
    );
    await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {createMediaStore} from '@zeruxjs/media';import {createMediaTransfers} from '@zeruxjs/media/browser';import {createRequire} from 'node:module';if(typeof createMediaStore!=='function'||typeof createMediaTransfers!=='function')throw Error('exports');try{createRequire(import.meta.url).resolve('@zeruxjs/asset-manager');throw Error('unexpected optional dependency');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}`,
      ],
      { cwd: root }
    );
    /** Emitted browser entry inspected as JavaScript, without executing source documents. */
    const browser = await readFile(join(installed, 'dist/browser.mjs'), 'utf8');
    assert.doesNotMatch(
      runtimeSource(browser),
      /node:|require\(|\bBuffer\b|\bprocess\b/
    );
    /** Emitted playback entry or its public README example; Node-free boundary is checked. */
    const playback = await readFile(
      join(installed, 'dist/playback.mjs'),
      'utf8'
    );
    assert.doesNotMatch(
      runtimeSource(playback),
      /node:|require\(|\bBuffer\b|\bprocess\b/
    );
    /** Current authored package README used as the public consumer contract. */
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    /** Authored public-import browser example compiled in a DOM-only consumer. */
    const example = readme
      .split('## Browser transfers')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(join(root, 'example.mts'), example);
    /** Authored playback example compiled without ambient Node types. */
    const playbackExample = readme
      .split('## Playback controller and optional controls')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(join(root, 'playback-example.mts'), playbackExample);
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: [],
          strict: true,
          outDir: 'out',
        },
        include: ['example.mts', 'playback-example.mts'],
      })
    );
    await exec(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
      { cwd: root }
    );
    await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {transferReport} from './out/example.mjs';globalThis.location=new URL('https://media.test/');let bytes=0;await transferReport(new WritableStream({write(chunk){bytes+=chunk.length;}}),new AbortController().signal,async()=>new Response('hello',{headers:{'content-length':'5'}}));if(bytes!==5)throw Error('example');`,
      ],
      { cwd: root }
    );
    await install(
      join(workspace, 'packages/@zeruxjs/asset-manager'),
      '@zeruxjs/asset-manager'
    );
    await symlink(
      join(workspace, 'node_modules/@types'),
      join(root, 'node_modules/@types'),
      'dir'
    );
    await writeFile(
      join(root, 'server.mts'),
      `import {createMediaAssetService} from '@zeruxjs/media/assets';import {createMediaResumableHandler} from '@zeruxjs/media/resumable';import {createMediaTranscoder} from '@zeruxjs/media/transcode';import {createAssetStorage} from '@zeruxjs/asset-manager/storage';export type Assets=ReturnType<typeof createAssetStorage>;export const adapt=(assets:Assets)=>createMediaAssetService({assets,identify:()=>({tenant:'tenant',subject:'user'}),authorizeRequest:()=>true});export const protocolFactory=createMediaResumableHandler;export const transcodeFactory=createMediaTranscoder;`
    );
    await exec(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--types',
        'node',
        'server.mts',
      ],
      { cwd: root }
    );
    /** Extracted package manifest checked against its real export/dependency contract. */
    const manifest = JSON.parse(
      await readFile(join(installed, 'package.json'), 'utf8')
    );
    assert.equal(manifest.version, '0.0.4');
    assert.ok(manifest.exports['./browser'].import.endsWith('.mjs'));
    assert.ok(manifest.exports['./playback'].import.endsWith('.mjs'));
    assert.ok(manifest.exports['./transcode']);
    assert.equal(
      manifest.peerDependenciesMeta['@zeruxjs/asset-manager'].optional,
      true
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browser dependency inspection ignores documentation but retains executable Node globals', () => {
  assert.doesNotMatch(
    runtimeSource(
      '/** process-local values and Buffer ownership docs */ export const safe = 1;'
    ),
    /node:|require\(|\bprocess\b|\bBuffer\b/
  );
  // Every actual forbidden runtime form must still survive comment removal and fail the boundary check.
  // Exercise the fixed synthetic cases or release only handles owned by this fixture.
  // Exercise the fixed synthetic cases or release only handles owned by this fixture.
  for (const source of [
    'export const unsafe = process.version;',
    'export const unsafe = Buffer.alloc(1);',
    'const unsafe = require("node:fs");',
    'import unsafe from "node:fs";',
  ]) {
    assert.match(
      runtimeSource(source),
      /node:|require\(|\bprocess\b|\bBuffer\b/
    );
  }
});
