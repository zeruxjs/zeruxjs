import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDurableEmailDeliveryProcessor,createMemoryEmailDeliveryStore} from '../dist/index.js';
const record=id=>({id,version:1,purpose:'transactional',state:'pending',lease:null,updatedAt:0});
const job=id=>({name:'email.deliver',data:{messageId:id}});
test('a resolved SMTP call with unknown outcome never becomes sent or gets resent',async()=>{
 const store=createMemoryEmailDeliveryStore([record('unknown')]);let sends=0,uncertain=0;
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,send:async()=>{sends++;return {submissionStatus:'unknown'};},onUncertain:()=>uncertain++});
 assert.equal((await process(job('unknown'))).status,'uncertain');
 assert.equal((await process(job('unknown'))).status,'uncertain');assert.equal(sends,1);assert.equal(uncertain,1);
});
test('fully rejected SMTP envelopes are durable terminal rejected, partial accepts require review',async()=>{
 const store=createMemoryEmailDeliveryStore([record('rejected'),record('partial'),record('accepted')]);
 const send=async id=>({submissionStatus:id==='rejected'?'rejected':id==='partial'?'partial':'accepted'});
 const process=createDurableEmailDeliveryProcessor({store,isSubscribed:async()=>true,send});
 for(const id of ['rejected','partial','accepted'])await process(job(id));
 assert.equal((await store.load('rejected')).state,'rejected');
 assert.equal((await store.load('partial')).state,'uncertain');
 assert.equal((await store.load('accepted')).state,'sent');
});
