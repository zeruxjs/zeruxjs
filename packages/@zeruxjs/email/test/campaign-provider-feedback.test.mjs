import {test} from 'node:test';import assert from 'node:assert/strict';
import {createMarketingFeedbackEndpoint} from '../dist/index.js';
const event={email:'someone@example.test',kind:'hard-bounce',eventId:'evt-12',at:1000};
const signed=()=>new Request('https://app.example.test/_email/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([event])});
test('authenticated provider feedback writes both suppression and attributed outcomes',async()=>{
 const seen=[],suppression=[];
 const app=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[event],suppression:{recordFeedback:async e=>{suppression.push(e.eventId)}},
  providerOutcomes:{record:async e=>{seen.push(e);return true}},feedbackDelivery:()=>({campaignId:'camp58',messageId:'mail12',provider:'smtp-provider',occurredAt:1000})});
 assert.equal((await app.handle(signed())).status,204);
 assert.deepEqual(seen[0],{campaignId:'camp58',messageId:'mail12',provider:'smtp-provider',occurredAt:1000,kind:'hard-bounce',eventId:'evt-12'});
 assert.deepEqual(suppression,['evt-12']);
});
test('unsigned notifications and failed provider ledger writes cannot acknowledge success',async()=>{
 const unverified=createMarketingFeedbackEndpoint({verifySignature:()=>false,parse:()=>[event],suppression:{recordFeedback:async()=>{throw Error('must not run')}},
  providerOutcomes:{record:async()=>{throw Error('must not run')}},feedbackDelivery:()=>({campaignId:'camp58',messageId:'mail12',provider:'test',occurredAt:1000})});
 assert.equal((await unverified.handle(signed())).status,401);
 const failing=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[event],suppression:{recordFeedback:async()=>{}},
  providerOutcomes:{record:async()=>{throw Error('offline')}},feedbackDelivery:()=>({campaignId:'camp58',messageId:'mail12',provider:'test',occurredAt:1000})});
 assert.equal((await failing.handle(signed())).status,503);
 assert.throws(()=>createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[],suppression:{recordFeedback:async()=>{}},providerOutcomes:{record:async()=>true}}),/callbacks/);
});
test('signed provider delivered/deferred events bypass suppression but enter verified outcome ledger',async()=>{
 const seen=[],suppressed=[];
 const delivered={eventId:'delivery-confirmed-9',kind:'delivered',at:2000};
 const app=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[delivered],suppression:{recordFeedback:async e=>{suppressed.push(e)}},
  providerOutcomes:{record:async e=>{seen.push(e);return true}},feedbackDelivery:()=>({campaignId:'camp58',messageId:'mail12',provider:'relay',occurredAt:2000})});
 assert.equal((await app.handle(signed())).status,204);
 assert.equal(suppressed.length,0);
 assert.deepEqual(seen[0],{eventId:'delivery-confirmed-9',kind:'delivered',campaignId:'camp58',messageId:'mail12',provider:'relay',occurredAt:2000});
 const missing=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[delivered],suppression:{recordFeedback:async()=>{throw Error('should not run')}}});
 assert.equal((await missing.handle(signed())).status,503);
});
