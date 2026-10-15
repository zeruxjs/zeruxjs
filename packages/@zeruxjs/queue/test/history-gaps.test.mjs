import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDatabaseEmailDeliveryStore,createDatabaseEmailDeliveryHistory,createDatabaseDeliveryHistoryGapLedger,createDeliveryHistoryGapScanner} from '../dist/index.js';
const require=createRequire(import.meta.url);const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
test('history gap observations preserve missing/stale current versions without inventing transitions',async()=>{
 const c=await createConnector({filename:':memory:',driver:'node'});
 try{
  const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,arg=>c.execute({op,...arg},ctx)]));
  const store=createDatabaseEmailDeliveryStore(db),history=createDatabaseEmailDeliveryHistory(db),ledger=createDatabaseDeliveryHistoryGapLedger(db);
  const base=Date.parse('2026-10-01T00:00:00Z');
  const mk=(id,state='pending')=>({id,campaignId:'camp62',version:1,purpose:'marketing',state,lease:null,recipient:`${id}@test.org`,updatedAt:base});
  await store.create(mk('a'));await store.create(mk('b'));await store.create(mk('c'));
  await history.record({messageId:'a',campaignId:'camp62',version:1,from:null,to:'pending',occurredAt:base});
  await history.record({messageId:'c',campaignId:'camp62',version:1,from:null,to:'pending',occurredAt:base});
  const c0=await store.load('c');await store.save('c',{...c0,version:2,state:'sent',updatedAt:base+1},1);
  const scanner=createDeliveryHistoryGapScanner({source:store,history,ledger,now:()=>base+1000});
  const one=await scanner('camp62',{limit:2});assert.deepEqual([one.covered,one.missing,one.stale],[1,1,0]);
  const two=await scanner('camp62',{cursor:one.nextCursor,limit:2});assert.equal(two.stale,1);
  const repeats=await scanner('camp62',{limit:3});assert.equal(repeats.observationsCreated,0);
  const audit=await history.auditCurrent('camp62',store,{limit:3});assert.equal(audit.covered,1);assert.equal(audit.missing,1);assert.equal(audit.stale,1);
  const historyItems=await history.page('camp62');assert.equal(historyItems.events.length,2);
  const page=await ledger.page('camp62');assert.equal(page.entries.length,2);
  assert.equal(page.entries.every(v=>!JSON.stringify(v).includes('@test.org')),true);
  await assert.rejects(ledger.record({...page.entries[0],currentState:'sent'}),/Conflicting/);
  assert.equal((await ledger.page('other')).entries.length,0);
 }finally{await c.disconnect();}
});
