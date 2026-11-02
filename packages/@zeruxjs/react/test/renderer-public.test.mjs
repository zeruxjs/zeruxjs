import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('packed core is independent; missing peers fail clearly; installed renderer exports/types work',()=>{
 const root=mkdtempSync(join(tmpdir(),'react-renderer-public-'));
 const run=(command,args,cwd)=>execFileSync(command,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:join(root,'cache')}});
 const pack=directory=>{const output=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',root],directory));return join(root,(Array.isArray(output)?output:Object.values(output))[0].filename)};
 try{
  const archive=pack(resolve('.')),security=pack(resolve(dirname(fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))),'..')),jose=pack(dirname(require.resolve('jose/package.json'))),consumer=join(root,'consumer');mkdirSync(consumer);
  writeFileSync(join(consumer,'package.json'),'{"private":true,"type":"module"}');
  run('npm',['install','--offline','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund','--no-package-lock',archive,security,jose],consumer);
  assert.equal(existsSync(join(consumer,'node_modules/react')),false);assert.equal(existsSync(join(consumer,'node_modules/react-dom')),false);
  writeFileSync(join(consumer,'core.ts'),`import {createReactStore} from '@zeruxjs/react';const store=createReactStore(1);store.set(2);`);
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'core.ts','--noEmit','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',resolve('../../../node_modules/@types')],consumer);
  writeFileSync(join(consumer,'absent.mjs'),`import assert from 'node:assert/strict';import {createReactStore} from '@zeruxjs/react';import {renderReactToString} from '@zeruxjs/react/server';if(createReactStore(1).getSnapshot()!==1)throw Error('core failed');const {mountReact}=await import('@zeruxjs/react/browser');const container={nodeType:1,ownerDocument:{}};let disposed=0;await assert.rejects(mountReact(null,container,{onDispose:()=>disposed++}),e=>e.code==='REACT_DEPENDENCY_UNAVAILABLE');assert.equal(disposed,1);await assert.rejects(renderReactToString(null),e=>e.code==='REACT_DEPENDENCY_UNAVAILABLE'&&!e.message.includes('node_modules'));`);run(process.execPath,['absent.mjs'],consumer);
  const packages=['react','react-dom','scheduler','@types/react','@types/react-dom','csstype'].map(name=>pack(dirname(require.resolve(name+'/package.json'))));
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',...packages],consumer);
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  for(const name of ['counter.ts','server-example.ts','browser-example.ts']){const source=readme.split('```ts title="'+name+'"\n')[1]?.split('```')[0];assert.ok(source,'README example missing: '+name);writeFileSync(join(consumer,name),source)}
  writeFileSync(join(consumer,'consumer.ts'),`import * as React from 'react';import {createReactHydrationState} from '@zeruxjs/react/hydration';import {mountReact} from '@zeruxjs/react/browser';import {renderReactToString} from '@zeruxjs/react/server';
const state=createReactHydrationState({count:1},{identifierPrefix:'app',validateState:()=>({count:1})});
const checked:number=state.store.getServerSnapshot().count;
// @ts-expect-error snapshots preserve their public type
const invalid:string=state.store.getSnapshot().count;
const html:Promise<string>=renderReactToString(React.createElement('p',null,checked));
if(typeof document!=='undefined'){void mountReact(React.createElement('p'),document.createElement('div'));}
state.dispose();`);
  writeFileSync(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',lib:['ES2022','DOM','DOM.Iterable'],types:[],strict:true,noEmitOnError:true,outDir:'out'},include:['consumer.ts','counter.ts','server-example.ts','browser-example.ts']}));
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.json'],consumer);
  writeFileSync(join(consumer,'check.mjs'),`import * as React from 'react';import {createRequire} from 'node:module';import {renderReactToString} from '@zeruxjs/react/server';import {createReactHydrationState,readReactHydrationState} from '@zeruxjs/react/hydration';import {Counter,validateState} from './out/counter.js';const state=createReactHydrationState({count:1},{identifierPrefix:'app',validateState});const html=await renderReactToString(React.createElement(Counter,{store:state.store}),{identifierPrefix:state.identifierPrefix});if(!html.includes('Clicks: ')||!html.includes('1'))throw Error('native SSR failed');const restored=readReactHydrationState(state.data,{validateState});if(restored.store.getServerSnapshot().count!==1)throw Error('codec failed');const require=createRequire(import.meta.url),domRequire=createRequire(require.resolve('react-dom/package.json'));if(require.resolve('react')!==domRequire.resolve('react'))throw Error('duplicate React resolution');state.dispose();restored.dispose();`);run(process.execPath,['check.mjs'],consumer);
 }finally{rmSync(root,{recursive:true,force:true})}
});
