import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMarketingImportJob,createMarketingCampaignService} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
const dbFrom=c=>Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,arg=>c.execute({op,...arg},ctx)]));
const delivery=()=>{const map=new Map();return {async load(id){return map.get(id)||null;},async create(r){if(map.has(r.id))return false;map.set(r.id,r);return true;}};};
test('durable import with two SQLite connections recovers failed page and fences stale leases',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'zerux-import-')),file=join(folder,'state.db');
 const one=await createConnector({filename:file,driver:'node'}),two=await createConnector({filename:file,driver:'node'});
 try{
  const db1=dbFrom(one),db2=dbFrom(two),dummy=delivery();
  const service=createMarketingCampaignService({db:db1,delivery:dummy,queue:{async add(){}},now:()=>1000});
  const code=await service.create({name:'Reusable import',subject:'Hi',text:'Welcome',account:'primary',recipients:['first@example.com'],autoEnqueue:false});
  const input=Array.from({length:240},(_,i)=>({email:`member${i}@example.com`,name:`User ${i}`,data:{segment:'vip'}}));
  let time=1000,failOnce=true;
  const source={async page({cursor,limit}){if(failOnce&&cursor==='0100'){failOnce=false;throw new Error('upstream unavailable');}
    const index=cursor===null?0:Number(cursor);const recipients=input.slice(index,index+limit);
    const next=index+recipients.length;return {recipients,done:next>=input.length,nextCursor:next>=input.length?null:String(next).padStart(4,'0')};}};
  const options={id:'csv-import-1',campaignCode:code,sourceRevision:'snapshot-20261013-v1',source,now:()=>time,leaseMs:3000,batchSize:100,
    append:(campaign,rows)=>service.appendRecipients(campaign,rows)};
  const a=createMarketingImportJob({...options,db:db1}),b=createMarketingImportJob({...options,db:db2});
  const first=await a.runOnce('worker-a');assert.equal(first.state.processed,100);assert.equal(first.state.status,'pending');
  await assert.rejects(b.runOnce('worker-b'),/upstream unavailable/);
  assert.equal((await b.get()).processed,100);
  let old=await a.acquire('worker-a');assert.ok(old);
  assert.equal(await b.acquire('worker-b'),null);
  time+=3001;
  const takeover=await b.acquire('worker-b');assert.ok(takeover);
  await assert.rejects(a.commit(old,{recipients:[],done:true,nextCursor:null},{added:0,existing:0,recipientCount:0}),/lease lost/);
  await assert.rejects(a.renew(old),/lease lost/);
  // Worker b releases its lease by committing the next page.
  const page=await source.page({cursor:'0100',limit:100});
  const added=await service.appendRecipients(code,page.recipients);
  const committed=await b.commit(takeover,page,added);assert.equal(committed.processed,200);
  const last=await a.runOnce('worker-a');assert.equal(last.state.status,'completed');assert.equal(last.state.processed,240);
  assert.equal((await b.runOnce('worker-b')).busy,true);
  assert.equal((await service.audience(code)).storedRecipientCount,241);
  assert.equal(JSON.stringify(await a.get()).includes('@example.com'),false);
  const wrong=createMarketingImportJob({...options,db:db2,sourceRevision:'snapshot-20261013-v2'});
  await assert.rejects(wrong.get(),/identity or version conflict/);
  const secondary=createMarketingImportJob({...options,db:db2,id:'csv-import-cancel'});
  const token=await secondary.acquire('worker-a');assert.ok(token);
  assert.equal((await secondary.cancel()).status,'cancelled');
  await assert.rejects(secondary.commit(token,{recipients:[],done:true,nextCursor:null},{added:0,existing:0,recipientCount:0}),/lease lost/);
 }finally{await one.disconnect();await two.disconnect();await rm(folder,{recursive:true,force:true});}
});

test('BullMQ import adapter puts only opaque job identifiers in Redis and uses trusted resolver',async()=>{
 const {createMarketingImportProcessor,enqueueMarketingImportJob}=await import('../dist/index.js');
 const calls=[];const queue={async add(...args){calls.push(args);return {id:args[2].jobId};}};
 const queued=await enqueueMarketingImportJob(queue,'job62','campaign62');
 assert.equal(calls[0][0],'marketing.import');assert.deepEqual(calls[0][1],{id:'job62',campaignCode:'campaign62'});
 assert.equal(queued.id,calls[0][2].jobId);
 const processor=createMarketingImportProcessor(async(id,code)=>{
  assert.equal(id,'job62');assert.equal(code,'campaign62');
  return {async runOnce(owner){return {busy:false,owner};}};
 });
 assert.deepEqual(await processor({data:calls[0][1]},'worker-1'),{busy:false,owner:'worker-1'});
 await assert.rejects(processor({data:{...calls[0][1],email:'private@example.org'}},'worker-1'),/only safe/);
 assert.equal(JSON.stringify(calls).includes('private@example.org'),false);
});

test('import checkpoint never persists upstream exception PII',async()=>{
 const c=await createConnector({filename:':memory:',driver:'node'});
 try{
  const db=dbFrom(c);
  const job=createMarketingImportJob({db,id:'privacy-test',campaignCode:'campaign62',sourceRevision:'snapshot-20261013',
    source:{async page(){throw Error('Bad email private@example.org');}},append:async()=>({added:0,existing:0,recipientCount:0})});
  await assert.rejects(job.runOnce('worker-1'),/private@example.org/);
  const state=await job.get();
  assert.equal(state.lastError,'IMPORT_PAGE_FAILED');
  assert.equal(JSON.stringify(state).includes('private@example.org'),false);
 }finally{await c.disconnect();}
});
