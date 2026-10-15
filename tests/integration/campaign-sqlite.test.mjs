import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createDatabaseCampaignStore,createDatabaseMarketingSuppressionStore,createCampaignPlanner,createMarketingSuppressionService} from '../../packages/@zeruxjs/email/dist/index.js';
const context={connection:{slug:'primary',connector:'sqlite',options:{},name:'Primary'}};
const facade=driver=>({createTable:op=>driver.execute({...op,op:'createTable'},context),insert:op=>driver.execute({...op,op:'insert'},context),update:op=>driver.execute({...op,op:'update'},context),select:op=>driver.execute({...op,op:'select'},context)});
test('real SQLite campaign checkpoint and suppression CAS coordinate across independent DB connections',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zerux-campaign-'));let d1,d2;
 try{
  const file=join(dir,'campaign.sqlite');
  d1=await createConnector({filename:file,driver:'node'},context.connection);
  d2=await createConnector({filename:file,driver:'node'},context.connection);
  const store1=createDatabaseCampaignStore(facade(d1)),store2=createDatabaseCampaignStore(facade(d2));
  let now=1000;
  const setup=store=>createCampaignPlanner({store,now:()=>now,batchSize:1,leaseMs:3000,
    source:{async page({cursor}){return cursor?{contacts:[],nextCursor:null,done:true}:{contacts:[{id:'c1',email:'hello@example.test'}],nextCursor:'c1',done:false};}},
    isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{}});
  const a=setup(store1),b=setup(store2);await a.create({id:'campaign2026',name:'Tests',sendAt:1000});await a.command('campaign2026','schedule');
  const stale=await store2.load('campaign2026');
  assert.equal((await a.runOnce('campaign2026','worker-A')).status,'running');
  assert.equal(await store2.save({...stale,version:stale.version+1,status:'cancelled'},stale.version),false);
  assert.equal((await b.runOnce('campaign2026','worker-B')).status,'completed');
  const result=await store1.load('campaign2026');assert.equal(result.scanned,1);assert.equal(result.queued,1);
  const sup1=createMarketingSuppressionService({store:createDatabaseMarketingSuppressionStore(facade(d1))});
  const sup2=createMarketingSuppressionService({store:createDatabaseMarketingSuppressionStore(facade(d2))});
  await Promise.all([sup1.recordFeedback({email:'HELLO@example.test',kind:'soft-bounce',eventId:'x1'}),sup2.recordFeedback({email:'hello@example.test',kind:'hard-bounce',eventId:'x2'})]);
  const suppression=await sup1.status('hello@example.test');assert.equal(suppression.blocked,true);assert.equal(suppression.eventIds.length,2);
 }finally{await d1?.disconnect?.();await d2?.disconnect?.();await rm(dir,{recursive:true,force:true});}
});
