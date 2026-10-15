import {test} from 'node:test';import assert from 'node:assert/strict';import {createHmac,timingSafeEqual} from 'node:crypto';
import {createMemoryMarketingSuppressionStore,createMarketingSuppressionService,createMarketingFeedbackEndpoint} from '../dist/index.js';
const secret='test-signature-key';
const sign=bytes=>createHmac('sha256',secret).update(bytes).digest('hex');
const store=createMemoryMarketingSuppressionStore(),suppression=createMarketingSuppressionService({store});
const service=createMarketingFeedbackEndpoint({suppression,verifySignature:async(raw,headers)=>{
 const given=headers.get('x-provider-signature');if(!given||!/^[0-9a-f]{64}$/.test(given))return false;
 return timingSafeEqual(Buffer.from(given,'hex'),Buffer.from(sign(raw),'hex'));
},parse:raw=>JSON.parse(Buffer.from(raw).toString('utf8'))});
const post=(body,signature=sign(Buffer.from(body)))=>service.handle(new Request('https://example.test/_email/feedback',{method:'POST',headers:{'content-type':'application/json','x-provider-signature':signature},body}));
test('feedback endpoint rejects unsigned/tampered requests and never alters suppression',async()=>{
 const payload=JSON.stringify([{email:'test@example.test',eventId:'f1',kind:'hard-bounce'}]);
 assert.equal((await post(payload,'deadbeef')).status,401);
 assert.equal((await service.handle(new Request('https://example.test/_email/feedback'))).status,405);
 assert.equal(await suppression.isSuppressed('test@example.test'),false);
 assert.equal((await post(payload)).status,204);
 assert.equal(await suppression.isSuppressed('test@example.test'),true);
 assert.equal((await post(payload)).status,204);
 assert.equal((await suppression.status('test@example.test')).eventIds.length,1);
});
test('authenticated invalid payload or failed persistence returns explicit errors',async()=>{
 assert.equal((await post('bad-json')).status,400);
 const offline=createMarketingFeedbackEndpoint({suppression:{recordFeedback:async()=>{throw Error('DB down');}},verifySignature:async()=>true,parse:()=>[{email:'test@example.test',eventId:'f2',kind:'complaint'}]});
 assert.equal((await offline.handle(new Request('https://example.test/_email/feedback',{method:'POST',headers:{'content-type':'application/json'},body:'[]'}))).status,503);
});
