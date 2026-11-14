import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
/**
 * Test fixture require.
 */
const require = createRequire(import.meta.url);

test('packed public declarations and example work without source aliases or Node ambient types', () => {
  /**
   * Test fixture temporary.
   */
  const temporary = mkdtempSync(join(tmpdir(), 'zyro-components-'));
  /**
   * Test helper run.
   * @param {unknown} command - Test input for this helper.
   * @param {unknown} args - Test input for this helper.
   * @param {unknown} cwd - Test input for this helper.
   * @returns {unknown} Result produced by this test helper.
   */
  const run = (command, args, cwd) =>
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(temporary, 'cache') },
    });
  try {
    /**
     * Test fixture report.
     */
    const report = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
        resolve('.')
      )
    );
    /**
     * Test fixture archive.
     */
    const archive = (Array.isArray(report) ? report : Object.values(report))[0]
      .filename;
    /**
     * Test fixture consumer.
     */
    const consumer = join(temporary, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, 'package.json'),
      '{"type":"module","private":true}'
    );
    /**
     * Test fixture dependencies.
     */
    const dependencies = [];
    for (const directory of [
      resolve(
        dirname(
          fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))
        ),
        '..'
      ),
      dirname(require.resolve('jose/package.json')),
    ]) {
      /**
       * Test fixture packed.
       */
      const packed = JSON.parse(
        run(
          'npm',
          [
            'pack',
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            temporary,
          ],
          directory
        )
      );
      dependencies.push(
        join(
          temporary,
          (Array.isArray(packed) ? packed : Object.values(packed))[0].filename
        )
      );
    }
    run(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        join(temporary, archive),
        ...dependencies,
      ],
      consumer
    );
    writeFileSync(
      join(consumer, 'example.ts'),
      `import {signal, watch, useState} from 'zyrojs';
import {defineComponent, h, render, unmount, renderToString} from 'zyrojs/dom';
import {renderToHydratable} from 'zyrojs/server';
import {hydrate} from 'zyrojs/hydrate';
import {useId} from 'zyrojs/component';
const Counter = defineComponent<{label:string}>(() => {
  const [count, setCount] = useState(0);
  return props => h('button', {onClick:()=>setCount(count()+1)}, props.label, ()=>count());
});
const node = h(Counter, {label:'Clicks: '});
const output=renderToHydratable(Counter,{label:'Clicks: '},{idPrefix:'test',validateProps:()=>({label:'Clicks: '})});
if(typeof document!=='undefined'){hydrate(Counter,document.createElement('div'),{data:output.data,validateProps:()=>({label:'Clicks: '})});}
const id:()=>string=useId;
// @ts-expect-error component props are checked
h(Counter, {label:1});
const state=signal(1); const stop=watch(()=>state.value, value=>{const checked:number=value;});stop();
if(renderToString(node)!=='<button>Clicks: 0</button>')throw Error('public example failed');
if(typeof document!=='undefined'){const root=document.createElement('main');render(node,root);unmount(root);}
// @ts-expect-error browser declarations do not expose Node globals
process.cwd();
`
    );
    /**
     * Test fixture readme.
     */
    const readme = readFileSync(
      new URL('../README.md', import.meta.url),
      'utf8'
    );
    for (const name of ['counter.ts', 'server.ts', 'browser.ts']) {
      /**
       * Test fixture marker.
       */
      const marker = '```ts title="' + name + '"\n';
      /**
       * Test fixture example.
       */
      const example = readme.split(marker)[1]?.split('```')[0];
      assert.ok(example, 'README example missing: ' + name);
      writeFileSync(join(consumer, name), example);
    }
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
        include: ['example.ts', 'counter.ts', 'server.ts', 'browser.ts'],
      })
    );
    run(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
      consumer
    );
    // Remove the negative runtime assertions; they exist solely for the declaration check.
    writeFileSync(
      join(consumer, 'check.ts'),
      `import {renderToHydratable} from 'zyrojs/server';import {hydrate} from 'zyrojs/hydrate';import {useId} from 'zyrojs/component';if(typeof hydrate!=='function'||typeof useId!=='function')throw Error('missing exports');const output=renderToHydratable(()=>null,{}, {idPrefix:'pack',validateProps:()=>({})});if(!output.html.includes('zyro-h1:pack'))throw Error('SSR failed');import {defineComponent,h,renderToString} from 'zyrojs/dom';import {useState,watch,ref} from 'zyrojs';const C=defineComponent(()=>{const [n]=useState(2);return p=>h('b',{},p.label,n());});if(renderToString(h(C,{label:'ok'}))!=='<b>ok2</b>')throw Error('public example failed');const s=ref(0);let n=0;const stop=watch(()=>s.value,()=>{n++});s.value++;stop();s.value++;if(n!==1)throw Error('watch leaked');`
    );
    assert.doesNotThrow(() => run(process.execPath, ['check.ts'], consumer));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
