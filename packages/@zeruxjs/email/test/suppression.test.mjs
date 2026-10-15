import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarketingSuppressionService,createMemoryMarketingSuppressionStore} from '../dist/index.js';

test('hard bounce and complaint block marketing, duplicate provider notifications do not count twice',async()=>{
 const store=createMemoryMarketingSuppressionStore(),s=createMarketingSuppressionService({store});
 const a={email:'BOUNCE@example.test',eventId:'provider:001',kind:'hard-bounce'};
 assert.deepEqual(await s.recordFeedback(a),{blocked:true,duplicate:false});
 assert.deepEqual(await s.recordFeedback(a),{blocked:true,duplicate:true});
 assert.equal(await s.isSuppressed('bounce@example.test'),true);
 assert.equal((await s.status('bounce@example.test')).softBounces,0);
 assert.equal((await s.status('bounce@example.test')).eventIds.length,1);
});
test('soft bounce threshold and CAS races count unique events',async()=>{
 const s=createMarketingSuppressionService({store:createMemoryMarketingSuppressionStore()});
 const mk=n=>({email:'soft@example.test',eventId:`smtp:${n}`,kind:'soft-bounce'});
 const [first,second]=await Promise.all([s.recordFeedback(mk(1)),s.recordFeedback(mk(2))]);
 assert.equal(first.blocked&&second.blocked,false);
 assert.equal((await s.status('soft@example.test')).softBounces,2);
 assert.equal((await s.recordFeedback(mk(3))).blocked,true);
 assert.equal(await s.isSuppressed('SOFT@example.test'),true);
 assert.equal((await s.recordFeedback(mk(3))).duplicate,true);
});
test('invalid provider feedback is rejected and database outage never reports not suppressed',async()=>{
 const s=createMarketingSuppressionService({store:createMemoryMarketingSuppressionStore()});
 await assert.rejects(s.recordFeedback({email:'x@example.test',eventId:'',kind:'complaint'}),/Invalid/);
 await assert.rejects(createMarketingSuppressionService({store:{load:async()=>{throw Error('DB offline')},create:async()=>true,save:async()=>true}}).isSuppressed('x@example.test'),/DB offline/);
});
