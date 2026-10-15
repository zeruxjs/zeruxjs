import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createMarketingCampaignService} from '../dist/index.js';
import {createVariableRegistry} from '../../../zeruxjs/dist/variables.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
async function database(){
 const connector=await createConnector({filename:':memory:',driver:'node'});
 const operations=['createTable','insert','select','update','createIndex'];
 const db=Object.fromEntries(operations.map(op=>[op,(args)=>connector.execute({op,...args},ctx)]));
 return {db,close:()=>connector.disconnect()};
}
const delivery=()=>{
 const map=new Map();return {map,
  async create(row){if(map.has(row.id))return false;map.set(row.id,{...row});return true;},
  async load(id){return map.get(id)??null;}
 };
};
test('marketing campaign saves one template, returns code and renders paginated recipient data',async()=>{
 const {db,close}=await database();
 try{
  const jobs=[],mailStore=delivery();
  const queue={async add(name,data,options){jobs.push({name,data,options})}};
  const service=createMarketingCampaignService({db,queue,delivery:mailStore,now:()=>10_000});
  const code=await service.create({name:'October launch',subject:'Hello {{name}} {{promo}}',html:'<p>{{email}} - {{plan}}</p>',
   providers:['primary','backup'],data:{promo:'SAVE25'},isTracking:true,
   recipients:[{email:'a@example.org',name:'A & B',data:{plan:'Plus'}},{email:'b@example.org',name:'B',data:{plan:'Free'}}]});
  assert.match(code,/^camp_[a-f0-9]{32}$/);
  const saved=await service.get(code);
  assert.equal(saved.recipientCount,2);assert.equal(saved.subject,'Hello {{name}} {{promo}}');
  assert.equal(saved.status,'ready');assert.equal(saved.tracking.enabled,true);
  const page=await service.recipients(code,{limit:1});
  assert.equal(page.recipients.length,1);assert.equal(page.done,false);
  const next=await service.recipients(code,{cursor:page.nextCursor,limit:1});
  assert.equal(next.recipients.length,1);
  const items=[...page.recipients,...next.recipients];
  const alice=items.find(x=>x.email==='a@example.org');
  assert.ok(alice);assert.equal(alice.deliveryState,'pending');
  const preview=await service.preview(code,alice.id);
  assert.equal(preview.subject,'Hello A & B SAVE25');
  assert.equal(preview.html,'<p>a@example.org - Plus</p>');
  assert.ok(['primary','backup'].includes(preview.account));
  assert.equal(preview.purpose,'marketing');assert.equal(preview.tracking.campaign,code);
  assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.name==='email.deliver'&&j.data.messageId===j.options.jobId));
  assert.equal((await service.list()).campaigns.length,1);
  assert.equal((await service.enqueue(code)).queued,0);
  const sent=[];
  await service.sendById(alice.id,{async send(mail){sent.push(mail);return {account:mail.account,accepted:[alice.email],rejected:[]};}});
  assert.equal(sent[0].html,'<p>a@example.org - Plus</p>');
  await service.cancel(code);
  await assert.rejects(service.sendById(alice.id,{send:async()=>{throw Error('must not send')}}),/cancelled/);
 }finally{await close();}
});
test('queue outage leaves a durable campaign that can be re-enqueued; authorization and invalid JSON are rejected',async()=>{
 const {db,close}=await database();
 try{
  const mailStore=delivery(),jobs=[];let offline=true;
  const queue={async add(name,data,settings){if(offline)throw Error('queue offline');jobs.push({name,data,settings});}};
  const service=createMarketingCampaignService({db,queue,delivery:mailStore,now:()=>10_000});
  const code=await service.create({name:'Retry',subject:'Hi {{name}}',text:'Welcome {{email}}',account:'primary',recipients:['sample@example.org']});
  assert.equal((await service.get(code)).status,'queue_failed');
  offline=false;const progress=await service.enqueue(code);
  assert.equal(progress.queued,1);assert.equal((await service.get(code)).status,'ready');
  assert.equal(jobs.length,1);
  await assert.rejects(service.create({name:'Bad',subject:'subject',text:'body',account:'primary',data:{nested:{constructor:1}},recipients:['a@example.org']}),/Forbidden/);
  await assert.rejects(service.create({name:'Bad',subject:'subject',text:'body',account:'primary',recipients:['a@example.org','A@example.org']}),/Duplicate/);
  const guarded=createMarketingCampaignService({db,queue,delivery:mailStore,authorize:()=>false});
  await assert.rejects(guarded.get(code),/denied/);
 }finally{await close();}
});

test('one-call content/emails API supports registered ZeruxJS variables and delayed queue jobs',async()=>{
 const {db,close}=await database();
 try{
  const registry=createVariableRegistry();registry.register('app.support',async()=>"team@example.org");
  const jobs=[];const future=25_000;
  const marketing=createMarketingCampaignService({db,queue:{async add(name,data,opts){jobs.push({name,data,opts});}},
    delivery:delivery(),renderer:registry,now:()=>10_000});
  const code=await marketing.create({name:'Product',subject:'Hi {{name}} - {{app.support}}',
    content:'<p>Hi {{name}}. Contact {{app.support}} for {{offer}}</p>',providers:['smtp'],
    data:{offer:'<private>'},emails:[{email:'user@example.org',name:'Sam'}],isTracking:false,sendAt:future});
  const {recipients}=await marketing.recipients(code);
  const preview=await marketing.preview(code,recipients[0].id);
  assert.equal(preview.subject,'Hi Sam - team@example.org');
  assert.equal(preview.html,'<p>Hi Sam. Contact team@example.org for &lt;private&gt;</p>');
  assert.equal(preview.tracking.enabled,false);
  assert.equal(jobs[0].opts.delay,15_000);
  assert.equal(await marketing.deliveryGate({campaignId:code}),'defer');
  assert.equal(await marketing.deliveryGate({}),'allow');
  await marketing.cancel(code);
  assert.equal(await marketing.deliveryGate({campaignId:code}),'suppress');
 }finally{await close();}
});
