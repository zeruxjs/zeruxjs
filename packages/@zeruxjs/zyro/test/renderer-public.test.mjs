import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
/** Local resolver for explicit installed tooling; no discovered package code is executed. */
const require = createRequire(import.meta.url);
test('packed core needs no ZyroJS runtime; renderer subpath owns types through real installed exports', () => {
  /** Owned offline consumer/cache root removed in finally. */
  const root = mkdtempSync(join(tmpdir(), 'zyro-bridge-public-'));
  /** Invoke a fixed trusted fixture executable without shell interpolation.
   * @param {string} command - Fixed trusted executable.
   * @param {string[]} args - Explicit argument array.
   * @param {string} cwd - Trusted package or owned fixture directory.
   * @returns {string} Captured UTF-8 process output.
   */
  const run = (command, args, cwd) =>
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(root, 'cache') },
    });
  /** Archive one explicitly selected installed package without lifecycle scripts.
   * @param {string} directory - Trusted local package root.
   * @returns {string} Archive path inside the owned temporary directory.
   */
  const pack = (directory) => {
    /** Parsed npm archive metadata used only to identify its generated tarball. */
    const result = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
        directory
      )
    );
    return join(
      root,
      (Array.isArray(result) ? result : Object.values(result))[0].filename
    );
  };
  try {
    /** Built bridge archive installed offline without optional runtime peers first. */
    const archive = pack(resolve('.'));
    /** Owned private consumer directory for real public export/type checks. */
    const consumer = join(root, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, 'package.json'),
      '{"private":true,"type":"module"}'
    );
    run(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--legacy-peer-deps',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        archive,
      ],
      consumer
    );
    assert.equal(existsSync(join(consumer, 'node_modules/zyrojs')), false);
    writeFileSync(
      join(consumer, 'core.ts'),
      `import {createObservable} from '@zeruxjs/zyro';const source=createObservable(1);source.set(2);`
    );
    run(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        'core.ts',
        '--noEmit',
        '--module',
        'NodeNext',
        '--target',
        'ES2022',
        '--types',
        'node',
        '--typeRoots',
        resolve('../../../node_modules/@types'),
      ],
      consumer
    );
    writeFileSync(
      join(consumer, 'core.mjs'),
      `import {createObservable} from '@zeruxjs/zyro';if(createObservable(2).get()!==2)throw Error('core failed');`
    );
    run(process.execPath, ['core.mjs'], consumer);
    /** Explicit local peer/security archives installed without network or lifecycle scripts. */
    const dependencies = [
      pack(resolve('../../zyrojs')),
      pack(
        resolve(
          dirname(
            fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))
          ),
          '..'
        )
      ),
      pack(dirname(require.resolve('jose/package.json'))),
    ];
    run(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        ...dependencies,
      ],
      consumer
    );
    writeFileSync(
      join(consumer, 'consumer.ts'),
      `import * as Zyro from 'zyrojs/component';
import {createObservable} from '@zeruxjs/zyro';import {createZyroRendererBridge} from '@zeruxjs/zyro/renderer';
const source=createObservable(1),bridge=createZyroRendererBridge(Zyro),read=bridge.read(source);
const value:number=read.value;
// @ts-expect-error a readable conversion is read-only
read.value=2;
// @ts-expect-error selection retains exact inferred type
const wrong:string=bridge.select(source,n=>n+1).value;
const writable=bridge.write(source);writable.value=2;bridge.destroy();
`
    );
    /** Authored package README supplying the public-import Counter example. */
    const readme = readFileSync(
      new URL('../README.md', import.meta.url),
      'utf8'
    );
    /** Exact authored example text compiled against installed public declarations. */
    const example = readme
      .split('```ts title="counter.ts"\n')[1]
      ?.split('```')[0];
    assert.ok(example, 'README example missing');
    writeFileSync(join(consumer, 'counter.ts'), example);
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          types: [],
          strict: true,
          noEmitOnError: true,
          outDir: 'out',
        },
        include: ['consumer.ts', 'counter.ts'],
      })
    );
    run(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
      consumer
    );
    writeFileSync(
      join(consumer, 'check.mjs'),
      `import * as Zyro from 'zyrojs/component';import {createZyroRendererBridge} from '@zeruxjs/zyro/renderer';import {createObservable} from '@zeruxjs/zyro';const source=createObservable(1),bridge=createZyroRendererBridge(Zyro),view=bridge.write(source);view.value=4;if(source.get()!==4)throw Error('write failed');bridge.destroy();`
    );
    run(process.execPath, ['check.mjs'], consumer);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
