import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createDatabaseEmailDeliveryStore,createDatabaseProviderOutcomeLedger,createDatabaseCampaignPerformanceReporter} from '../../packages/@zeruxjs/queue/dist/index.js';
const connection={slug:'primary',connector:'sqlite',options:{},name:'Primary'},context={connection};
const facade=driver=>Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,input=>driver.execute({...input,op},context)]));
const row=i=>({id:`mail${String(i).padStart(6,'0')}`,version:1,purpose:'marketing',campaignId:'campaign58',recipient:'private@example.test',state:i%5?'sent':'suppressed',lease:null,updatedAt:Date.UTC(2026,9,13)});
test('real SQLite exact grouped reporting and provider-event replay across connections',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zerux58-'));let a,b;
 try{
   const file=join(dir,'reports.sqlite');a=await createConnector({filename:file,driver:'node'},connection);b=await createConnector({filename:file,driver:'node'},connection);
   const dbA=facade(a),dbB=facade(b),deliveries=createDatabaseEmailDeliveryStore(dbA),ledger=createDatabaseProviderOutcomeLedger(dbB);
   for(let i=0;i<1203;i++)assert.equal(await deliveries.create(row(i)),true);
   const evt={provider:'relay',eventId:'confirmed-1',campaignId:'campaign58',messageId:'mail000001',kind:'delivered',occurredAt:Date.UTC(2026,9,13)};
   assert.equal(await ledger.record(evt),true);assert.equal(await ledger.record(evt),false);
   const report=await createDatabaseCampaignPerformanceReporter({db:dbB,provider:ledger})('campaign58');
   assert.equal(report.total,1203);assert.equal(report.counts.sent+report.counts.suppressed,1203);
   assert.equal(report.provider.events,1);assert.equal(report.provider.counts.delivered,1);
   assert.equal(JSON.stringify(report).includes('private@example.test'),false);
 }finally{await a?.disconnect?.();await b?.disconnect?.();await rm(dir,{recursive:true,force:true});}
});
