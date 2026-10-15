import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabaseDeliveryOutbox,createDeliveryOutboxDispatcher,createOutboxBackedEmailQueue,
 createDatabaseEmailDeliveryStore} from '../dist/index.js';
const require=createRequire(import.meta.url);const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
const facade=c=>Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,arg=>c.execute({op,...arg},ctx)]));
const mk=(id)=>({id,version:1,purpose:'marketing',recipient:'secret@example.test',campaignId:'campaign69',state:'pending',lease:null,updatedAt:5000});
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'zerux-outbox-'));let a,b;
 try{const file=join(dir,'mail.sqlite');a=await createConnector({filename:file,driver:'node'});b=await createConnector({filename:file,driver:'node'});
  return await fn(facade(a),facade(b));
 }finally{await a?.disconnect();await b?.disconnect();await rm(dir,{recursive:true,force:true});}
}
test('durable outbox survives Redis failure, crash after queue acceptance, concurrent workers',()=>fixture(async(dbA,dbB)=>{
 let t=5000;const a=createDatabaseDeliveryOutbox(dbA,'zerux_email_publish_outbox',()=>t),b=createDatabaseDeliveryOutbox(dbB,'zerux_email_publish_outbox',()=>t);
 const delivery=createDatabaseEmailDeliveryStore(dbA);await delivery.create(mk('one'));
 assert.deepEqual(await a.register('one',{scheduledAt:9000,attempts:5}),{created:true,status:'pending'});
 assert.deepEqual(await b.register('one',{scheduledAt:9000,attempts:5}),{created:false,status:'pending'});
 await assert.rejects(b.register('one',{scheduledAt:9001,attempts:5}),/Conflicting/);
 const jobs=[];let fail=true;
 const publisher={add:async(name,data,options)=>{
  if(fail)throw Error('Redis unavailable');jobs.push({name,data,options});return {id:options.jobId};
 }};
 const first=createDeliveryOutboxDispatcher({outbox:a,queue:publisher,delivery,now:()=>t,leaseMs:3000});
 const second=createDeliveryOutboxDispatcher({outbox:b,queue:publisher,delivery,now:()=>t,leaseMs:3000});
 await assert.rejects(first.dispatch('one'),/Redis unavailable/);
 assert.equal((await b.get('one')).status,'pending');
 fail=false;
 const [x,y]=await Promise.all([first.dispatch('one'),second.dispatch('one')]);
 assert.deepEqual([x,y].sort(),['published','skipped']);
 assert.equal(jobs.length,1);assert.deepEqual(jobs[0],{name:'email.deliver',data:{messageId:'one'},options:{jobId:'one',delay:4000,attempts:5}});
 assert.equal((await first.runPage()).published,0);
 assert.equal(JSON.stringify(await a.get('one')).includes('secret@example.test'),false);
 await delivery.create(mk('two'));
 await a.register('two',{scheduledAt:9000});
 const claim=await a.claim('two',3000);assert.ok(claim.lease.token);
 assert.equal(await b.claim('two',3000),null);
 t=8001;
 const stolen=await b.claim('two',3000);assert.notEqual(stolen.lease.token,claim.lease.token);
 assert.equal(await a.settle('two',claim.lease.token,'published'),false);
 assert.equal(await b.settle('two',stolen.lease.token,'pending'),true);
 assert.equal(await first.dispatch('two'),'published');
 assert.equal(jobs.at(-1).options.jobId,'two');
}));
test('registration-only producer preserves intent through outages and scans recover pending rows',()=>fixture(async(db)=>{
 let t=10000;const outbox=createDatabaseDeliveryOutbox(db,'zerux_email_publish_outbox',()=>t);
 const delivery=createDatabaseEmailDeliveryStore(db);
 for(const id of ['a','b','c'])await delivery.create(mk(id));
 const queue=createOutboxBackedEmailQueue({outbox,now:()=>t});
 const push=id=>queue.add('email.deliver',{messageId:id},{jobId:id,delay:5000,attempts:3});
 for(const id of ['a','b','c'])assert.equal((await push(id)).persisted,true);
 t=11000;await push('a');assert.equal((await outbox.get('a')).scheduledAt,15000);
 await assert.rejects(queue.add('email.deliver',{messageId:'a'},{jobId:'a',delay:0,attempts:2}),/Conflicting/);
 let attempts=0;
 const dispatcher=createDeliveryOutboxDispatcher({outbox,queue:{add:async()=>{attempts++;return {id:'ok'};}},delivery,now:()=>t});
 const p1=await dispatcher.runPage({limit:2});assert.equal(p1.published,2);assert.ok(p1.nextCursor);
 const p2=await dispatcher.runPage({cursor:p1.nextCursor,limit:2});assert.equal(p2.published,1);
 assert.equal(attempts,3);
 assert.equal((await outbox.page({limit:2})).items.length,2);
 const old=await delivery.load('c');assert.equal(await delivery.save('c',{...old,state:'sent',version:2},1),true);
 assert.equal((await dispatcher.dispatch('c')),'skipped');
 // Reset with a new pending row whose delivery is already terminal.
 await delivery.create({...mk('terminal'),state:'sent'});
 await outbox.register('terminal',{scheduledAt:11000});
 assert.equal(await dispatcher.dispatch('terminal'),'abandoned');assert.equal((await outbox.get('terminal')).status,'abandoned');
}));
test('queue acknowledgement crash may replay ID but never changes stable job identity',()=>fixture(async(db)=>{
 let t=1000;const ledger=createDatabaseDeliveryOutbox(db,'zerux_email_publish_outbox',()=>t);
 const delivery=createDatabaseEmailDeliveryStore(db);await delivery.create(mk('crash'));
 await ledger.register('crash',{scheduledAt:1000});
 const observed=[];const queue={add:async(name,data,opts)=>{observed.push(opts.jobId);return {id:opts.jobId};}};
 const dispatcher=createDeliveryOutboxDispatcher({outbox:ledger,queue,delivery,now:()=>t,leaseMs:3000});
 const token=(await ledger.claim('crash',3000)).lease.token;
 // Simulate a process that published to Redis but died before DB ack.
 await queue.add('email.deliver',{messageId:'crash'},{jobId:'crash',delay:0,attempts:3});
 t=4001;assert.equal(await dispatcher.dispatch('crash'),'published');
 assert.deepEqual(observed,['crash','crash']);
 assert.equal(await ledger.settle('crash',token,'published'),false);
}));
test('due scans skip published history, redrive is authorized and only reopens missing pending jobs',()=>fixture(async(db)=>{
 const {createDeliveryOutboxRedriver,createDeliveryOutboxJobProcessor}=await import('../dist/index.js');
 const outbox=createDatabaseDeliveryOutbox(db,'zerux_email_publish_outbox',()=>5000);
 const delivery=createDatabaseEmailDeliveryStore(db);
 for(let i=0;i<18;i++){
  const id=`item${String(i).padStart(2,'0')}`;await delivery.create(mk(id));await outbox.register(id,{scheduledAt:5000});
 }
 const published=[];const queue={add:async(_name,_data,opt)=>{published.push(opt.jobId);return {id:opt.jobId}},getJob:async()=>null};
 const dispatcher=createDeliveryOutboxDispatcher({outbox,queue,delivery,now:()=>5000});
 const poll=createDeliveryOutboxJobProcessor(dispatcher,{pageSize:5,maxPages:10});
 const first=await poll({name:'email.outbox.poll',data:{}});
 assert.deepEqual([first.published,first.done,published.length],[18,true,18]);
 assert.equal((await outbox.due({limit:5})).items.length,0);
 await delivery.create(mk('zzNew'));await outbox.register('zzNew',{scheduledAt:5000});
 const run=await dispatcher.runPage({limit:1});assert.equal(run.published,1);assert.equal(published.at(-1),'zzNew');
 const blocked=createDeliveryOutboxRedriver({outbox,queue,delivery,authorize:()=>false});
 await assert.rejects(blocked('item00'),/not authorized/);
 const redrive=createDeliveryOutboxRedriver({outbox,queue,delivery,authorize:()=>true});
 assert.deepEqual(await redrive('item00'),{reopened:true,reason:'queue-job-missing'});
 assert.equal((await outbox.due()).items[0].id,'item00');
 assert.equal(await dispatcher.dispatch('item00'),'published');assert.equal(published.filter(x=>x==='item00').length,2);
 const jobExists=createDeliveryOutboxRedriver({outbox,queue:{getJob:async()=>({id:'item01'})},delivery,authorize:()=>true});
 assert.deepEqual(await jobExists('item01'),{reopened:false,reason:'queue-job-present'});
 await assert.rejects(poll({name:'email.outbox.poll',data:{private:'value'}}),/no job payload/);
}));
test('in-flight claimed delivery is deferred rather than permanently abandoned, recovery restores it',()=>fixture(async(db)=>{
 const {createEmailDeliveryRecoveryScanner}=await import('../dist/index.js');
 let t=7000;const outbox=createDatabaseDeliveryOutbox(db,'zerux_email_publish_outbox',()=>t);
 const delivery=createDatabaseEmailDeliveryStore(db);
 await delivery.create({...mk('claimed'),state:'claimed',lease:{owner:'process',token:'old',expiresAt:6000}});
 await outbox.register('claimed',{scheduledAt:7000});
 const queued=[];const dispatch=createDeliveryOutboxDispatcher({outbox,queue:{add:async(_n,_d,o)=>{queued.push(o.jobId);return {};}},delivery,now:()=>t});
 assert.equal(await dispatch.dispatch('claimed'),'deferred');
 assert.equal((await outbox.get('claimed')).status,'pending');assert.deepEqual(queued,[]);
 const scan=createEmailDeliveryRecoveryScanner({store:delivery,now:()=>t});
 const recovered=await scan('campaign69',{dryRun:false});assert.equal(recovered.recoveredClaims,1);
 assert.equal(await dispatch.dispatch('claimed'),'published');assert.deepEqual(queued,['claimed']);
}));

