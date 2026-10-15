import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager,classifySmtpAcceptance,describeSmtpOutcome,createMarketingFeedbackEndpoint,createMemoryMarketingSuppressionStore,createMarketingSuppressionService} from '../dist/index.js';
const example={from:'test@example.test',to:'buyer@example.test',subject:'Hello',text:'World'};
function manager(sendMail,opts={}){return createEmailManager({accounts:[{name:'sender',defaults:{from:'test@example.test'},transport:{sendMail}}],...opts});}
test('SMTP outcome only counts validated envelope recipients, never infers delivery',()=>{
 const complete=classifySmtpAcceptance(['A@example.test','b@example.test'],{accepted:['a@example.test'],rejected:['b@example.test']});
 assert.equal(complete.status,'partial');assert.equal(complete.complete,true);
 assert.equal(classifySmtpAcceptance(['a@example.test'],{}).status,'unknown');
 assert.deepEqual(classifySmtpAcceptance(['a@example.test'],{rejected:['a@example.test']}).rejected,['a@example.test']);
 assert.equal(classifySmtpAcceptance(['a@example.test'],{rejected:['a@example.test']}).status,'rejected');
 assert.equal(classifySmtpAcceptance(['a@example.test'],{accepted:['a@example.test'],rejected:['a@example.test']}).status,'unknown');
 const wrong=classifySmtpAcceptance(['a@example.test'],{accepted:['intruder@example.test']});
 assert.equal(wrong.status,'unknown');assert.equal(wrong.warning,'unrecognized-recipient');
 assert.deepEqual(describeSmtpOutcome(wrong),{status:'unknown',acceptedCount:0,rejectedCount:0,complete:false,warning:'unrecognized-recipient'});
});
test('manager records ONLY reported SMTP-accepted recipients and does not call onSent for unknown',async()=>{
 const recorded=[],warnings=[],sent=[];
 const svc=manager(async()=>({messageId:'generated',response:'250 accepted message'}),{
  reputation:{checkBeforeSend:async()=>({allowed:true}),recordAccepted:async(...a)=>recorded.push(a)},
  tracking:{instrumentHtml:html=>html,onSent:async entry=>sent.push(entry)},
  onSmtpWarning:warning=>warnings.push(warning)
 });
 const result=await svc.send({...example,tracking:{enabled:true}});
 assert.equal(result.submissionStatus,'unknown');assert.equal(result.acceptanceComplete,false);
 assert.equal(recorded.length,0);assert.equal(sent.length,0);assert.equal(warnings[0].reason,'unreported-outcome');
 assert.doesNotMatch(JSON.stringify(warnings),/buyer@/);await svc.close();
});
test('manager reports partial SMTP acceptance without claiming all recipients delivered',async()=>{
 const accepted=[],svc=manager(async()=>({accepted:['Buyer@example.test'],rejected:['second@example.test'],messageId:'smtp'}),{
  reputation:{checkBeforeSend:async()=>({allowed:true}),recordAccepted:async(_a,recipient)=>accepted.push(recipient)}
 });
 const result=await svc.send({...example,cc:'second@example.test'});
 assert.equal(result.submissionStatus,'partial');assert.equal(result.accepted.length,1);assert.equal(result.rejected.length,1);
 assert.deepEqual(accepted,['buyer@example.test']);
});
test('idempotency key is bound to the message and tracking policy for concurrent and completed sends',async()=>{
 let sends=0,release;
 const pending=new Promise(resolve=>release=resolve);
 const svc=manager(async()=>{sends++;await pending;return {accepted:['buyer@example.test'],messageId:'id'};});
 const first=svc.send({...example,idempotencyKey:'once'});
 await assert.rejects(svc.send({...example,subject:'Another',idempotencyKey:'once'}),{code:'EMAIL_IDEMPOTENCY_CONFLICT'});
 release();await first;
 await assert.rejects(svc.send({...example,text:'Changed',idempotencyKey:'once'}),{code:'EMAIL_IDEMPOTENCY_CONFLICT'});
 assert.equal((await svc.send({...example,idempotencyKey:'once'})).skipped,true);
 assert.equal(sends,1);
});
const post=(endpoint,data)=>endpoint.handle(new Request('https://test.example.test/_email/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}));
test('signed mixed-validity feedback batch is rejected BEFORE any suppression write',async()=>{
 const store=createMemoryMarketingSuppressionStore(),suppression=createMarketingSuppressionService({store});
 const api=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:raw=>JSON.parse(Buffer.from(raw).toString()),suppression});
 const first={kind:'hard-bounce',email:'a@example.test',eventId:'evt1'};
 assert.equal((await post(api,[first,{kind:'unknown',eventId:'evt2',email:'b@example.test'}])).status,400);
 assert.equal((await post(api,[first,{kind:'manual',eventId:'evt3',email:'b@example.test'}])).status,400);
 assert.equal((await post(api,[first,{kind:'complaint',eventId:'evt4',email:'bad-address'}])).status,400);
 assert.equal(await suppression.isSuppressed('a@example.test'),false);
 assert.equal((await post(api,[first])).status,204);
 assert.equal(await suppression.isSuppressed('a@example.test'),true);
});
test('account and provider attribution is validated for entire signed batch before writing',async()=>{
 const writes=[],first={kind:'hard-bounce',email:'a@example.test',eventId:'evt5'};
 const endpoint=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[first,{kind:'delivered',eventId:'evt6'}],
  suppression:{recordFeedback:async()=>writes.push('suppression')},
  providerOutcomes:{record:async()=>{writes.push('outcome');return true}},
  feedbackDelivery:e=>({provider:'test',campaignId:'campaign',messageId:e.eventId==='evt6'?'bad id':'message',occurredAt:Date.now()})});
 assert.equal((await post(endpoint,[first])).status,400);assert.deepEqual(writes,[]);
});
test('provider-authenticated multi-store partial failure returns 503 for safe at-least-once replay',async()=>{
 const seen=[],store=createMemoryMarketingSuppressionStore(),suppression=createMarketingSuppressionService({store});
 const event={kind:'hard-bounce',email:'a@example.test',eventId:'evt7'};
 const endpoint=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:()=>[event],suppression,
  providerOutcomes:{record:async()=>{seen.push('fail');throw Error('DB offline')}},
  feedbackDelivery:()=>({provider:'trusted',campaignId:'camp',messageId:'message',occurredAt:1000})});
 assert.equal((await post(endpoint,[event])).status,503);
 assert.equal((await post(endpoint,[event])).status,503);
 assert.equal((await suppression.status('a@example.test')).eventIds.length,1);
 assert.equal(seen.length,2);
});
test('verified failover switches before send; after send error it NEVER retries on backup',async()=>{
 const sends=[],accounts=[
  {name:'primary',transport:{verify:async()=>false,sendMail:async()=>{throw Error('not reached')}},defaults:{from:'test@example.test'}},
  {name:'backup',transport:{verify:async()=>true,sendMail:async()=>{sends.push('backup');return {accepted:['buyer@example.test']};}},defaults:{from:'test@example.test'}}
 ];
 const service=createEmailManager({accounts});
 assert.equal((await service.sendWithVerifiedFailover(example,['primary','backup'])).account,'backup');
 assert.deepEqual(sends,['backup']);
 await assert.rejects(service.sendWithVerifiedFailover(example,['primary']),{code:'EMAIL_NO_VERIFIED_TRANSPORT'});
 const risky=createEmailManager({accounts:[
  {name:'primary',transport:{verify:async()=>true,sendMail:async()=>{sends.push('primary');throw Error('ambiguous SMTP timeout');}},defaults:{from:'test@example.test'}},
  {name:'backup',transport:{verify:async()=>true,sendMail:async()=>{sends.push('backup-again');return {accepted:['buyer@example.test']};}},defaults:{from:'test@example.test'}}
 ]});
 await assert.rejects(risky.sendWithVerifiedFailover(example,['primary','backup']),/ambiguous SMTP timeout/);
 assert.deepEqual(sends,['backup','primary']);
});
test('SMTP security rules prevent deliberate STARTTLS downgrade and invalid timeouts',async()=>{
 const {validateSmtp}=await import('../dist/index.js');
 assert.throws(()=>validateSmtp({host:'smtp.example.test',port:587,ignoreTLS:true}),/unsafe/);
 assert.throws(()=>validateSmtp({host:'smtp.example.test',port:587,requireTLS:false}),/unsafe/);
 assert.throws(()=>validateSmtp({host:'smtp.example.test',port:465,secure:false}),/TLS/);
 assert.throws(()=>validateSmtp({host:'smtp.example.test',port:587,socketTimeout:-1}),/timeout/);
 assert.doesNotThrow(()=>validateSmtp({host:'smtp.example.test',port:465,secure:true}));
});
test('duplicate event IDs in authenticated provider batch are deduplicated; conflicting reuse aborts batch',async()=>{
 const written=[],a={kind:'complaint',eventId:'duplicate1',email:'a@example.test'};
 const endpoint=createMarketingFeedbackEndpoint({verifySignature:()=>true,parse:raw=>JSON.parse(Buffer.from(raw).toString()),suppression:{recordFeedback:async evt=>written.push(evt.eventId)}});
 assert.equal((await post(endpoint,[a,{...a}])).status,204);assert.deepEqual(written,['duplicate1']);
 assert.equal((await post(endpoint,[a,{...a,email:'different@example.test'}])).status,400);
 assert.deepEqual(written,['duplicate1']);
});
