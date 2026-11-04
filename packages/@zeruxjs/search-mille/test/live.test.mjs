import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createMilleSearchAdapter} from '@zeruxjs/search-mille';

test('opt-in isolated Meilisearch 1.x task/settings/tenant acceptance', {skip:!process.env.ZX_TEST_MEILI_URL?'Requires isolated ZX_TEST_MEILI_URL and scoped ZX_TEST_MEILI_API_KEY':false}, async()=>{
 const endpoint=process.env.ZX_TEST_MEILI_URL,apiKey=process.env.ZX_TEST_MEILI_API_KEY;
 assert(apiKey,'ZX_TEST_MEILI_API_KEY required');
 const index='zx058-'+randomUUID(),call=(tenant='a')=>({tenant,signal:new AbortController().signal,deadline:Date.now()+30000});
 const adapter=await createMilleSearchAdapter({endpoint,allowedEndpoints:[endpoint],apiKey,index,taskKey:randomBytes(32),taskScope:index,timeoutMs:30000,fields:{category:'string'},filterable:['category']});
 const {Meilisearch}=await import('meilisearch');
 const maintenance=new Meilisearch({host:endpoint,apiKey,timeout:5000,requestInit:{redirect:'error'}});
 try{
  // This random namespace is fixture-owned even if acknowledgement is lost.
  const setup=await adapter.createIndex(call());const createdTask=await adapter.waitForTask(setup.taskId,call(),{maxPolls:100,intervalMs:100});assert.equal(createdTask.state,'succeeded');
  const settings=await adapter.configureIndex(call());assert.equal((await adapter.waitForTask(settings.taskId,call(),{maxPolls:100,intervalMs:100})).state,'succeeded');
  const receipt=await adapter.index([{id:'1',text:'boots',category:'books'}],call());assert.equal(receipt.state,'accepted');
  assert.equal((await adapter.waitForTask(receipt.taskId,call(),{maxPolls:100,intervalMs:100})).state,'succeeded');
  assert.equal((await adapter.search({text:'boots',filters:[{field:'category',operator:'eq',value:'BOOKS',caseSensitive:false}]},call())).hits.length,1);
  assert.equal((await adapter.search({text:'boots'},call('b'))).hits.length,0);
  const deleted=await adapter.delete(['1'],call());assert.equal((await adapter.waitForTask(deleted.taskId,call())).state,'succeeded');
  assert.equal((await adapter.search({text:'boots'},call())).hits.length,0);
 }finally{
  try{const cleanup=await maintenance.deleteIndex(index);const terminal=await maintenance.tasks.waitForTask(cleanup.taskUid,{timeout:30000,interval:100});assert(terminal.status==='succeeded'||terminal.status==='failed'&&terminal.error?.code==='index_not_found','Disposable index cleanup did not complete');}finally{await adapter.close();}
 }
});
