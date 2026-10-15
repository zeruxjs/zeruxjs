import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createMarketingCampaignService,createMarketingCampaignDashboard} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'section70',name:'section70',connector:'@zeruxjs/db-sqlite',options:{}}};
async function database(){
  const conn=await createConnector({filename:':memory:',driver:'node'});
  const db=Object.fromEntries(['createTable','createIndex','insert','select','update','delete']
    .map(op=>[op,args=>conn.execute({op,...args},ctx)]));
  return {db,close:()=>conn.disconnect()};
}
function deliveries(){
  const records=new Map();return {records,
    async create(r){if(records.has(r.id))return false;records.set(r.id,{...r});return true;},
    async load(id){return records.get(id)??null;}
  };
}
const createInput=(recipients,extra={})=>({name:'Section 70',subject:'Welcome {{name}} {{discount}}',
  html:'<p>{{name}}</p>',text:'Plain {{name}}',account:'primary',data:{discount:'SAVE'},
  recipients,autoEnqueue:false,...extra});

test('segmented campaigns: portable keyset batches, schedule, explicit consent and suppression',async()=>{
  const {db,close}=await database();try{
    const jobs=[],store=deliveries(),time=1000;
    const service=createMarketingCampaignService({db,delivery:store,
      queue:{async add(name,data,opts){jobs.push({name,data,opts});}},now:()=>time,
      isSubscribed:email=>email!=='unsubscribed@example.com',
      isSuppressed:email=>email==='suppressed@example.com'});
    const users=[{email:'unsubscribed@example.com',data:{tier:'gold'}},
      {email:'suppressed@example.com',data:{tier:'gold'}},
      {email:'bronze@example.com',data:{tier:'bronze'}},
      ...Array.from({length:412},(_,i)=>({email:`user${i}@example.com`,data:{tier:'gold'}}))];
    const code=await service.create(createInput(users,{segment:{all:[{field:'tier',operator:'eq',value:'gold'}]}}));
    const scheduled=await service.schedule(code,101_000);
    assert.equal(scheduled.queued,412);assert.equal(scheduled.excluded,3);
    assert.equal(jobs.length,412);assert.ok(jobs.every(j=>j.name==='email.deliver'&&j.data.messageId===j.opts.jobId&&j.opts.delay===100_000));
    assert.equal((await service.audience(code)).unqueued,3);
    await assert.rejects(service.schedule(code,200_000),/Already enqueued/);
    assert.equal((await service.enqueue(code)).queued,0);
    const list=await service.list();assert.equal(list.campaigns.length,1);
    const page=await service.previewPage(code,{limit:1});assert.equal(page.items.length,1);
    assert.equal(page.items[0].subject.includes('SAVE'),true);
    const redacted=await service.exportPage(code,{limit:2});
    assert.equal(redacted.items.length,2);assert.ok(!('email' in redacted.items[0]));
    assert.equal((await service.exportPage(code,{cursor:redacted.nextCursor,limit:2})).items.length,2);
  }finally{await close();}
});

test('two workers sharing a SQL CAS store cannot simultaneously publish the same campaign page',async()=>{
  const {db,close}=await database();try{
    const store=deliveries();let release;let notify;
    const entered=new Promise(ok=>notify=ok),blocker=new Promise(ok=>release=ok),jobs=[];
    const queue={async add(name,data,opts){jobs.push(data.messageId);notify();await blocker;}};
    const one=createMarketingCampaignService({db,delivery:store,queue,now:()=>1000});
    const two=createMarketingCampaignService({db,delivery:store,queue,now:()=>1000});
    const code=await one.create(createInput(['single@example.com']));
    const first=one.enqueue(code);await entered;
    await assert.rejects(two.enqueue(code),/operation is busy/);
    release();assert.equal((await first).queued,1);
    assert.equal((await two.enqueue(code)).queued,0);
    assert.deepEqual(jobs.length,1);
  }finally{await close();}
});

