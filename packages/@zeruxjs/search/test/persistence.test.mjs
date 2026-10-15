import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createSearchIndex} from '../dist/index.js';
import {saveSearchSnapshot,loadSearchSnapshot} from '../dist/persistence.js';
import {createSearchHandler} from '../dist/http.js';
test('atomic snapshot restore and rollback on corrupted file',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'search-snapshot-'));const file=path.join(dir,'index.json');
 try {
  const index=createSearchIndex();index.add({id:'a',text:'hello'});
  assert.equal(await loadSearchSnapshot(file,index),false);
  await saveSearchSnapshot(file,index);index.add({id:'b',text:'world'});
  assert.equal(await loadSearchSnapshot(file,index),true);assert.equal(index.size,1);assert.equal(index.get('b'),undefined);
  await writeFile(file,'corrupted JSON');await assert.rejects(loadSearchSnapshot(file,index));assert.equal(index.size,1);
  await assert.rejects(saveSearchSnapshot(file,index,{maxBytes:256/2}),RangeError);
 } finally {await rm(dir,{recursive:true,force:true})}
});
test('snapshot refuses symlink targets and traversal directory aliases',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'search-symlink-'));
 try{
  const index=createSearchIndex();const target=path.join(dir,'real');const link=path.join(dir,'snapshot.json');
  await writeFile(target,'{}');await symlink(target,link);
  await assert.rejects(saveSearchSnapshot(link,index));await assert.rejects(loadSearchSnapshot(link,index));
  assert.equal(await (await import('node:fs/promises')).readFile(target,'utf8'),'{}');
  const alias=path.join(dir,'alias');await symlink(dir,alias,'dir');
  await assert.rejects(saveSearchSnapshot(path.join(alias,'snapshot.json'),index));
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('filtered results cannot leak suggestions or get public cached',async()=>{
 const index=createSearchIndex();index.add({id:'secret',text:'private secret'});
 assert.throws(()=>createSearchHandler({index,filter:()=>false,cacheSeconds:10}));
 const handler=createSearchHandler({index,filter:()=>false});
 assert.equal(handler(new Request('http://localhost/?q=se&suggest=1')).status,403);
 const response=handler(new Request('http://localhost/?q=secret'));assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual((await response.json()).results,[]);
});
