import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAssetManager} from '@zeruxjs/asset-manager';
import {createAssetStorage} from '@zeruxjs/asset-manager/storage';
import {createFileManager,createLocalStorage} from '@zeruxjs/files';
import {createMediaAssetService} from '../dist/assets.js';
const bytes=Buffer.from('hello'),sha=createHash('sha256').update(bytes).digest('hex');
const input={asset:{id:'document',name:'Report',type:'document',variants:{small:{url:'https://cdn.test/secret?signature=PRIVATE'}}},size:5,sha256:sha,contentType:'text/plain'};
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'zx-media-assets-'));const files=createFileManager({stores:[{name:'disk',driver:createLocalStorage({root})}]});const catalog=createAssetManager(),assets=createAssetStorage({catalog,files,namespace:'media',location:()=>({storage:'disk',bucket:'uploads'}),allowedTypes:['text/plain'],authorize:identity=>identity.tenant==='tenant-a'});
 const media=createMediaAssetService({assets,identify:request=>({tenant:request.headers.get('authorization')==='Bearer allowed'?'tenant-a':'other',subject:'user'}),authorizeRequest:request=>request.headers.get('authorization')==='Bearer allowed'});
 try{await fn({root,files,catalog,assets,media});}finally{await media.close();await assets.close();await files.close();await rm(root,{recursive:true,force:true});}}
const request=(body=bytes,headers={})=>new Request('https://media.test',{method:'PUT',body,headers:{authorization:'Bearer allowed','content-type':'text/plain',...headers}});
test('asset metadata is committed after integrity-checked bytes and request-facing metadata is redacted/authorized',()=>fixture(async({media,catalog,files})=>{
 const stored=await media.upload(request(),input);assert.equal(catalog.size,1);assert.equal(stored.size,5);assert.deepEqual(stored.variants,['small']);assert.doesNotMatch(JSON.stringify(stored),/PRIVATE|storage|bucket|\/secret/);
 await assert.rejects(media.metadata(new Request('https://media.test'),'document'),{code:'FORBIDDEN'});
 const auth=new Request('https://media.test',{headers:{authorization:'Bearer allowed'}});const response=await media.download(auth,'document',stored.versionId);assert.equal(await response.text(),'hello');assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(response.headers.get('x-media-sha256'),sha);
 await assert.rejects(media.remove(auth,stored.versionId,{binary:true}),/DELETE/);await media.remove(new Request(auth,{method:'DELETE'}),stored.versionId,{binary:true});assert.equal((await media.metadata(auth,'document'))[0].retired,true);await media.close();assert.ok(await files.list('uploads',{storage:'disk'}));
}));
test('length/hash errors and cancelled partial bodies never register metadata and close readers',()=>fixture(async({media,catalog,root})=>{
 await assert.rejects(media.upload(request(bytes,{'content-length':'6'}),input),/length mismatch/);
 await assert.rejects(media.upload(request(),{...input,sha256:'0'.repeat(64)}),/integrity/);
 let cancelled=0;const controller=new AbortController(),body=new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled++;}});
 const req=new Request('https://media.test',{method:'PUT',body,duplex:'half',signal:controller.signal,headers:{authorization:'Bearer allowed','content-type':'text/plain'}});
 const work=media.upload(req,input);await new Promise(r=>setTimeout(r,10));controller.abort();await assert.rejects(work,/cancel/);assert.equal(cancelled,1);assert.equal(body.locked,false);assert.equal(catalog.size,0);
}));
