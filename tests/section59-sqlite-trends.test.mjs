/** Optional cross-package real SQLite smoke test; not part of Queue's mock-only suite.
 * Run after compiling @zeruxjs/db, db-sql-core, db-sqlite and Queue.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
import {createDatabaseCampaignTrendsReporter,createDatabaseEmailDeliveryStore,createDatabaseProviderOutcomeLedger} from '@zeruxjs/queue';
const require=createRequire(import.meta.url);
const {createConnector}=require('@zeruxjs/db-sqlite');
const context={connection:{slug:'default',name:'default',connector:'@zeruxjs/db-sqlite',options:{}}};
const day=d=>Date.parse(`${d}T00:00:00Z`);
test('real SQLite day-grouped states and verified events across two independent connections',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zerux-section59-'));const filename=path.join(dir,'campaign.sqlite');
 const a=await createConnector({filename,driver:'node'});const b=await createConnector({filename,driver:'node'});
 const db=conn=>({createTable:q=>conn.execute({op:'createTable',...q},context),createIndex:q=>conn.execute({op:'createIndex',...q},context),insert:q=>conn.execute({op:'insert',...q},context),select:q=>conn.execute({op:'select',...q},context),update:q=>conn.execute({op:'update',...q},context)});
 try{
  const store=createDatabaseEmailDeliveryStore(db(a));
  await store.create({id:'intro',version:1,purpose:'marketing',campaignId:'fall',recipient:'redacted@example.test',state:'sent',lease:null,updatedAt:day('2026-10-10')});
  const insert=a.getNativeConnection().prepare('INSERT INTO zerux_email_delivery (id,version,campaign_id,state,updated_at,payload_json) VALUES (?,?,?,?,?,?)');
  for(let i=0;i<1200;i++)insert.run(`x${i}`,1,i%2?'fall':'other',i%3?'sent':'suppressed',day(i%4?'2026-10-10':'2026-10-11')+i,'{}');
  const ledger=createDatabaseProviderOutcomeLedger(db(a));
  await ledger.record({eventId:'e-1',provider:'localtest',campaignId:'fall',messageId:'intro',kind:'delivered',occurredAt:day('2026-10-10')});
  await ledger.record({eventId:'e-2',provider:'localtest',campaignId:'fall',messageId:'intro',kind:'complaint',occurredAt:day('2026-10-11')});
  const reporter=createDatabaseCampaignTrendsReporter({db:db(b),providerTable:'zerux_email_provider_outcomes'});
  const result=await reporter('fall','2026-10-10','2026-10-12');
  assert.equal(result.total,601);assert.equal(result.providerEvents,2);
  assert.equal(result.days.reduce((n,d)=>n+d.total,0),601);
  assert.deepEqual(result.days.map(d=>d.providerEvents),[1,1,0]);
  assert.equal(result.days[2].total,0);
  await assert.rejects(reporter('fall','2026-09-30','2026-09-29'),/range|window|bounds/);
 }finally{await a.disconnect();await b.disconnect();await rm(dir,{recursive:true,force:true});}
});
