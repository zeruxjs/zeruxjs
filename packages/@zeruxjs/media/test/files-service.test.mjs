import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileManager,createLocalStorage} from '@zeruxjs/files';
import {createMediaFilesService} from '../dist/index.js';
test('Media can upload/download/list/delete files through the multi-store backend',async()=>{
 const root=await mkdtemp(join(tmpdir(),'media-files-'));
 const manager=createFileManager({stores:[{name:'media',driver:createLocalStorage({root})}]});
 const authorized=(request,address,action)=>request.headers.get('authorization')==='Bearer allowed';
 const service=createMediaFilesService(manager,{storage:'media',bucket:'media-files',authorize:authorized});
 const key='https://files.test';
 try{
  const bytes=Buffer.from([0,1,2,254,255]);
  const denied=new Request(key,{method:'PUT',body:bytes});
  await assert.rejects(service.upload(denied),{code:'FORBIDDEN'});
  const authenticated=new Request(key,{method:'PUT',body:bytes,headers:{Authorization:'Bearer allowed','Content-Type':'application/octet-stream'}});
  const uploaded=await service.upload(authenticated,{name:'camera.raw'});
  assert.equal(uploaded.info.size,5);assert.equal(uploaded.info.visibility,'private');assert.equal(uploaded.info.metadata.originalName,'camera.raw');
  assert.equal((await service.list()).items.length,1);
  const bad=await service.download(uploaded.id,new Request(key));assert.equal(bad.status,403);
  const req=new Request(key,{headers:{Authorization:'Bearer allowed',Range:'bytes=2-4'}});
  const response=await service.download(uploaded.id,req);assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(2));
  assert.equal(await service.remove(uploaded.id,new Request(key,{headers:{Authorization:'Bearer allowed'}})),true);
  assert.equal(await service.stat(uploaded.id),null);
 }finally{await manager.close();await rm(root,{recursive:true,force:true});}
});
test('request-scoped media list and stat hide unauthorized file metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'media-scopes-'));
 const manager=createFileManager({stores:[{name:'media',driver:createLocalStorage({root})}]});
 const service=createMediaFilesService(manager,{storage:'media',bucket:'media-files',authorize:(request,_,action,info)=>request.headers.get('authorization')==='Bearer alpha'&&(!info||info.metadata.owner==='alpha')});
 try{
  const request=new Request('https://files.test',{method:'PUT',headers:{authorization:'Bearer alpha'},body:'hello'});
  const {id}=await service.upload(request,{name:'alpha.txt'});
  const target=service.address(id);
  await manager.put(target,Buffer.from('hello'),{ifNoneMatch:false,visibility:'private',metadata:{owner:'alpha'}});
  const hidden=service.address('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  await manager.put(hidden,Buffer.from('secret'),{visibility:'private',metadata:{owner:'beta'}});
  const guest=new Request('https://files.test');
  assert.deepEqual((await service.listAuthorized(guest)).items,[]);
  await assert.rejects(service.statAuthorized(id,guest),{code:'FORBIDDEN'});
  const authorized=new Request('https://files.test',{headers:{authorization:'Bearer alpha'}});
  assert.equal((await service.statAuthorized(id,authorized)).key,target.key);
  const visible=await service.listAuthorized(authorized);
  assert.deepEqual(visible.items.map(item=>item.id),[id]);
 }finally{await manager.close();await rm(root,{recursive:true,force:true});}
});
test('authorized listings never expose a raw cursor containing a hidden key',async()=>{
 const hidden={bucket:'media-files',key:'media/deadbeef-dead-4eed-8ead-deadbeefbeef',visibility:'private',metadata:{owner:'other'}};
 const manager={async list(){return {items:[hidden],nextCursor:hidden.key}}};
 const service=createMediaFilesService(manager,{bucket:'media-files',authorize:()=>false});
 assert.deepEqual(await service.listAuthorized(new Request('https://files.test')),{items:[]});
});
