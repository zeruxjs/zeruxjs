import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
test('core stays peer-free; packed Vue entries and authored example use real installed exports',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'vue-render-public-'));
 const run=(command,args,cwd)=>execFileSync(command,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:join(temporary,'cache')}});
 const pack=directory=>{const report=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',temporary],directory));return join(temporary,(Array.isArray(report)?report:Object.values(report))[0].filename)};
 try{
  const archive=pack(resolve('.')),consumer=join(temporary,'consumer');mkdirSync(consumer);writeFileSync(join(consumer,'package.json'),'{"private":true,"type":"module"}');
  run('npm',['install','--offline','--legacy-peer-deps','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',archive],consumer);
  assert.equal(existsSync(join(consumer,'node_modules/vue')),false);
  writeFileSync(join(consumer,'core.ts'),`import {createVueRef} from '@zeruxjs/vue';const ref=createVueRef(1);ref.value=2;`);
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'core.ts','--noEmit','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',resolve('../../../node_modules/@types')],consumer);
  writeFileSync(join(consumer,'absent.mjs'),`import assert from 'node:assert/strict';import {createVueRef} from '@zeruxjs/vue';import {createVueView} from '@zeruxjs/vue/rendering';import {renderVueToString} from '@zeruxjs/vue/server';let closed=0;assert.equal(createVueRef(1).value,1);await assert.rejects(renderVueToString(createVueView({render:()=>null}),{onDispose:()=>closed++}),error=>error.code==='VUE_DEPENDENCY_UNAVAILABLE');assert.equal(closed,1);`);run(process.execPath,['absent.mjs'],consumer);
  const directories=new Map();
  const packageDirectory=(name,from)=>{
   const local=createRequire(join(from,'package.json'));let path;
   try{path=local.resolve(name+'/package.json')}catch{path=local.resolve(name)}
   let directory=dirname(path);
   while(directory!==dirname(directory)){
    const manifest=join(directory,'package.json');if(existsSync(manifest)){const data=JSON.parse(readFileSync(manifest,'utf8'));if(data.name===name)return directory}directory=dirname(directory);
   }
   throw Error('Installed package not found: '+name);
  };
  const collect=directory=>{
   const manifest=JSON.parse(readFileSync(join(directory,'package.json'),'utf8')),key=manifest.name+'@'+manifest.version;if(directories.has(key))return;directories.set(key,directory);
   for(const name of Object.keys({...manifest.dependencies,...manifest.peerDependencies})){
    if(manifest.peerDependenciesMeta?.[name]?.optional&&!manifest.dependencies?.[name])continue;
    collect(packageDirectory(name,directory));
   }
  };
  for(const name of ['vue','@vue/runtime-dom','@vue/server-renderer'])collect(packageDirectory(name,resolve('.')));
  collect(resolve(dirname(fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))),'..'));
  const dependencies=[...directories.values()].map(pack);
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',...dependencies],consumer);
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  for(const name of ['counter.ts','server-example.ts','browser-example.ts']){const code=readme.split('```ts title="'+name+'"\n')[1]?.split('```')[0];assert.ok(code,'Example missing: '+name);writeFileSync(join(consumer,name),code)}
  writeFileSync(join(consumer,'consumer.ts'),`import * as Vue from '@vue/runtime-dom';import {createVueBindings} from '@zeruxjs/vue';import {createVueView} from '@zeruxjs/vue/rendering';import {renderVueToString} from '@zeruxjs/vue/server';const bridge=createVueBindings(Vue);const scope=Vue.effectScope();scope.run(()=>{const value=bridge.useStore({getSnapshot:()=>1,subscribe:()=>()=>{}});const checked:number=value.value;
// @ts-expect-error converted snapshots have a read-only value
value.value=2;
});scope.stop();const output:Promise<string>=renderVueToString(createVueView({render:()=>Vue.h('p',null,'ok')}));`);
  writeFileSync(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',lib:['ES2022','DOM','DOM.Iterable'],types:[],strict:true,noEmitOnError:true,outDir:'out'},include:['consumer.ts','counter.ts','server-example.ts','browser-example.ts']}));
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.json'],consumer);
  writeFileSync(join(consumer,'check.mjs'),`import {createRequire} from 'node:module';import {renderVueToString} from '@zeruxjs/vue/server';import {createVueView} from '@zeruxjs/vue/rendering';import {Counter} from './out/counter.js';const html=await renderVueToString(createVueView(Counter,{initial:2,label:'Count'}));if(!html.includes('Count')||!html.includes('4'))throw Error('SSR example failed');const require=createRequire(import.meta.url),vueRequire=createRequire(require.resolve('vue/package.json'));if(require.resolve('@vue/runtime-dom')!==vueRequire.resolve('@vue/runtime-dom'))throw Error('duplicate Vue runtime');`);run(process.execPath,['check.mjs'],consumer);
 }finally{rmSync(temporary,{recursive:true,force:true})}
});
