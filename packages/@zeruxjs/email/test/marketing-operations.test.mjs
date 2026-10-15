import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createMarketingCampaignService} from '../dist/index.js';
import {createVariableRegistry} from '../../../zeruxjs/dist/variables.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
async function database(){const connector=await createConnector({filename:':memory:',driver:'node'});
 const db=Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,args=>connector.execute({op,...args},ctx)]));
 return {db,close:()=>connector.disconnect()};}
const delivery=()=>{const rows=new Map();return {map:rows,
 async create(v){if(rows.has(v.id))return false;rows.set(v.id,{...v});return true;},
 async load(id){return rows.get(id)??null;}
}};
test('draft-style creation, appended recipients, counts, exact pagination, pause and resume',async()=>{
 const {db,close}=await database();try{
  const jobs=[],service=createMarketingCampaignService({db,queue:{async add(name,data,opts){jobs.push({name,data,opts});}},delivery:delivery(),now:()=>1000});
  const code=await service.create({name:'Big',subject:'Hello {{name}}',content:'<p>{{name}}</p>',account:'main',autoEnqueue:false,
    recipients:['first@example.com']});
  assert.equal(jobs.length,0);
  assert.equal((await service.audience(code)).unqueued,1);
  const added=await service.appendRecipients(code,[{name:'Second',email:'second@example.com'},'third@example.com']);
  assert.equal(added.added,2);assert.equal(added.recipientCount,3);
  assert.equal((await service.appendRecipients(code,[{name:'Second',email:'second@example.com'}])).existing,1);
  await assert.rejects(service.appendRecipients(code,[{name:'Different',email:'second@example.com'}]),/Conflicting/);
  const ids=[];let cursor=null;do{const page=await service.recipients(code,{cursor,limit:1});ids.push(...page.recipients.map(v=>v.id));cursor=page.nextCursor;}while(cursor);
  assert.equal(new Set(ids).size,3);
  const first=await service.list({limit:1});assert.equal(first.done,true);assert.equal(first.nextCursor,null);
  const paused=await service.pause(code);assert.equal(paused.status,'paused');
  assert.equal(await service.deliveryGate({campaignId:code}),'defer');
  await assert.rejects(service.enqueue(code),/cannot be enqueued/);
  await service.resume(code);assert.equal(await service.deliveryGate({campaignId:code}),'allow');
  const progress=await service.enqueue(code);assert.equal(progress.queued,3);assert.equal(jobs.length,3);
  const totals=await service.audience(code);assert.equal(totals.enqueued,3);assert.equal(totals.unqueued,0);
  assert.equal((await service.appendRecipients(code,['fourth@example.com'],true)).queued,1);
  assert.equal(jobs.length,4);
  await service.pause(code);
  await assert.rejects(service.sendById(ids[0],{send:async()=>{throw Error('should not send')}}),/deferred/);
  await service.resume(code);
  await service.cancel(code);assert.equal(await service.deliveryGate({campaignId:code}),'suppress');
  await assert.rejects(service.appendRecipients(code,['fifth@example.com']),/Cannot append/);
 }finally{await close();}
});
test('registered async variables resolve once across subject, HTML, text; output is HTML escaped',async()=>{
 const {db,close}=await database();try{
  const registry=createVariableRegistry();let calls=0;
  registry.register('offer.code',async()=>{calls++;return '<SAVE>';});
  const service=createMarketingCampaignService({db,renderer:registry,delivery:delivery(),queue:{async add(){}},now:()=>1000});
  const code=await service.create({name:'Offer',subject:'{{offer.code}} {{offer.code}}',html:'<b>{{offer.code}}</b>',text:'{{offer.code}}',
    account:'main',recipients:[{name:'Alice',email:'alice@example.com'}],autoEnqueue:false});
  const {recipients}=await service.recipients(code);
  const message=await service.preview(code,recipients[0].id);
  assert.equal(calls,1);assert.equal(message.subject,'<SAVE> <SAVE>');assert.equal(message.html,'<b>&lt;SAVE&gt;</b>');assert.equal(message.text,'<SAVE>');
  assert.deepEqual(registry.extract('{{name}} {{offer.code}} {{name}}'),['name','offer.code']);
 }finally{await close();}
});
test('campaign list uses a true lookahead cursor for exact page boundaries',async()=>{
 const {db,close}=await database();try{
  const service=createMarketingCampaignService({db,delivery:delivery(),queue:{async add(){}},now:()=>1000});
  for(let i=0;i<3;i++)await service.create({name:'Campaign'+i,subject:'Hi',text:'Plain',account:'main',autoEnqueue:false,recipients:[`u${i}@example.com`]});
  let cursor=null,records=[];do{const p=await service.list({cursor,limit:1});records.push(...p.campaigns);cursor=p.nextCursor;}while(cursor);
  assert.equal(records.length,3);assert.equal(new Set(records.map(r=>r.code)).size,3);
 }finally{await close();}
});
test('operator redrive requeues only previously enqueued pending records, never sent or uncertain',async()=>{
 const {db,close}=await database();try{
  const jobs=[],state=delivery();const service=createMarketingCampaignService({db,delivery:state,
    queue:{async add(name,data,options){jobs.push({name,data,options});}},now:()=>1000});
  const code=await service.create({name:'Recovery',subject:'Hello',text:'Content',account:'main',
    recipients:['a@example.com','b@example.com','c@example.com']});
  assert.equal(jobs.length,3);
  const {recipients}=await service.recipients(code,{limit:3});
  const sent=state.map.get(recipients[0].id);state.map.set(sent.id,{...sent,state:'sent'});
  const unknown=state.map.get(recipients[1].id);state.map.set(unknown.id,{...unknown,state:'uncertain'});
  const once=await service.redrivePending(code,{limit:3});
  assert.equal(once.eligible,1);assert.equal(once.submitted,1);assert.equal(jobs.length,4);
  assert.equal(jobs[3].data.messageId,recipients[2].id);
  await service.pause(code);
  await assert.rejects(service.redrivePending(code),/cannot be redriven/);
  await service.resume(code);
  const strict=createMarketingCampaignService({db,delivery:state,queue:{async add(){}},authorize:action=>action!=='redrive'});
  await assert.rejects(strict.redrivePending(code),/denied/);
 }finally{await close();}
});
test('provider checks, retryable queue outages, and PII-free audit hooks',async()=>{
 const {db,close}=await database();try{
  let online=false;const audit=[];
  const service=createMarketingCampaignService({db,delivery:delivery(),now:()=>1000,
    queue:{async add(){if(!online)throw new Error('Redis temporarily down');}},
    verifyProvider:account=>account==='authorized',onAudit:e=>{audit.push(e);throw new Error('audit sink down');}});
  await assert.rejects(service.create({name:'Invalid provider',subject:'Hi',text:'Hello',account:'unknown',
    recipients:['one@example.com'],autoEnqueue:false}),/provider unavailable/);
  const code=await service.create({name:'Recovery',subject:'Hi',text:'Hello',account:'authorized',
    recipients:['one@example.com'],autoEnqueue:false});
  assert.equal((await service.get(code)).status,'ready');
  await assert.rejects(service.enqueue(code),/Redis temporarily down/);
  assert.equal((await service.get(code)).status,'queue_failed');
  online=true;
  assert.equal((await service.enqueue(code)).queued,1);
  assert.equal((await service.get(code)).status,'ready');
  assert.ok(audit.every(entry=>!JSON.stringify(entry).includes('one@example.com')));
 }finally{await close();}
});
