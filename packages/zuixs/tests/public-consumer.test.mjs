import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createTypeScriptPreset } from '@zeruxjs/typescript/presets';
const packageRoot=fileURLToPath(new URL('..',import.meta.url));
const tsc=createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,encoding:'utf8',timeout:30000});

test('zero-runtime-dependency archive exposes compiled declarations and the public example',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'zuix-families-consumer-'));
 try{
  const packed=JSON.parse(run('npm',['pack','--json','--ignore-scripts','--pack-destination',root,'--cache','/tmp/zerux-zuix-npm-cache'],packageRoot));
  const info=Array.isArray(packed)?packed[0]:Object.values(packed)[0];
  const installed=path.join(root,'node_modules/zuixs');mkdirSync(installed,{recursive:true});
  run('tar',['-xzf',path.join(root,info.filename),'-C',installed,'--strip-components=1'],root);
  const manifest=JSON.parse(readFileSync(path.join(installed,'package.json'),'utf8'));
  assert.equal(manifest.dependencies,undefined);assert.equal(manifest.version,'0.0.4');
  for(const entry of Object.values(manifest.exports))for(const file of Object.values(entry))assert.ok(readFileSync(path.join(installed,file)).length);
  writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  const example=readFileSync(path.join(packageRoot,'README.md'),'utf8').split('Minimal public-import example:')[1].match(/```ts\n([\s\S]*?)```/)[1];
  writeFileSync(path.join(root,'example.ts'),example);
  const preset=createTypeScriptPreset('browser-library');
  writeFileSync(path.join(root,'tsconfig.json'),JSON.stringify({...preset,compilerOptions:{...preset.compilerOptions,rootDir:'.',outDir:'out'},include:['example.ts']}));
  run(process.execPath,[tsc,'-p',path.join(root,'tsconfig.json')],root);
  assert.match(run(process.execPath,[path.join(root,'out/example.js')],root),/@container card/);
  writeFileSync(path.join(root,'exports.mjs'),`import {createZuix,utilityFor} from 'zuixs';import {buildZuix} from 'zuixs/node';import {zuixVite} from 'zuixs/vite';import {resolveTheme} from 'zuixs/theme';if(!utilityFor('accent-blue-600',resolveTheme())||typeof buildZuix!=='function'||typeof zuixVite!=='function')throw Error();if(createZuix({preflight:false}).generate(['w-1/2']).unmatched.length)throw Error();`);
  run(process.execPath,[path.join(root,'exports.mjs')],root);
  const watchExample=readFileSync(path.join(packageRoot,'README.md'),'utf8').split('## Shared watch workflow and output manifests')[1].match(/```ts\n([\s\S]*?)```/)[1];
  writeFileSync(path.join(root,'example.ts'),watchExample);run(process.execPath,[tsc,'-p',path.join(root,'tsconfig.json')],root);
  writeFileSync(path.join(root,'optional.mjs'),`import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {watchZuix,buildZuix} from 'zuixs/node';const project=path.resolve('project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'a.html'),'<p class="p-2">');const errors=[];const stop=watchZuix(project,{preflight:false},undefined,e=>errors.push(e),{pollingOnly:true});await assert.rejects(stop.ready,{code:'ERR_MODULE_NOT_FOUND'});await stop.closed;const before=fs.readFileSync(path.join(project,'zuix.css'),'utf8');assert.throws(()=>buildZuix(project,{buildManifest:{file:'manifest.json',publicPath:'/',sourceMap:true}}),{code:'MODULE_NOT_FOUND'});assert.equal(fs.readFileSync(path.join(project,'zuix.css'),'utf8'),before);assert.ok(errors.length);`);
  run(process.execPath,[path.join(root,'optional.mjs')],root);

 }finally{rmSync(root,{recursive:true,force:true});}
});