test('archive blocks unknown SMTP outcomes; sensitive exports require extra permission; retention fails closed',async()=>{
  const {db,close}=await database();try{
    let allowPII=false,legalHold=true,time=10_000;
    const delivery=deliveries();const jobs=[];
    const service=createMarketingCampaignService({db,delivery,now:()=>time,
      queue:{async add(_n,d){jobs.push(d.messageId);},async getJob(){return null;}},
      authorize:action=>action!=='exportPII'||allowPII,
      approveRetention:()=>!legalHold});
    const code=await service.create(createInput([{email:'alice@example.com',name:'Alice',data:{secret:'sensitive'}},'bob@example.com'],{autoEnqueue:true}));
    assert.equal(jobs.length,2);
    assert.equal((await service.redrivePending(code,{limit:2})).submitted,2); // approved operator, absent jobs, pending records
    const first=await service.recipients(code);
    assert.equal(first.recipients.length,2);
    const row=delivery.records.get(first.recipients[0].id);
    delivery.records.set(row.id,{...row,state:'uncertain'});
    await service.cancel(code);
    await assert.rejects(service.archive(code),/pending or uncertain/);
    for(const r of first.recipients){const state=delivery.records.get(r.id);delivery.records.set(r.id,{...state,state:'suppressed'});}
    const archived=await service.archive(code);assert.equal(archived.status,'archived');
    assert.equal(await service.deliveryGate({campaignId:code}),'suppress');
    const redactedExport=await service.exportPage(code);
    assert.doesNotMatch(JSON.stringify(redactedExport),/alice@example.com|sensitive/);
    await assert.rejects(service.exportPage(code,{includePII:true}),/denied/);
    allowPII=true;const privateExport=await service.exportPage(code,{includePII:true});
    assert.match(JSON.stringify(privateExport),/sensitive/);
    time=12_000;
    await assert.rejects(service.redactArchived(code,{olderThan:11_000,dryRun:false}),/not approved/);
    legalHold=false;
    const dry=await service.redactArchived(code,{olderThan:11_000});assert.equal(dry.deleted,0);
    const erased=await service.redactArchived(code,{olderThan:11_000,dryRun:false});
    assert.equal(erased.deleted,2);assert.equal(erased.redacted,true);
    const saved=await service.get(code);assert.equal(saved.subject,'[redacted]');
    assert.deepEqual(saved.data,{});assert.equal(saved.redactedAt,12_000);
    assert.equal((await service.exportPage(code)).items.length,0);
    assert.equal((await service.redactArchived(code,{olderThan:11_000,dryRun:false})).redacted,true);
  }finally{await close();}
});

test('operator dashboard enforces origin, CSRF, scoped schedule/export/archive permissions',async()=>{
  const {db,close}=await database();try{
    let permitted='schedule';const service=createMarketingCampaignService({db,delivery:deliveries(),queue:{async add(){}},now:()=>1000});
    const code=await service.create(createInput(['one@example.com']));
    const dash=createMarketingCampaignDashboard({service,authorize:()=>({role:'operator'}),authorizeCreate:()=>true,
      authorizeCampaign:(_who,id,action)=>id===code&&action===permitted,verifyCsrf:()=>true,csrfToken:()=>'x'.repeat(32)});
    const url='https://marketing.example.org/_email/marketing/api';
    const post=(action,extra={},origin='https://marketing.example.org')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({code,action,...extra})});
    assert.equal((await dash.handle(post('schedule',{sendAt:5000},'https://attacker.example'))).status,403);
    assert.equal((await dash.handle(post('schedule',{sendAt:5000}))).status,200);
    permitted='export';
    const e=await (await dash.handle(new Request(url+'?code='+code+'&view=export'))).json();
    assert.equal(e.items.length,1);assert.ok(!('email' in e.items[0]));
    assert.equal((await dash.handle(post('archive'))).status,403);
  }finally{await close();}
});

test('durable PII-free audit trail and state reports never infer inbox delivery from SMTP acceptance',async()=>{
  const {db,close}=await database();try{
    const {createDatabaseMarketingAuditLog}=await import('../dist/index.js');
    const log=createDatabaseMarketingAuditLog(db),delivery=deliveries();
    const service=createMarketingCampaignService({db,delivery,queue:{async add(){}},now:()=>1000,onAudit:log.record});
    const code=await service.create(createInput(['one@example.com','two@example.com'],{autoEnqueue:true}));
    const {recipients}=await service.recipients(code);
    const row=delivery.records.get(recipients[0].id);
    delivery.records.set(row.id,{...row,state:'sent'});
    const result=await service.report(code,{limit:1});
    assert.equal(result.scanned,1);assert.equal(result.done,false);
    const entire=await service.report(code,{limit:10});
    assert.equal(entire.states.smtpAccepted,1);
    assert.equal(entire.states.pending,1);
    assert.match(entire.disclaimer,/not confirmed mailbox/);
    const audit=await log.page(code);
    assert.ok(audit.items.some(x=>x.action==='create'));
    assert.ok(audit.items.some(x=>x.action==='enqueue'));
    assert.doesNotMatch(JSON.stringify(audit),/one@example.com|two@example.com/);
    const second=await log.page(code,{limit:1});assert.equal(second.done,false);
    assert.equal((await log.page(code,{cursor:second.nextCursor,limit:1})).items.length,1);
  }finally{await close();}
});

test('completed campaigns transition only after all durable SMTP outcomes become terminal',async()=>{
  const {db,close}=await database();try{
    const delivery=deliveries(),service=createMarketingCampaignService({db,delivery,queue:{async add(){}},now:()=>1000});
    const code=await service.create(createInput(['one@example.org','two@example.org'],{autoEnqueue:true}));
    const pending=await service.finalize(code);
    assert.equal(pending.status,'ready');assert.equal(pending.nonterminal,2);
    for(const id of delivery.records.keys()){const row=delivery.records.get(id);delivery.records.set(id,{...row,state:'sent'});}
    const complete=await service.finalize(code);assert.equal(complete.status,'completed');
    assert.equal((await service.get(code)).status,'completed');
    assert.equal(await service.deliveryGate({campaignId:code}),'suppress');
    await assert.rejects(service.enqueue(code),/cannot be enqueued/);
    assert.equal((await service.archive(code)).status,'archived');
  }finally{await close();}
});
