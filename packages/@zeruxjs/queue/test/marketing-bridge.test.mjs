import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createMarketingCampaignService} from '../../email/dist/index.js';
import {createDatabaseEmailDeliveryStore,createJournaledEmailDeliveryStore,createDatabaseEmailDeliveryHistory,createDurableEmailDeliveryProcessor} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const context={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
test('end-to-end persisted marketing queue respects consent, cancel, and journaled SMTP state',async()=>{
 const sqlite=await createConnector({filename:':memory:',driver:'node'});
 try{
  const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,args=>sqlite.execute({op,...args},context)]));
  const journal=createDatabaseEmailDeliveryHistory(db),store=createJournaledEmailDeliveryStore(createDatabaseEmailDeliveryStore(db),journal);
  const jobs=[];
  const campaigns=createMarketingCampaignService({db,delivery:store,queue:{add:async(name,data)=>{jobs.push({name,data});}}});
  const id=await campaigns.create({name:'Campaign 60',subject:'Hi {{name}}',content:'Text {{email}}',contentType:'text',
    account:'mailer',emails:[{name:'A',email:'a@example.org'},{name:'B',email:'b@example.org'}],isTracking:true});
  assert.equal(jobs.length,2);
  const sent=[];
  const worker=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,isSuppressed:async()=>false,
    campaignGate:campaigns.deliveryGate,send:(messageId)=>campaigns.sendById(messageId,{async send(message){sent.push(message);return {account:message.account,accepted:[],rejected:[]};}})});
  const first=await worker(jobs[0]);
  assert.equal(first.status,'sent');
  const again=await worker(jobs[0]);assert.equal(again.status,'sent');assert.equal(sent.length,1);
  const report=await journal.trends(id,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10));
  assert.equal(report.days[0].counts.sent,1);assert.equal(report.days[0].counts.pending,2);
  await campaigns.cancel(id);
  assert.equal((await worker(jobs[1])).status,'suppressed');assert.equal(sent.length,1);
  assert.equal((await journal.trends(id,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10))).days[0].counts.suppressed,1);
 }finally{await sqlite.disconnect();}
});
