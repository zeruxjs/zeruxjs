import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDatabaseEmailDeliveryHistory,createDatabaseEmailDeliveryStore,createJournaledEmailDeliveryStore} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
test('history audit detects missing and stale current state without fabricating events',async()=>{
 const c=await createConnector({filename:':memory:',driver:'node'});
 const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,args=>c.execute({op,...args},ctx)]));
 try{
  const history=createDatabaseEmailDeliveryHistory(db);const base=createDatabaseEmailDeliveryStore(db);
  const store=createJournaledEmailDeliveryStore(base,history);const t=Date.parse('2026-10-13T12:00:00Z');
  for(const id of ['mail-a','mail-b','mail-c'])await base.create({id,campaignId:'camp-1',version:1,purpose:'marketing',recipient:`${id}@example.com`,state:'pending',lease:null,updatedAt:t});
  await history.record({messageId:'mail-a',campaignId:'camp-1',version:1,from:null,to:'pending',occurredAt:t});
  await history.record({messageId:'mail-b',campaignId:'camp-1',version:1,from:null,to:'sent',occurredAt:t});
  const first=await history.auditCurrent('camp-1',base,{limit:2});
  assert.equal(first.checked,2);assert.equal(first.covered,1);assert.equal(first.stale,1);assert.equal(first.complete,false);
  const second=await history.auditCurrent('camp-1',base,{cursor:first.nextCursor,limit:2});
  assert.equal(second.missing,1);assert.equal(second.complete,true);
  const empty=await history.auditCurrent('other-camp',base);assert.equal(empty.checked,0);
  const full=await history.page('camp-1',{limit:2});assert.equal(full.done,true);assert.equal(full.nextCursor,null);
  await assert.rejects(history.auditCurrent('camp-1',{pageCampaign:async()=>[{id:'bad',campaignId:'other-camp',state:'pending'}]}),/Out of scope/);
 }finally{await c.disconnect();}
});
