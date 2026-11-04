import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
test('packed core needs no ZyroJS runtime; renderer subpath owns types through real installed exports',()=>{
 const root=mkdtempSync(join(tmpdir(),'zyro-bridge-public-'));
 const run=(command,args,cwd)=>execFileSync(command,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:join(root,'cache')}});
 const pack=directory=>{const result=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',root],directory));return join(root,(Array.isArray(result)?result:Object.values(result))[0].filename);};
 try{
  const archive=pack(resolve('.')),consumer=join(root,'consumer');mkdirSync(consumer);
  writeFileSync(join(consumer,'package.json'),'{"private":true,"type":"module"}');
  run('npm',['install','--offline','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund','--no-package-lock',archive],consumer);
  assert.equal(existsSync(join(consumer,'node_modules/zyrojs')),false);
  writeFileSync(join(consumer,'core.ts'),`import {createObservable} from '@zeruxjs/zyro';const source=createObservable(1);source.set(2);`);
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'core.ts','--noEmit','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',resolve('../../../node_modules/@types')],consumer);
  writeFileSync(join(consumer,'core.mjs'),`import {createObservable} from '@zeruxjs/zyro';if(createObservable(2).get()!==2)throw Error('core failed');`);run(process.execPath,['core.mjs'],consumer);
  const dependencies=[pack(resolve('../../zyrojs')),pack(resolve(dirname(fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))),'..')),pack(dirname(require.resolve('jose/package.json')))];
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',...dependencies],consumer);
  writeFileSync(join(consumer,'consumer.ts'),`import * as Zyro from 'zyrojs/component';
import {createObservable} from '@zeruxjs/zyro';import {createZyroRendererBridge} from '@zeruxjs/zyro/renderer';
const source=createObservable(1),bridge=createZyroRendererBridge(Zyro),read=bridge.read(source);
const value:number=read.value;
// @ts-expect-error a readable conversion is read-only
read.value=2;
// @ts-expect-error selection retains exact inferred type
const wrong:string=bridge.select(source,n=>n+1).value;
const writable=bridge.write(source);writable.value=2;bridge.destroy();
`);
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  const example=readme.split('```ts title="counter.ts"\n')[1]?.split('```')[0];assert.ok(example,'README example missing');writeFileSync(join(consumer,'counter.ts'),example);
  writeFileSync(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',lib:['ES2022','DOM','DOM.Iterable'],types:[],strict:true,noEmitOnError:true,outDir:'out'},include:['consumer.ts','counter.ts']}));
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.json'],consumer);
  writeFileSync(join(consumer,'check.mjs'),`import * as Zyro from 'zyrojs/component';import {createZyroRendererBridge} from '@zeruxjs/zyro/renderer';import {createObservable} from '@zeruxjs/zyro';const source=createObservable(1),bridge=createZyroRendererBridge(Zyro),view=bridge.write(source);view.value=4;if(source.get()!==4)throw Error('write failed');bridge.destroy();`);run(process.execPath,['check.mjs'],consumer);
 }finally{rmSync(root,{recursive:true,force:true});}
});
