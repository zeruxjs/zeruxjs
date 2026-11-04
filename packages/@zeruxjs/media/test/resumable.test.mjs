import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFileManager,createLocalStorage,createResumableUploads} from '@zeruxjs/files';
import {createMediaResumableHandler} from '../dist/resumable.js';
import {createMediaTransfers} from '../dist/browser.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),bytes=Buffer.from('hello world');
async function fixture(fn,extra={}){
 const root=await mkdtemp(join(tmpdir(),'zx-media-resume-')),files=createFileManager({stores:[{name:'disk',driver:createLocalStorage({root:join(root,'files')})}]});
 const uploads=createResumableUploads({files,root:join(root,'sessions'),authorize:()=>true,maxPartBytes:5,maxBytes:100});
 const config={uploads,prefix:'/sessions',allowedTypes:['text/plain'],partBytes:5,maxBytes:100,identify:request=>({tenant:request.headers.get('authorization')==='Bearer other'?'other':'tenant-a',subject:'user'}),authorizeRequest:request=>request.headers.get('authorization')?.startsWith('Bearer ')===true,destination:who=>({storage:'disk',bucket:'uploads',key:sha(who.tenant)+'/'+randomBytes(16).toString('hex')}),...extra};
 const handler=createMediaResumableHandler(config);
 const fetch=async(url,init={})=>{const headers=new Headers(init.headers);headers.set('authorization','Bearer allowed');return handler.handle(new Request(url,{...init,headers}));};
 const client=createMediaTransfers({baseUrl:'https://media.test/',allowedOrigins:['https://media.test'],fetch});
 try{await fn({root,files,uploads,handler,client,config});}finally{client.close();await handler.close();await uploads.close();await files.close();await rm(root,{recursive:true,force:true});}
}
const declaration={name:'document.txt',size:bytes.length,sha256:sha(bytes),contentType:'text/plain'};
test('request abort retains tenant session, explicit resume validates parts, completion returns no storage address',()=>fixture(async({client,files})=>{
 const session=await client.initiateSession('sessions',declaration),controller=new AbortController();
 await assert.rejects(client.uploadSession('sessions',session.id,new Blob([bytes]),{sha256:sha(bytes),signal:controller.signal,onProgress:p=>{if(p.loaded===5)controller.abort();}}),/cancelled/);
 const partial=await client.getSession('sessions',session.id);assert.equal(partial.parts.length,1);assert.equal(partial.status,'open');assert.doesNotMatch(JSON.stringify(partial),/bucket|storage|nativeId/);
 const sent=await client.uploadSession('sessions',session.id,new Blob([bytes]),{sha256:sha(bytes)});assert.deepEqual(sent.parts,[1,2,3]);
 const complete=await client.finalizeSession('sessions',session.id,sent.parts);assert.equal(complete.sha256,sha(bytes));assert.equal(complete.size,bytes.length);assert.doesNotMatch(JSON.stringify(complete),/bucket|storage|nativeId/);
 assert.equal((await client.getSession('sessions',session.id)).status,'complete');assert.equal((await files.list('uploads',{storage:'disk'})).items.length,1);
}));
test('cross-tenant/unauthorized session calls, altered file hashes and explicit abort are enforced',()=>fixture(async({client,handler,root})=>{
 const session=await client.initiateSession('sessions',declaration);
 const denied=await handler.handle(new Request('https://media.test/sessions/'+session.id,{headers:{authorization:'Bearer other'}}));assert.equal(denied.status,403);
 assert.equal((await handler.handle(new Request('https://media.test/sessions/'+session.id,{headers:{'x-forwarded-user':'trusted'}}))).status,403);
 await client.uploadSession('sessions',session.id,new Blob([bytes]),{sha256:sha(bytes)});
 const altered=Buffer.from(bytes);altered[0]=0;await assert.rejects(client.uploadSession('sessions',session.id,new Blob([altered]),{sha256:sha(bytes)}),/mismatch/);
 await client.abortSession('sessions',session.id);assert.equal((await client.getSession('sessions',session.id)).status,'aborted');assert.deepEqual(await readdir(join(root,'sessions',session.id)),['session.json']);
}));
test('whole-object hash mismatch fails before commit and failed metadata integration reports committed uncertainty',()=>fixture(async({client,files})=>{
 const session=await client.initiateSession('sessions',{...declaration,sha256:'0'.repeat(64)});const parts=await client.uploadSession('sessions',session.id,new Blob([bytes]),{sha256:'0'.repeat(64)});
 await assert.rejects(client.finalizeSession('sessions',session.id,parts.parts),error=>error.code==='INVALID_UPLOAD');assert.equal((await files.list('uploads',{storage:'disk'})).items.length,0);await client.abortSession('sessions',session.id);
 const good=await client.initiateSession('sessions',declaration),uploaded=await client.uploadSession('sessions',good.id,new Blob([bytes]),{sha256:sha(bytes)});
 await assert.rejects(client.finalizeSession('sessions',good.id,uploaded.parts),error=>error.code==='METADATA_AFTER_COMMIT_FAILED'&&error.committed===true);assert.equal((await client.getSession('sessions',good.id)).status,'complete');assert.equal((await files.list('uploads',{storage:'disk'})).items.length,1);
},{onCommitted:async()=>{throw new Error('PRIVATE_CATALOG_FAILURE');}}));
test('completed-session callback is explicit and can be idempotent; protocol body failures remain sanitized',()=>{
 let calls=0;const receipts=new Map();return fixture(async({client,handler})=>{
  const session=await client.initiateSession('sessions',declaration),parts=await client.uploadSession('sessions',session.id,new Blob([bytes]),{sha256:sha(bytes)});
  const a=await client.finalizeSession('sessions',session.id,parts.parts),b=await client.finalizeSession('sessions',session.id,parts.parts);assert.deepEqual(a.asset,b.asset);assert.equal(calls,1);
  const invalid=await handler.handle(new Request('https://media.test/sessions',{method:'POST',headers:{authorization:'Bearer allowed','content-type':'application/json'},body:'{"__proto__":{"private":"SECRET"}}'}));assert.equal(invalid.status,400);assert.doesNotMatch(await invalid.text(),/SECRET|stack/);
 },{onCommitted:async(who,id)=>{const key=who.tenant+':'+id;if(!receipts.has(key)){calls++;receipts.set(key,{assetId:'document',versionId:randomBytes(24).toString('hex')});}return receipts.get(key);}});
});
