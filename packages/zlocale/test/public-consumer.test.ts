import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createTypeScriptPreset } from '@zeruxjs/typescript/presets';
/** Explicit package root whose archive/public docs are checked without source aliases. */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
/** Trusted repository root used only to link the explicitly selected optional security peer. */
const workspace = path.resolve(packageRoot, '../..');
/** Resolved installed TypeScript package root, supporting npm hoisting. */
const compiler = path.dirname(
  createRequire(import.meta.url).resolve('typescript/package.json')
);

test('installed archive exports/browser graph/declarations/example work; absent optional peers leave core usable', async () => {
  /** Owned isolated archive/consumer directory removed in finally. */
  const root = await mkdtemp(path.join(tmpdir(), 'zlocale-consumer-'));
  try {
    /** Parsed npm pack metadata; no lifecycle scripts or publication is requested. */
    const packed = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          root,
          '--cache',
          path.join(root, 'npm-cache'),
        ],
        { cwd: packageRoot, encoding: 'utf8' }
      )
    );
    /** Explicit local package archive filename selected from the pack receipt. */
    const archive = (
      Array.isArray(packed) ? packed[0] : Object.values(packed)[0]
    ).filename;
    /** Owned extracted archive directory, never a user installation. */
    const installed = path.join(root, 'node_modules/zlocale');
    await mkdir(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(root, archive),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ type: 'module' })
    );
    /** Authored package README providing the public browser-safe example. */
    const readme = await readFile(path.join(packageRoot, 'README.md'), 'utf8');
    /** Exact public-import example compiled/bundled against installed archive exports. */
    const exampleMatch = readme
      .split('## Incremental catalogs and build extraction')[1]
      .match(/```ts\n([\s\S]*?)```/);
    assert.ok(exampleMatch, 'Authored public TypeScript example is required');
    /** Exact matched source; missing code cannot silently pass this consumer fixture. */
    const example = exampleMatch[1];
    await writeFile(path.join(root, 'example.ts'), example);
    /** Public browser-library tooling preset with no ambient Node runtime types. */
    const preset = createTypeScriptPreset('browser-library');
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        ...preset,
        compilerOptions: {
          ...preset.compilerOptions,
          rootDir: '.',
          noEmit: true,
        },
        include: ['example.ts'],
      })
    );
    execFileSync(
      process.execPath,
      [path.join(compiler, 'bin/tsc'), '-p', path.join(root, 'tsconfig.json')],
      { encoding: 'utf8' }
    );
    /** Actual isolated browser bundle metadata checked for forbidden server/build entries. */
    const browser = await build({
      stdin: {
        contents: example,
        resolveDir: root,
        sourcefile: 'example.ts',
        loader: 'ts',
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
    });
    assert.ok(
      Object.keys(browser.metafile.inputs).every(
        (input) => !/(?:build|node|encoding)\.js$/.test(input)
      )
    );
    await writeFile(
      path.join(root, 'missing.mjs'),
      `import {createI18n} from 'zlocale/browser'; if(createI18n().__('Hello')!=='Hello')throw Error(); for(const entry of ['zlocale/build','zlocale/encoding']){let failed=false;try{await import(entry);}catch(e){failed=e.code==='ERR_MODULE_NOT_FOUND';}if(!failed)throw Error('optional peer should be absent');}`
    );
    execFileSync(process.execPath, [path.join(root, 'missing.mjs')], {
      encoding: 'utf8',
    });
    await symlink(compiler, path.join(root, 'node_modules/typescript'));
    await mkdir(path.join(root, 'node_modules/@zeruxjs'), { recursive: true });
    await symlink(
      path.join(workspace, 'packages/@zeruxjs/security'),
      path.join(root, 'node_modules/@zeruxjs/security')
    );
    await writeFile(
      path.join(root, 'runtime.mjs'),
      `import {extractMessages,compressCatalogs} from 'zlocale/build';import {escapeHtmlText} from 'zlocale/encoding';import {parseCatalogs} from 'zlocale/browser';import {gunzipSync} from 'node:zlib';if(extractMessages('__("Hello")').messages.length!==1)throw Error();if(escapeHtmlText('<')!=='&lt;')throw Error();parseCatalogs(gunzipSync(await compressCatalogs([])).toString());`
    );
    execFileSync(process.execPath, [path.join(root, 'runtime.mjs')], {
      encoding: 'utf8',
    });
    await writeFile(
      path.join(root, 'build-types.ts'),
      `import {extractMessages} from 'zlocale/build';import {escapeHtmlAttribute} from 'zlocale/encoding';const text:string=extractMessages('__("Hello")').messages[0]!.singular;escapeHtmlAttribute(text);`
    );
    execFileSync(
      process.execPath,
      [
        path.join(compiler, 'bin/tsc'),
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        path.join(root, 'build-types.ts'),
      ],
      { encoding: 'utf8' }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
