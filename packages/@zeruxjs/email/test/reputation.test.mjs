import {test} from 'node:test';import assert from 'node:assert/strict';
import {createMemoryReputationLedger,createEmailReputationService,createEmailManager,createDatabaseReputationLedger} from '../dist/index.js';
const timestamp=Date.UTC(2026,9,12,10);
const create=(policy={})=>createEmailReputationService({ledger:createMemoryReputationLedger(),now:()=>timestamp,policy:{minimumAccepted:10,...policy}});
test('rolling sender health applies AWS-like thresholds to observed feedback',async()=>{
 const service=create();
 for(let i=0;i<20;i++)await service.recordAccepted('marketing',`recipient${i}@example.test`,`smtp-${i}`);
 for(let i=0;i<2;i++)await service.recordFeedback({account:'marketing',email:`recipient${i}@example.test`,kind:'hard-bounce',eventId:`b-${i}`});
 const state=await service.snapshot('marketing');
 assert.equal(state.accepted,20);assert.equal(state.hardBounces,2);assert.equal(state.bouncePercent,10);assert.equal(state.status,'paused');
 assert.equal((await service.checkBeforeSend('marketing','marketing')).allowed,false);
 assert.equal((await service.checkBeforeSend('marketing','transactional')).allowed,true);
 assert.equal((await service.snapshot('separate')).status,'healthy');
 assert.equal(await service.recordFeedback({account:'marketing',email:'recipient0@example.test',kind:'hard-bounce',eventId:'b-0'}),false);
 assert.equal((await service.snapshot('marketing')).hardBounces,2);
});
test('incomplete feedback is not confused with inbox delivery and scan caps fail closed',async()=>{
 const svc=create({scanLimit:100});
 for(let i=0;i<100;i++)await svc.recordAccepted('sender',`recipient${i}@example.test`,`id-${i}`);
 assert.equal((await svc.snapshot('sender')).accepted,100);
 await svc.recordAccepted('sender','extra@example.test','id-overflow');
 await assert.rejects(svc.snapshot('sender'),/scan limit/);
});
test('manager consults reputation before SMTP and does not retry accepted mail when telemetry fails',async()=>{
 let sends=0,reputationCalls=0;
 const preferences={isSubscribed:async()=>true,makeUnsubscribeUrl:()=> 'https://example.test/u'};
 const manager=createEmailManager({accounts:[{name:'sender',defaults:{from:'mail@example.test'},transport:{async sendMail(){sends++;return {accepted:['recipient@example.test'],messageId:'<smtp-id@server.test>'};}}}],preferences,
  reputation:{checkBeforeSend:async(_account,purpose)=>({allowed:purpose==='transactional'}),recordAccepted:async()=>{reputationCalls++;throw new Error('db offline');}}});
 await assert.rejects(manager.send({to:'recipient@example.test',subject:'Sale',text:'Hi',purpose:'marketing'}),{code:'EMAIL_REPUTATION_PAUSED'});
 assert.equal(sends,0);
 await manager.send({to:'recipient@example.test',subject:'Receipt',text:'Done'});
 assert.equal(sends,1);assert.equal(reputationCalls,1);
});
function fakeDb(){const rows=new Map();return {
 async createTable({table}){rows.set(table,rows.get(table)??new Map());return {ok:true};},
 async insert({table,values}){if(rows.get(table).has(values.id))throw Error('unique');rows.get(table).set(values.id,{...values});return {ok:true};},
 async select({table,where,limit=500,offset=0}){const data=[...rows.get(table).values()];return {ok:true,rows:data.filter(row=>where?.and?where.and.every(cond=>cond.operator==='eq'?row[cond.field]===cond.value:row[cond.field]>=cond.value):row.id===where?.value).sort((a,b)=>a.id.localeCompare(b.id)).slice(offset,offset+limit)};}
};}
test('database reputation events survive service instances and provider dedupe',async()=>{
 const db=fakeDb();const first=createEmailReputationService({ledger:createDatabaseReputationLedger(db),now:()=>timestamp,policy:{minimumAccepted:1}});
 const second=createEmailReputationService({ledger:createDatabaseReputationLedger(db),now:()=>timestamp,policy:{minimumAccepted:1}});
 await first.recordAccepted('shared','x@example.test','smtp-id');await first.recordFeedback({account:'shared',email:'x@example.test',kind:'complaint',eventId:'provider-1'});
 assert.equal(await second.recordFeedback({account:'shared',email:'x@example.test',kind:'complaint',eventId:'provider-1'}),false);
 const snapshot=await second.snapshot('shared');assert.equal(snapshot.accepted,1);assert.equal(snapshot.complaints,1);assert.equal(snapshot.status,'paused');
});
test('signed provider feedback can feed suppression and account reputation independently',async()=>{
 const {createMarketingFeedbackEndpoint,createMemoryMarketingSuppressionStore,createMarketingSuppressionService}=await import('../dist/index.js');
 const suppression=createMarketingSuppressionService({store:createMemoryMarketingSuppressionStore()});
 const rep=create();
 const endpoint=createMarketingFeedbackEndpoint({suppression,reputation:rep,feedbackAccount:()=> 'smtp',verifySignature:async(_raw,h)=>h.get('x-signed')==='trusted',parse:raw=>JSON.parse(Buffer.from(raw).toString('utf8'))});
 const event={email:'r@example.test',eventId:'b1',kind:'hard-bounce',at:timestamp};
 const request=(signed)=>new Request('https://example.test/_email/feedback',{method:'POST',headers:{'content-type':'application/json',...(signed?{'x-signed':'trusted'}:{})},body:JSON.stringify([event])});
 assert.equal((await endpoint.handle(request(false))).status,401);
 assert.equal((await endpoint.handle(request(true))).status,204);
 assert.equal((await endpoint.handle(request(true))).status,204);
 assert.equal((await rep.snapshot('smtp')).hardBounces,1);
 assert.equal(await suppression.isSuppressed('r@example.test'),true);
});
test('a reputation scan exactly at its configured limit is complete, but an overflowing scan fails closed',async()=>{
 const ledger=createMemoryReputationLedger();
 const service=createEmailReputationService({ledger,now:()=>timestamp,policy:{minimumAccepted:1,scanLimit:100}});
 for(let i=0;i<100;i++)await service.recordAccepted('marketing',`sample${i}@example.test`,`accepted-${i}`);
 const full=await service.snapshot('marketing');
 assert.equal(full.accepted,100);
 assert.equal(full.sampleSufficient,true);
 assert.equal(full.feedbackCoverage,'reported-only');
 await service.recordAccepted('marketing','overflow@example.test','accepted-overflow');
 await assert.rejects(service.snapshot('marketing'),/scan limit/);
});
test('optional soft-bounce thresholds protect reputation without changing hard-bounce defaults',async()=>{
 const service=createEmailReputationService({ledger:createMemoryReputationLedger(),now:()=>timestamp,
   policy:{minimumAccepted:10,warnSoftBouncePercent:5,pauseSoftBouncePercent:15}});
 for(let i=0;i<20;i++)await service.recordAccepted('marketing',`soft${i}@example.test`,`smtp-soft-${i}`);
 for(let i=0;i<3;i++)await service.recordFeedback({account:'marketing',email:`soft${i}@example.test`,eventId:`soft-${i}`,kind:'soft-bounce'});
 const state=await service.snapshot('marketing');
 assert.equal(state.softBouncePercent,15);assert.equal(state.status,'paused');
 assert.equal((await service.checkBeforeSend('marketing','marketing')).allowed,false);
 assert.throws(()=>createEmailReputationService({ledger:createMemoryReputationLedger(),policy:{warnSoftBouncePercent:5}}),/Soft-bounce/);
 const empty=await service.snapshot('no-feedback');assert.equal(empty.sampleSufficient,false);
});
