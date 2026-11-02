import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileManager,createLocalStorage} from '@zeruxjs/files';
import {createAssetManager,AssetRevisionError,saveAssetCatalog,loadAssetCatalog} from '../dist/index.js';
import {createAssetStorage} from '../dist/storage.js';
const actor={tenant:'tenant-a',subject:'alice'},bytes=Buffer.from('asset body');
const sha=data=>createHash('sha256').update(data).digest('hex');
const input=(id='document',data=bytes)=>({asset:{id,name:id,type:'document'},size:data.length,sha256:sha(data),contentType:'text/plain'});
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'zx-assets-'));const files=createFileManager({stores:[{name:'disk',driver:createLocalStorage({root:join(root,'files')}),allowedBuckets:['assets'],maxBytes:1024}]});
 const catalog=createAssetManager();const config={catalog,files,namespace:'test',location:()=>({storage:'disk',bucket:'assets',prefix:'private/'}),allowedTypes:['text/plain'],authorize:who=>who.subject==='alice',maxBytes:1024};
 const adapter=createAssetStorage(config);
 try{await fn({root,files,catalog,adapter,config});}finally{await adapter.close();await files.close();await rm(root,{recursive:true,force:true});}
}
test('immutable upload versions preserve snapshots, duplicate IDs reject and persisted catalogs retain history',()=>fixture(async({root,files,catalog,adapter,config})=>{
 const first=await adapter.upload(actor,input(),bytes),snapshot=catalog.snapshot();
 assert.deepEqual(await adapter.download(actor,first.reference.versionId),bytes);
 await assert.rejects(adapter.upload(actor,input(),bytes),{code:'ASSET_EXISTS'});
 const second=await adapter.upload(actor,{...input(),previousVersionId:first.reference.versionId},bytes);
 assert.notEqual(first.reference.versionId,second.reference.versionId);assert.notEqual(first.reference.address.key,second.reference.address.key);
 assert.deepEqual(snapshot.assets[0],catalog.snapshot().assets[0]);assert.equal((await adapter.versions(actor,'document')).length,2);
 await assert.rejects(adapter.upload(actor,{...input(),previousVersionId:first.reference.versionId},bytes),{code:'ASSET_VERSION_CONFLICT'});
 const path=join(root,'catalog.json');await saveAssetCatalog(catalog,path);const restored=await loadAssetCatalog(path),resumed=createAssetStorage({...config,catalog:restored});
 try{assert.equal((await resumed.versions(actor,'document')).length,2);assert.deepEqual(await resumed.download(actor,first.reference.versionId),bytes);}finally{await resumed.close();}
 assert.equal((await files.list('assets',{storage:'disk'})).items.length,2);
}));
test('registration borrows verified bytes; active references protect binary ownership',()=>fixture(async({adapter,files})=>{
 const owned=await adapter.upload(actor,input('owned'),bytes);
 const borrowed=await adapter.register(actor,input('borrowed'),owned.reference.address);
 assert.equal(borrowed.reference.owned,false);
 await assert.rejects(adapter.delete(actor,borrowed.reference.versionId,{binary:true}),{code:'ASSET_BORROWED_BINARY'});
 await assert.rejects(adapter.delete(actor,owned.reference.versionId,{binary:true}),{code:'ASSET_REFERENCED'});
 await adapter.delete(actor,borrowed.reference.versionId,{binary:false});
 assert.ok(await files.stat(owned.reference.address));
 await adapter.delete(actor,owned.reference.versionId,{binary:true});assert.equal(await files.stat(owned.reference.address),null);
 assert.equal((await adapter.versions(actor,'owned'))[0].retired,true);
 await assert.rejects(adapter.download(actor,owned.reference.versionId),{code:'ASSET_RETIRED'});
}));
test('stream lengths, MIME policy, hashes and tenant address checks reject before metadata commit',()=>fixture(async({adapter,files,catalog,config})=>{
 await assert.rejects(adapter.upload(actor,{...input(),contentType:'text/html'},bytes),{code:'ASSET_CONTENT'});
 await assert.rejects(adapter.upload(actor,{...input(),sha256:'0'.repeat(64)},bytes),{code:'ASSET_INTEGRITY'});
 await assert.rejects(adapter.upload(actor,{...input(),size:bytes.length+1},bytes),{code:'ASSET_LENGTH'});
 await assert.rejects(adapter.upload(actor,input(),(async function*(){yield bytes;throw new Error('source interrupted');})()),/source interrupted/);
 assert.equal(catalog.size,0);assert.equal((await files.list('assets',{storage:'disk'})).items.length,0);
 const stored=await adapter.upload(actor,input(),bytes);
 await assert.rejects(adapter.register({...actor,tenant:'other'},input('stolen'),stored.reference.address),{code:'ASSET_FORBIDDEN'});
 const corrupt=createAssetStorage({...config,files:{...files,read:async()=> (async function*(){yield Buffer.alloc(bytes.length);})()}});
 try{await assert.rejects(corrupt.download(actor,stored.reference.versionId),{code:'ASSET_INTEGRITY'});}finally{await corrupt.close();}
 await assert.rejects(adapter.download({...actor,subject:'mallory'},stored.reference.versionId),{code:'ASSET_FORBIDDEN'});
}));
test('identical bytes do not share tenant addresses, references or permissions',()=>fixture(async({adapter,config})=>{
 const a=await adapter.upload(actor,input(),bytes),other={tenant:'tenant-b',subject:'alice'};
 const b=await adapter.upload(other,input(),bytes);assert.notEqual(a.reference.address.key,b.reference.address.key);
 await assert.rejects(adapter.download(other,a.reference.versionId),{code:'ASSET_NOT_FOUND'});
 assert.equal((await adapter.versions(other,'document')).length,1);
 const limited=createAssetStorage({...config,maxBytes:1});try{assert.equal((await limited.versions(other,'document')).length,1);await assert.rejects(limited.download(other,b.reference.versionId),{code:'ASSET_SIZE'});}finally{await limited.close();}
 await adapter.delete(actor,a.reference.versionId,{binary:true});assert.deepEqual(await adapter.download(other,b.reference.versionId),bytes);
}));
test('failed upload and revision conflicts leave metadata untouched; approved repair rechecks candidates',()=>fixture(async({adapter,files,catalog,config})=>{
 const failed=createAssetStorage({...config,files:{...files,put:async()=>{throw new Error('backend unavailable');}}});
 try{await assert.rejects(failed.upload(actor,input(),bytes),/backend unavailable/);assert.equal(catalog.size,0);}finally{await failed.close();}
 const conflicting=createAssetStorage({...config,files:{...files,put:async(...args)=>{const stored=await files.put(...args);catalog.add({id:'unrelated',name:'other',type:'color',value:'#fff'});return stored;}}});
 try{await assert.rejects(conflicting.upload(actor,input(),bytes),AssetRevisionError);}finally{await conflicting.close();}
 assert.equal(catalog.size,1);const preview=await adapter.previewRepair(actor);assert.equal(preview.items.length,1);
 await assert.rejects(adapter.repair(actor,preview.items),{code:'ASSET_FORBIDDEN'});
 const repair=createAssetStorage({...config,approveRepair:()=>true});
 try{
  catalog.add({id:'changed',name:'changed',type:'other'});assert.equal(await repair.repair(actor,preview.items),0);
  const fresh=await repair.previewRepair(actor);assert.equal(await repair.repair(actor,fresh.items),1);assert.equal((await adapter.previewRepair(actor)).items.length,0);
 }finally{await repair.close();}
}));
test('lost storage success remains an inventoried orphan and detached ownership is explicitly repairable',()=>fixture(async({files,catalog,config})=>{
 const lost=createAssetStorage({...config,files:{...files,put:async(...args)=>{await files.put(...args);throw new Error('lost response');}},approveRepair:()=>true});
 try{
  await assert.rejects(lost.upload(actor,input(),bytes),/lost response/);assert.equal(catalog.size,0);
  const candidates=await lost.previewRepair(actor);assert.equal(candidates.items.length,1);assert.equal(await lost.repair(actor,candidates.items),1);
 }finally{await lost.close();}
 const adapter=createAssetStorage({...config,approveRepair:()=>true});
 try{const stored=await adapter.upload(actor,input('detached'),bytes);await adapter.delete(actor,stored.reference.versionId,{binary:false});const candidate=(await adapter.previewRepair(actor)).items.find(c=>c.versionId===stored.reference.versionId);assert.ok(candidate);assert.equal(await adapter.repair(actor,[candidate]),1);}finally{await adapter.close();}
}));
test('failed binary delete retains live metadata and a successful delete/revision race is surfaced',()=>fixture(async({adapter,files,catalog,config})=>{
 const stored=await adapter.upload(actor,input(),bytes),revision=catalog.revision;
 const failed=createAssetStorage({...config,files:{...files,delete:async()=>{throw new Error('delete outage');}}});
 try{await assert.rejects(failed.delete(actor,stored.reference.versionId,{binary:true}),/delete outage/);assert.equal(catalog.revision,revision);assert.deepEqual(await adapter.download(actor,stored.reference.versionId),bytes);}finally{await failed.close();}
 const racing=createAssetStorage({...config,files:{...files,delete:async address=>{const result=await files.delete(address);catalog.add({id:'concurrent',name:'concurrent',type:'other'});return result;}}});
 try{await assert.rejects(racing.delete(actor,stored.reference.versionId,{binary:true}),AssetRevisionError);assert.equal((await adapter.versions(actor,'document'))[0].retired,false);await assert.rejects(adapter.download(actor,stored.reference.versionId),{code:'ASSET_BINARY_MISSING'});}finally{await racing.close();}
 await adapter.delete(actor,stored.reference.versionId,{binary:false});assert.equal((await adapter.versions(actor,'document'))[0].retired,true);
}));
test('shared catalog leases protect in-flight owned uploads from repair; close drains without closing files',()=>fixture(async({files,catalog,config})=>{
 let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);
 const slow=createAssetStorage({...config,files:{...files,put:async(...args)=>{const result=await files.put(...args);started();await wait;return result;}}}),other=createAssetStorage({...config,approveRepair:()=>true});
 const work=slow.upload(actor,input(),bytes);await ready;
 assert.equal((await other.previewRepair(actor)).items.length,0);
 let closed=false;const closing=slow.close().then(()=>closed=true);await Promise.resolve();assert.equal(closed,false);
 await assert.rejects(slow.versions(actor,'document'),{code:'ASSET_CLOSED'});release();await work;await closing;
 assert.equal(catalog.size,1);assert.ok(await files.list('assets',{storage:'disk'}));await other.close();
}));
test('readback failure does not publish metadata; authorization receives exact address/version context',()=>fixture(async({adapter,files,catalog,config})=>{
 const corrupt=createAssetStorage({...config,files:{...files,read:async()=> (async function*(){yield Buffer.alloc(bytes.length);})()}});
 try{await assert.rejects(corrupt.upload(actor,input(),bytes),{code:'ASSET_INTEGRITY'});assert.equal(catalog.size,0);}finally{await corrupt.close();}
 const seen=[];const restricted=createAssetStorage({...config,authorize:(who,action,id,context)=>{seen.push({action,context});return action!=='register';}});
 try{const own=await restricted.upload(actor,input(),bytes);assert.equal(seen[0].context.versionId,own.reference.versionId);await assert.rejects(restricted.register(actor,input('denied'),own.reference.address),{code:'ASSET_FORBIDDEN'});assert.deepEqual(seen.at(-1).context.address,own.reference.address);}finally{await restricted.close();}
}));
