import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDurableEmailDeliveryProcessor,createMemoryEmailDeliveryStore,enqueueEmailCampaignBatch} from '../dist/index.js';
const record=(id,purpose='transactional')=>({id,version:1,purpose,recipient:purpose==='marketing'?'buyer@example.test':undefined,state:'pending',lease:null,updatedAt:0});
const job=id=>({name:'email.deliver',data:{messageId:id}});
test('concurrent workers do not send the same message twice',async()=>{
 const store=createMemoryEmailDeliveryStore([record('once')]);let sends=0,release;
 const hold=new Promise(resolve=>{release=resolve});
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,send:async()=>{sends++;await hold;}});
 const first=process(job('once'));
 while(sends===0)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(process(job('once')),/claim busy/);
 release();assert.equal((await first).status,'sent');
 assert.equal((await process(job('once'))).status,'sent');assert.equal(sends,1);
 assert.equal((await store.load('once')).state,'sent');
});
test('marketing unsubscribed is suppressed and tracking has no implicit connection',async()=>{
 const store=createMemoryEmailDeliveryStore([record('marketing1','marketing')]);let delivered=0;
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>false,send:async()=>{delivered++;}});
 assert.equal((await process(job('marketing1'))).status,'suppressed');assert.equal(delivered,0);
 assert.equal((await store.load('marketing1')).state,'suppressed');
});
test('consent outage releases pre-send claim so worker can safely retry',async()=>{
 const store=createMemoryEmailDeliveryStore([record('marketing2','marketing')]);let allow=false,delivered=0;
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>{if(!allow)throw Error('db offline');return true;},send:async()=>{delivered++;}});
 await assert.rejects(process(job('marketing2')),/db offline/);
 assert.equal((await store.load('marketing2')).state,'pending');
 allow=true;assert.equal((await process(job('marketing2'))).status,'sent');assert.equal(delivered,1);
});
test('SMTP timeout is uncertain and never automatically resent, including job retries',async()=>{
 const store=createMemoryEmailDeliveryStore([record('smtp1')]);let sends=0,alerts=0;
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,send:async()=>{sends++;throw Error('ETIMEDOUT');},onUncertain:()=>alerts++});
 assert.equal((await process(job('smtp1'))).status,'uncertain');
 assert.equal((await process(job('smtp1'))).status,'uncertain');
 assert.equal(sends,1);assert.equal(alerts,1);
 assert.equal((await store.load('smtp1')).state,'uncertain');
});
test('crashed sending lease expires into uncertain state, without repeat SMTP',async()=>{
 let now=100_000,sends=0,alerts=0;
 const store=createMemoryEmailDeliveryStore([record('crash')]);
 const release=()=>{};
 let fire;
 const pending=new Promise(resolve=>{fire=resolve});
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,send:async()=>{sends++;await pending;},now:()=>now,leaseMs:3000,onUncertain:()=>{alerts++;}});
 const inFlight=process(job('crash'));
 while(sends===0)await new Promise(resolve=>setImmediate(resolve));
 now+=4000;
 assert.equal((await process(job('crash'))).status,'uncertain');
 fire();assert.equal((await inFlight).status,'uncertain');
 assert.equal(sends,1);
 assert.equal((await store.load('crash')).state,'uncertain');assert.equal(alerts,1);
});
test('campaign batch contains only IDs and delays, validates all input before enqueue',async()=>{
 const actual=[];const queue={addBulk:async jobs=>{actual.push(...jobs);return jobs;}};
 await enqueueEmailCampaignBatch(queue,['m01','m02'],{sendAt:20_000,now:10_000});
 assert.equal(actual.length,2);assert.deepEqual(actual[0].data,{messageId:'m01'});
 assert.deepEqual(actual[0].options,{jobId:'email-m01',delay:10_000,attempts:5,backoff:{type:'exponential',delay:5000}});
 await assert.rejects(enqueueEmailCampaignBatch(queue,['m01','m01'],{sendAt:20_000,now:10_000}),/distinct/);
 await assert.rejects(enqueueEmailCampaignBatch(queue,['m00'],{sendAt:1,now:100_000}),/time/);
 assert.equal(actual.length,2);
});
test('uncertain SMTP delivery requires explicit privileged resolution, never resubmission',async()=>{
 const {resolveUncertainEmailDelivery}=await import('../dist/index.js');
 const store=createMemoryEmailDeliveryStore([{...record('uncertain01'),state:'uncertain'}]);
 const options={context:{admin:true},authorize:async ctx=>ctx?.admin===true};
 await assert.rejects(resolveUncertainEmailDelivery(store,'uncertain01','sent',{...options,context:{admin:false}}),/forbidden/);
 assert.equal((await store.load('uncertain01')).state,'uncertain');
 assert.equal(await resolveUncertainEmailDelivery(store,'uncertain01','sent',options),true);
 assert.equal((await store.load('uncertain01')).state,'sent');
 await assert.rejects(resolveUncertainEmailDelivery(store,'uncertain01','sent',options),/Only uncertain/);
});

test('expired claim before SMTP may be reclaimed without losing a job',async()=>{
 const stale={...record('preflight'),state:'claimed',lease:{owner:'offline',token:'old',expiresAt:1000}};
 const store=createMemoryEmailDeliveryStore([stale]);let sends=0;
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,send:async()=>{sends++;},now:()=>2000,leaseMs:3000});
 assert.equal((await process(job('preflight'))).status,'sent');assert.equal(sends,1);
});
