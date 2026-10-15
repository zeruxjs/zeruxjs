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
