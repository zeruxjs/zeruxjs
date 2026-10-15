import {test} from 'node:test';import assert from 'node:assert/strict';
import {enqueueCampaignPlan,createCampaignPlanningProcessor,createDurableEmailDeliveryProcessor,createMemoryEmailDeliveryStore} from '../dist/index.js';
test('campaign Redis job only stores a validated opaque identifier with deterministic sequence',async()=>{
 const calls=[],q={add:async (...args)=>{calls.push(args);return {name:args[0],data:args[1]};}};
 await enqueueCampaignPlan(q,'qcampaign',{sequence:3,delay:1500});
 assert.deepEqual(calls[0][1],{campaignId:'qcampaign',sequence:3});
 assert.equal(calls[0][2].jobId,'campaign-qcampaign-3');
 await assert.rejects(enqueueCampaignPlan(q,'../../secrets'),/Invalid/);
});
test('campaign planning processor schedules next page and rejects unknown campaign jobs',async()=>{
 const calls=[],processor=createCampaignPlanningProcessor({planners:{abc:{runOnce:async(id,owner)=>({status:'running',processed:7})}},scheduleNext:async(...args)=>calls.push(args)});
 assert.deepEqual(await processor({name:'campaign.plan',data:{campaignId:'abc',sequence:2}}),{status:'running',processed:7});
 assert.deepEqual(calls,[['abc',3,'running']]);
 await assert.rejects(processor({name:'campaign.plan',data:{campaignId:'other',sequence:2}}),/Unknown/);
});
test('queued mail campaign gate supports defer, cancel suppression, and completed delivery',async()=>{
 const record={id:'message1',version:1,purpose:'marketing',campaignId:'campaign1',recipient:'a@example.test',state:'pending',lease:null,updatedAt:0};
 const store=createMemoryEmailDeliveryStore([record]);let gate='defer',sent=0;
 const processor=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,campaignGate:async()=>gate,send:async()=>{sent++;}});
 await assert.rejects(processor({name:'email.deliver',data:{messageId:'message1'}}),/not accepting delivery/);
 assert.equal((await store.load('message1')).state,'pending');
 gate='allow';assert.equal((await processor({name:'email.deliver',data:{messageId:'message1'}})).status,'sent');assert.equal(sent,1);
 const store2=createMemoryEmailDeliveryStore([{...record,id:'message2'}]);
 const cancel=createDurableEmailDeliveryProcessor({store:store2,isSubscribed:async()=>true,campaignGate:async()=> 'suppress',send:async()=>{sent++;}});
 assert.equal((await cancel({name:'email.deliver',data:{messageId:'message2'}})).status,'suppressed');assert.equal(sent,1);
});

test('marketing suppression is independent from consent and blocks queued delivery',async()=>{
 const record={id:'blocked1',version:1,purpose:'marketing',recipient:'b@example.test',state:'pending',lease:null,updatedAt:0};
 const store=createMemoryEmailDeliveryStore([record]);let sendCount=0;
 const processor=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,isSuppressed:async()=>true,send:async()=>{sendCount++;}});
 assert.equal((await processor({name:'email.deliver',data:{messageId:'blocked1'}})).status,'suppressed');
 assert.equal(sendCount,0);
});
