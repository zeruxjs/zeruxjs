import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
/** Local resolver for installed tooling; no arbitrary package execution is discovered. */
const require = createRequire(import.meta.url);
test('core stays peer-free; packed Vue entries and authored example use real installed exports', () => {
  /** Owned offline-consumer root and npm cache, removed in finally. */
  const temporary = mkdtempSync(join(tmpdir(), 'vue-render-public-'));
  /** Run fixed trusted fixture commands with argument arrays and isolated cwd.
   * @param {string} command - Fixed executable selected by this test.
   * @param {string[]} args - Explicit argument array without shell interpolation.
   * @param {string} cwd - Owned fixture or package directory.
   * @returns {string} Captured UTF-8 process output.
   */
  const run = (command, args, cwd) =>
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(temporary, 'cache') },
    });
  /** Archive an explicitly selected installed package without lifecycle scripts.
   * @param {string} directory - Trusted installed package root.
   * @returns {string} Archive path within the owned temporary directory.
   */
  const pack = (directory) => {
    /** Parsed npm archive metadata; used only to locate the generated tarball. */
    const report = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
        directory
      )
    );
    return join(
      temporary,
      (Array.isArray(report) ? report : Object.values(report))[0].filename
    );
  };
  try {
    /** Built Vue package archive installed into the isolated offline consumer. */
    const archive = pack(resolve('.'));
    /** Owned private consumer directory without optional Vue peers initially. */
    const consumer = join(temporary, 'consumer');
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
        '--legacy-peer-deps',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        archive,
      ],
      consumer
    );
    assert.equal(existsSync(join(consumer, 'node_modules/vue')), false);
    writeFileSync(
      join(consumer, 'core.ts'),
      `import {createVueRef} from '@zeruxjs/vue';const ref=createVueRef(1);ref.value=2;`
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
      join(consumer, 'absent.mjs'),
      `import assert from 'node:assert/strict';import {createVueRef} from '@zeruxjs/vue';import {createVueView} from '@zeruxjs/vue/rendering';import {renderVueToString} from '@zeruxjs/vue/server';let closed=0;assert.equal(createVueRef(1).value,1);await assert.rejects(renderVueToString(createVueView({render:()=>null}),{onDispose:()=>closed++}),error=>error.code==='VUE_DEPENDENCY_UNAVAILABLE');assert.equal(closed,1);`
    );
    run(process.execPath, ['absent.mjs'], consumer);
    /** Deduplicated installed dependency roots selected for the offline fixture. */
    const directories = new Map();
    /** Resolve one explicitly named installed dependency without executing its module.
     * @param {string} name - Trusted dependency name from installed manifests.
     * @param {string} from - Trusted local resolution root.
     * @returns {string} Matching package root or throws when unavailable.
     */
    const packageDirectory = (name, from) => {
      /** Local package resolver scoped to the selected installed dependency root. */
      const local = createRequire(join(from, 'package.json'));
      let path;
      try {
        path = local.resolve(name + '/package.json');
      } catch {
        path = local.resolve(name);
      }
      let directory = dirname(path);
      while (directory !== dirname(directory)) {
        /** Installed manifest path or parsed dependency metadata for archive traversal. */
        const manifest = join(directory, 'package.json');
        if (existsSync(manifest)) {
          /** Parsed installed manifest used to match the requested package name. */
          const data = JSON.parse(readFileSync(manifest, 'utf8'));
          if (data.name === name) {
            return directory;
          }
        }
        directory = dirname(directory);
      }
      throw Error('Installed package not found: ' + name);
    };
    /** Collect installed dependency roots for this temporary offline consumer only.
     * @param {string} directory - Trusted installed package root.
     * @returns {void} Adds unseen dependency roots; optional peer-only packages are excluded.
     */
    const collect = (directory) => {
      /** Installed manifest path or parsed dependency metadata for archive traversal. */
      const manifest = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8')
      );
      /** Package name/version identity deduplicating archive traversal. */
      const key = manifest.name + '@' + manifest.version;
      if (directories.has(key)) {
        return;
      }
      directories.set(key, directory);
      for (const name of Object.keys({
        ...manifest.dependencies,
        ...manifest.peerDependencies,
      })) {
        if (
          manifest.peerDependenciesMeta?.[name]?.optional &&
          !manifest.dependencies?.[name]
        ) {
          continue;
        }
        collect(packageDirectory(name, directory));
      }
    };
    for (const name of ['vue', '@vue/runtime-dom', '@vue/server-renderer']) {
      collect(packageDirectory(name, resolve('.')));
    }
    collect(
      resolve(
        dirname(
          fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))
        ),
        '..'
      )
    );
    /** Explicit local archives installed without network access or lifecycle scripts. */
    const dependencies = [...directories.values()].map(pack);
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
    /** Authored package README supplying the checked public-import example files. */
    const readme = readFileSync(
      new URL('../README.md', import.meta.url),
      'utf8'
    );
    for (const name of [
      'counter.ts',
      'server-example.ts',
      'browser-example.ts',
    ]) {
      /** Exact authored example source extracted for strict consumer compilation. */
      const code = readme
        .split('```ts title="' + name + '"\n')[1]
        ?.split('```')[0];
      assert.ok(code, 'Example missing: ' + name);
      writeFileSync(join(consumer, name), code);
    }
    writeFileSync(
      join(consumer, 'consumer.ts'),
      `import * as Vue from '@vue/runtime-dom';import {createVueBindings} from '@zeruxjs/vue';import {createVueView} from '@zeruxjs/vue/rendering';import {renderVueToString} from '@zeruxjs/vue/server';const bridge=createVueBindings(Vue);const scope=Vue.effectScope();scope.run(()=>{const value=bridge.useStore({getSnapshot:()=>1,subscribe:()=>()=>{}});const checked:number=value.value;
// @ts-expect-error converted snapshots have a read-only value
value.value=2;
});scope.stop();const output:Promise<string>=renderVueToString(createVueView({render:()=>Vue.h('p',null,'ok')}));`
    );
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
        include: [
          'consumer.ts',
          'counter.ts',
          'server-example.ts',
          'browser-example.ts',
        ],
      })
    );
    run(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
      consumer
    );
    writeFileSync(
      join(consumer, 'check.ts'),
      `import {createRequire} from 'node:module';import {renderVueToString} from '@zeruxjs/vue/server';import {createVueView} from '@zeruxjs/vue/rendering';import {Counter} from './out/counter.js';const html=await renderVueToString(createVueView(Counter,{initial:2,label:'Count'}));if(!html.includes('Count')||!html.includes('4'))throw Error('SSR example failed');const require=createRequire(import.meta.url),vueRequire=createRequire(require.resolve('vue/package.json'));if(require.resolve('@vue/runtime-dom')!==vueRequire.resolve('@vue/runtime-dom'))throw Error('duplicate Vue runtime');`
    );
    run(process.execPath, ['check.ts'], consumer);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