test('function-first campaign can enqueue to durable outbox without Redis and dispatch later',()=>fixture(async(db)=>{
 const {createMarketingCampaignService}=await import('../../email/dist/index.js');
 let t=1000;const outbox=createDatabaseDeliveryOutbox(db,'zerux_email_publish_outbox',()=>t);
 const delivery=createDatabaseEmailDeliveryStore(db);
 const producer=createOutboxBackedEmailQueue({outbox,now:()=>t});
 const campaign=createMarketingCampaignService({db,queue:producer,delivery,now:()=>t});
 const code=await campaign.create({name:'Outbox recovery',subject:'Hello {{name}}',content:'Welcome {{email}}',contentType:'text',
  account:'primary',recipients:[{name:'A',email:'a@example.org'},{name:'B',email:'b@example.org'}]});
 assert.equal((await campaign.audience(code)).enqueued,2);
 assert.equal((await outbox.due()).items.length,2);
 const jobs=[];const dispatcher=createDeliveryOutboxDispatcher({outbox,delivery,now:()=>t,queue:{add:async(name,data,opts)=>{jobs.push({name,data,opts});return {id:opts.jobId}}}});
 const published=await dispatcher.runPage();assert.equal(published.published,2);assert.equal(jobs.length,2);
 assert.equal(jobs.every(j=>j.name==='email.deliver'&&Object.keys(j.data).join()==='messageId'),true);
 assert.equal(jobs.every(j=>!JSON.stringify(j).includes('example.org')),true);
 const source=await campaign.recipients(code);assert.equal(source.recipients.length,2);
 assert.equal((await outbox.due()).items.length,0);
}));

test('missing outbox intent after delivery commit is repaired only for approved pending messages',()=>fixture(async(db)=>{
 const {createMissingEmailPublishIntentScanner}=await import('../dist/index.js');
 const ledger=createDatabaseDeliveryOutbox(db,'zerux_email_publish_outbox',()=>3000);
 const store=createDatabaseEmailDeliveryStore(db);
 await store.create(mk('missed'));await store.create({...mk('done'),state:'sent'});
 const denied=createMissingEmailPublishIntentScanner({source:store,outbox:ledger,allowCampaign:()=>false});
 await assert.rejects(denied('campaign69',{scheduledAt:3000}),/forbidden/);
 const scan=createMissingEmailPublishIntentScanner({source:store,outbox:ledger,allowCampaign:()=>true});
 const dry=await scan('campaign69',{scheduledAt:4000});assert.equal(dry.missing,1);assert.equal((await ledger.due()).items.length,0);
 const first=await scan('campaign69',{scheduledAt:4000,dryRun:false});assert.equal(first.registered,1);
 assert.equal((await ledger.get('missed')).scheduledAt,4000);assert.equal(await ledger.get('done'),null);
 const replay=await scan('campaign69',{scheduledAt:4000,dryRun:false});assert.equal(replay.registered,0);
}));
