import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNumericReconciliationJob} from '../dist/index.js';

function storeFixture(){
 let document;
 const store={
  async load(){return structuredClone(document);},
  async save(value,expected){
   await Promise.resolve();
   if(document.version!==expected)return false;
   document=structuredClone(value);
   return true;
  }
 };
 return {store,seed:initial=>{document=structuredClone(initial);}};
}
const query={since:100,until:200,batchSize:3};
const result={scanned:3,expectedFacts:3,created:3,existing:0,invalidRows:0,nextCursor:'evt003',hasMore:true,windowExhausted:false};
function fixture(){
 let current=1000;
 const store=storeFixture();
 const opt={id:'job-test',query,projectionKey:'fields-v1',store:store.store,leaseMs:3000,now:()=>current,
  reconcile:async()=>result};
 const make=(overrides={})=>createNumericReconciliationJob({...opt,...overrides});
 // initialize the fake DB from the same durable state schema by leveraging the store's seed.
 store.seed({version:1,id:'job-test',projectionKey:'fields-v1',pass:1,query,status:'pending',cursor:null,
  scanned:0,created:0,existing:0,invalidRows:0,expectedFacts:0,pages:0,epoch:0,lease:null,updatedAt:0,lastError:null});
 return {make,now:()=>current,advance:n=>{current+=n;}};
}
test('a fenced worker cannot overwrite a newer worker, restart refuses active leases',async()=>{
 const f=fixture(),a=f.make(),b=f.make();
 const old=await a.acquire('worker-one');
 assert.ok(old);
 await assert.rejects(b.restart(),/leased by another worker/);
 assert.equal(await b.acquire('worker-two'),null);
 f.advance(3001);
 const replacement=await b.acquire('worker-two');
 assert.ok(replacement);
 assert.notEqual(old.token,replacement.token);
 await assert.rejects(a.checkpoint(old,result),/lease lost/);
 await assert.rejects(a.renew(old),/lease lost/);
 const first=await b.checkpoint(replacement,result);
 assert.equal(first.cursor,'evt003');
 assert.equal(first.scanned,3);
 assert.equal(first.epoch,2);
 assert.equal(first.lease,null);
 const renewed=await a.acquire('worker-one');
 assert.ok(renewed);
 await a.renew(renewed);
 await a.checkpoint(renewed,{...result,nextCursor:null,hasMore:false,windowExhausted:true,scanned:1,created:1,expectedFacts:1});
 assert.equal((await b.get()).status,'completed');
 assert.equal(await b.acquire('worker-two'),null);
 assert.equal((await b.restart()).status,'pending');
 assert.equal((await a.get()).cursor,null);
});
test('a malformed reconciliation page is rejected without advancing durable cursor',async()=>{
 const f=fixture(),job=f.make();
 const lease=await job.acquire('worker-one');
 for(const broken of [
  {...result,created:4},
  {...result,nextCursor:null},
  {...result,hasMore:false},
  {...result,scanned:-1},
  {...result,nextCursor:'\u0000'}
 ]){
  await assert.rejects(job.checkpoint(lease,broken),/Invalid reconciliation checkpoint result|Invalid reconciliation page metrics/);
  assert.equal((await job.get()).cursor,null);
 }
 f.advance(3000);
 await assert.rejects(job.checkpoint(lease,result),/lease lost/);
});
test('a stored checkpoint rejects changed projection or immutable query without silent replay',async()=>{
 const f=fixture();
 await assert.rejects(f.make({projectionKey:'fields-v2'}).get(),/conflict/);
 await assert.rejects(f.make({query:{...query,site:'another'}}).get(),/conflict/);
 assert.throws(()=>f.make({query:{...query,cursor:'client-cursor'}}),/cursor/);
});
test('a failure releases the lease, preserves cursor, and permits retry',async()=>{
 const f=fixture();let calls=0;
 const job=f.make({reconcile:async()=>{calls++;if(calls===1)throw new Error('database unavailable');return {...result,hasMore:false,windowExhausted:true,nextCursor:null};}});
 await assert.rejects(job.runOnce('worker-one'),/database unavailable/);
 const failed=await job.get();
 assert.equal(failed.status,'failed');assert.equal(failed.cursor,null);assert.equal(failed.lastError,'database unavailable');
 const step=await job.runOnce('worker-two');
 assert.equal(step.busy,false);
 assert.equal(step.state.status,'completed');
 assert.equal(step.state.scanned,3);
});

test('competing first-time owners get exactly one lease under atomic CAS',async()=>{
 const f=fixture(),a=f.make(),b=f.make();
 const [one,two]=await Promise.all([a.acquire('one'),b.acquire('two')]);
 assert.equal(Number(Boolean(one))+Number(Boolean(two)),1);
 assert.equal((await a.get()).epoch,1);
});
