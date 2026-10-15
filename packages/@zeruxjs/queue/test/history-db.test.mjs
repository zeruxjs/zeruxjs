import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDatabaseEmailDeliveryHistory,createJournaledEmailDeliveryStore,createDatabaseEmailDeliveryStore} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const context={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
async function setup(){const connector=await createConnector({filename:':memory:',driver:'node'});
 const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,args=>connector.execute({op,...args},context)]));
 return {db,close:()=>connector.disconnect()};}
test('append-only delivery transitions are idempotent and aggregate by actual transition day',async()=>{
 const {db,close}=await setup();
 try{
  const ledger=createDatabaseEmailDeliveryHistory(db);
  const base=createDatabaseEmailDeliveryStore(db),store=createJournaledEmailDeliveryStore(base,ledger);
  const day=Date.parse('2026-10-13T03:00:00Z');
  const row={id:'mail1',campaignId:'campaign1',version:1,purpose:'marketing',recipient:'a@example.org',state:'pending',lease:null,updatedAt:day};
  assert.equal(await store.create(row),true);
  assert.equal(await store.create(row),false);
  assert.equal(await store.save('mail1',{...row,version:2,state:'claimed',updatedAt:day+1000},1),true);
  assert.equal(await store.save('mail1',{...row,version:2,state:'sent',updatedAt:day+1000},1),false);
  assert.equal(await store.save('mail1',{...row,version:3,state:'sent',updatedAt:day+2000},2),true);
  assert.equal(await store.save('mail1',{...row,version:4,state:'sent',updatedAt:day+3000},3),true); // same-state metadata update is not a new transition
  const timeline=await ledger.trends('campaign1','2026-10-13','2026-10-13');
  assert.equal(timeline.days[0].total,3);
  assert.equal(timeline.days[0].counts.pending,1);
  assert.equal(timeline.days[0].counts.claimed,1);
  assert.equal(timeline.days[0].counts.sent,1);
  assert.equal(timeline.coverage,'recorded-transitions-only');
  const page1=await ledger.page('campaign1',{limit:2});
  assert.equal(page1.events.length,2);assert.equal(page1.done,false);
  const page2=await ledger.page('campaign1',{cursor:page1.nextCursor,limit:2});
  assert.equal(page2.events.length,1);
  const replay=page1.events[0];
  assert.equal(await ledger.record(replay),false);
  await assert.rejects(ledger.record({...replay,to:'uncertain'}),/Conflicting/);
  assert.equal((await ledger.page('another')).events.length,0);
 }finally{await close();}
});
