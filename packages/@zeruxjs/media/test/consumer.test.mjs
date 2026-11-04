import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const exec=promisify(execFile),require=createRequire(import.meta.url);
test('packed root stays independent of optional assets and browser example compiles without Node ambient types',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zx-media-consumer-')),packageRoot=resolve(import.meta.dirname,'..'),workspace=resolve(packageRoot,'../../..');
 async function install(path,name){const output=JSON.parse((await exec('npm',['pack','--json','--pack-destination',root],{cwd:path,env:{...process.env,npm_config_cache:join(root,'cache')}})).stdout);const packed=Array.isArray(output)?output[0]:Object.values(output)[0],destination=join(root,'node_modules',name);await mkdir(destination,{recursive:true});await exec('tar',['-xzf',join(root,packed.filename),'--strip-components=1','-C',destination]);return destination;}
 try{
  await install(join(workspace,'packages/@zeruxjs/files'),'@zeruxjs/files');const installed=await install(packageRoot,'@zeruxjs/media');await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
  await exec(process.execPath,['--input-type=module','-e',`import {createMediaStore} from '@zeruxjs/media';import {createMediaTransfers} from '@zeruxjs/media/browser';import {createRequire} from 'node:module';if(typeof createMediaStore!=='function'||typeof createMediaTransfers!=='function')throw Error('exports');try{createRequire(import.meta.url).resolve('@zeruxjs/asset-manager');throw Error('unexpected optional dependency');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}`],{cwd:root});
  const browser=await readFile(join(installed,'dist/browser.mjs'),'utf8');assert.doesNotMatch(browser,/node:|require\(|\bBuffer\b|\bprocess\b/);
  const playback=await readFile(join(installed,'dist/playback.mjs'),'utf8');assert.doesNotMatch(playback,/node:|require\(|\bBuffer\b|\bprocess\b/);
  const readme=await readFile(join(packageRoot,'README.md'),'utf8'),example=readme.split('## Browser transfers')[1].match(/```ts\n([\s\S]*?)```/)[1];await writeFile(join(root,'example.mts'),example);
  const playbackExample=readme.split('## Playback controller and optional controls')[1].match(/```ts\n([\s\S]*?)```/)[1];await writeFile(join(root,'playback-example.mts'),playbackExample);
  await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',lib:['ES2022','DOM','DOM.Iterable'],types:[],strict:true,outDir:'out'},include:['example.mts','playback-example.mts']}));
  await exec(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.json'],{cwd:root});
  await exec(process.execPath,['--input-type=module','-e',`import {transferReport} from './out/example.mjs';globalThis.location=new URL('https://media.test/');let bytes=0;await transferReport(new WritableStream({write(chunk){bytes+=chunk.length;}}),new AbortController().signal,async()=>new Response('hello',{headers:{'content-length':'5'}}));if(bytes!==5)throw Error('example');`],{cwd:root});
  await install(join(workspace,'packages/@zeruxjs/asset-manager'),'@zeruxjs/asset-manager');await symlink(join(workspace,'node_modules/@types'),join(root,'node_modules/@types'),'dir');
  await writeFile(join(root,'server.mts'),`import {createMediaAssetService} from '@zeruxjs/media/assets';import {createMediaResumableHandler} from '@zeruxjs/media/resumable';import {createMediaTranscoder} from '@zeruxjs/media/transcode';import {createAssetStorage} from '@zeruxjs/asset-manager/storage';export type Assets=ReturnType<typeof createAssetStorage>;export const adapt=(assets:Assets)=>createMediaAssetService({assets,identify:()=>({tenant:'tenant',subject:'user'}),authorizeRequest:()=>true});export const protocolFactory=createMediaResumableHandler;export const transcodeFactory=createMediaTranscoder;`);
  await exec(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--types','node','server.mts'],{cwd:root});
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));assert.equal(manifest.version,'0.0.4');assert.ok(manifest.exports['./browser'].import.endsWith('.mjs'));assert.ok(manifest.exports['./playback'].import.endsWith('.mjs'));assert.ok(manifest.exports['./transcode']);assert.equal(manifest.peerDependenciesMeta['@zeruxjs/asset-manager'].optional,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
