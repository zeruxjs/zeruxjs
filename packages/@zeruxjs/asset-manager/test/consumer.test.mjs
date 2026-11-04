import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const exec=promisify(execFile),require=createRequire(import.meta.url);
test('packed core stays standalone and storage example uses real public files exports/declarations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zx-asset-consumer-')),packageRoot=resolve(import.meta.dirname,'..'),workspace=resolve(packageRoot,'../../..');
 async function install(path,name){
  const metadata=JSON.parse((await exec('npm',['pack','--json','--pack-destination',root],{cwd:path,env:{...process.env,npm_config_cache:join(root,'cache')}})).stdout);
  const packed=Array.isArray(metadata)?metadata[0]:Object.values(metadata)[0],destination=join(root,'node_modules',name);
  await mkdir(destination,{recursive:true});await exec('tar',['-xzf',join(root,packed.filename),'--strip-components=1','-C',destination]);return destination;
 }
 const tsc=(...paths)=>exec(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--types','node',...paths],{cwd:root});
 try{
  const installed=await install(packageRoot,'@zeruxjs/asset-manager');
  await symlink(join(workspace,'node_modules/@types'),join(root,'node_modules/@types'),'dir');
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(join(root,'core.ts'),`import {createAssetManager} from '@zeruxjs/asset-manager';\nexport const catalog=createAssetManager();`);
  await tsc('core.ts');await exec(process.execPath,['--input-type=module','-e',`import {createAssetManager} from '@zeruxjs/asset-manager';import {createRequire} from 'node:module';if(createAssetManager().size!==0)throw Error('core');try{createRequire(import.meta.url).resolve('@zeruxjs/files');throw Error('unexpected optional dependency');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}`],{cwd:root});
  const brandReadme=await readFile(join(packageRoot,'README.md'),'utf8');
  const brandExample=brandReadme.split('## Brand rules and audited editing')[1].match(/```ts\n([\s\S]*?)```/)[1];
  await writeFile(join(root,'brand-example.ts'),brandExample);await tsc('brand-example.ts');
  await exec(process.execPath,['--input-type=module','-e',`import {editBrand} from './brand-example.js';const events=[];const result=await editBrand({actor:'editor',tenant:'tenant'}, {append:async event=>{events.push(event);}},()=>true);if(result.snapshot.version!==2||events.length!==2||result.result.audit!=='written')throw Error('brand public contract');`],{cwd:root});
  await install(join(workspace,'packages/@zeruxjs/files'),'@zeruxjs/files');
  const readme=await readFile(join(packageRoot,'README.md'),'utf8'),example=readme.split('## Explicit storage adapter')[1].match(/```ts\n([\s\S]*?)```/)[1];
  await writeFile(join(root,'example.ts'),example);await tsc('example.ts');
  await writeFile(join(root,'run.mjs'),`import {createFileManager,createLocalStorage} from '@zeruxjs/files';import {storeAsset} from './example.js';import {createAssetStorage} from '@zeruxjs/asset-manager/storage';const files=createFileManager({stores:[{name:'private',driver:createLocalStorage({root:new URL('./binary',import.meta.url).pathname})}]});try{const result=await storeAsset(files,{tenant:'test',subject:'tester'},()=>true);if(!result.version||result.bytes.length!==16||typeof createAssetStorage!=='function')throw Error('example contract');}finally{await files.close();}`);
  await exec(process.execPath,['run.mjs'],{cwd:root});
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));assert.equal(manifest.version,'0.0.4');assert.equal(manifest.peerDependenciesMeta['@zeruxjs/files'].optional,true);assert.ok(manifest.exports['./storage']);assert.ok(manifest.exports['./brand']);assert.ok(manifest.exports['./dist/*']);
 }finally{await rm(root,{recursive:true,force:true});}
});
