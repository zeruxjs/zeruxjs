import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner,createMemoryCampaignStore,createCampaignDeliveryGate,matchesCampaignSegment} from '../dist/index.js';

const segment={all:[{field:'region',operator:'eq',value:'AU'},{field:'spent',operator:'gte',value:100}]};
const contacts=[
 {id:'c01',email:'ALICE@example.test',traits:{region:'AU',spent:220}},
 {id:'c02',email:'bob@example.test',traits:{region:'AU',spent:4}},
 {id:'c03',email:'carol@example.test',traits:{region:'AU',spent:120}},
 {id:'c04',email:'dave@example.test',traits:{region:'NZ',spent:300}}
];
function setup(overrides={}){
 const store=createMemoryCampaignStore();let now=20_000;const messages=new Map(),queued=new Map();
 let failOnce=false;const options={store,now:()=>now,batchSize:2,leaseMs:3000,
   source:{async page({cursor,limit}){const i=cursor?Number(cursor):0;const page=contacts.slice(i,i+limit);return {contacts:page,nextCursor:String(i+page.length),done:i+page.length>=contacts.length};}},
   isSubscribed:async email=>email!=='carol@example.test',isSuppressed:async()=>false,
   ensureMessage:async (target,context)=>{messages.set(target.messageId,{target,context});},
   enqueue:async id=>{if(failOnce){failOnce=false;throw Error('redis offline');}queued.set(id,(queued.get(id)??0)+1);},
   ...overrides};
 const planner=createCampaignPlanner(options);
 return {planner,store,messages,queued,advance:ms=>{now+=ms;},fail:()=>{failOnce=true;}};
}
const definition={id:'new-collection',name:'October newsletter',sendAt:20_000,segment,tracking:{enabled:true,clicks:true,opens:false}};

test('segments select typed fields and reject dangerous or malformed comparisons',()=>{
 assert.equal(matchesCampaignSegment(contacts[0],segment),true);
 assert.equal(matchesCampaignSegment(contacts[1],segment),false);
 assert.equal(matchesCampaignSegment(contacts[0],{any:[{field:'region',operator:'in',value:['NZ','AU']}]}),true);
 assert.throws(()=>matchesCampaignSegment(contacts[0],{all:[{field:'__proto__',operator:'eq',value:1}]}),/Invalid/);
 assert.throws(()=>matchesCampaignSegment(contacts[0],{all:[{field:'spent',operator:'gte',value:'100'}]}),/Numeric/);
});

test('sequential batches create stable IDs; consent excludes recipients; independent tracking is preserved',async()=>{
 const f=setup();await f.planner.create(definition);await f.planner.command(definition.id,'schedule');
 const first=await f.planner.runOnce(definition.id,'worker1');assert.deepEqual(first,{status:'running',processed:1});
 const second=await f.planner.runOnce(definition.id,'worker1');assert.deepEqual(second,{status:'completed',processed:0});
 const record=await f.planner.get(definition.id);
 assert.equal(record.scanned,4);assert.equal(record.eligible,1);assert.equal(record.skipped,3);assert.equal(record.queued,1);
 assert.equal(f.messages.size,1);assert.equal(f.queued.size,1);
 assert.deepEqual([...f.messages.values()][0].context.tracking,definition.tracking);
 assert.deepEqual(await createCampaignDeliveryGate(f.store)({campaignId:definition.id}),'allow');
});

test('partial producer failure resumes the same message without generating a second draft',async()=>{
 const f=setup();await f.planner.create(definition);await f.planner.command(definition.id,'schedule');f.fail();
 await assert.rejects(f.planner.runOnce(definition.id,'worker1'),/redis offline/);
 let saved=await f.planner.get(definition.id);assert.equal(saved.pending.length,1);assert.equal(saved.cursor,'2');assert.equal(saved.queued,0);
 assert.equal((await f.planner.runOnce(definition.id,'worker2')).status,'running');
 saved=await f.planner.get(definition.id);assert.equal(saved.queued,1);assert.equal(saved.pending.length,0);
 assert.equal(f.messages.size,1);
});

test('lease contention and expired leases recover from another process',async()=>{
 const store=createMemoryCampaignStore(),f=setup({store});await f.planner.create(definition);await f.planner.command(definition.id,'schedule');
 const old=await store.load(definition.id);await store.save({...old,version:old.version+1,lease:{token:'lost',expiresAt:23_000}},old.version);
 assert.equal((await f.planner.runOnce(definition.id,'worker1')).status,'busy');
 f.advance(3001);assert.equal((await f.planner.runOnce(definition.id,'worker2')).status,'running');
});

test('pause, resume, cancellation and delivery-time gate do not silently send queued mail',async()=>{
 const f=setup();await f.planner.create(definition);await f.planner.command(definition.id,'schedule');
 await f.planner.command(definition.id,'pause');
 assert.equal((await f.planner.runOnce(definition.id,'w')).status,'paused');
 assert.equal(await createCampaignDeliveryGate(f.store)({campaignId:definition.id}),'defer');
 await f.planner.command(definition.id,'resume');
 assert.equal(await createCampaignDeliveryGate(f.store)({campaignId:definition.id}),'allow');
 await f.planner.command(definition.id,'cancel');
 assert.equal((await f.planner.runOnce(definition.id,'w')).status,'cancelled');
 assert.equal(await createCampaignDeliveryGate(f.store)({campaignId:definition.id}),'suppress');
 assert.equal(f.queued.size,0);
});

test('consent outage fails closed before persisting page advance',async()=>{
 const f=setup({isSubscribed:async()=>{throw Error('preferences offline');}});
 await f.planner.create(definition);await f.planner.command(definition.id,'schedule');
 await assert.rejects(f.planner.runOnce(definition.id,'w'),/preferences offline/);
 const record=await f.planner.get(definition.id);assert.equal(record.cursor,null);assert.equal(record.scanned,0);assert.equal(record.pending.length,0);
});

test('no implicit tracking: omitted tracking stays undefined in drafts',async()=>{
 const f=setup();await f.planner.create({...definition,id:'not-tracked',tracking:undefined});await f.planner.command('not-tracked','schedule');
 await f.planner.runOnce('not-tracked','w');assert.equal([...f.messages.values()][0].context.tracking,undefined);
});

test('concurrent workers sharing a CAS store cannot both advance the same cursor',async()=>{
 let resolve;const hold=new Promise(r=>resolve=r);let entered=false;
 const f=setup({source:{async page({cursor}){entered=true;await hold;return {contacts:contacts.slice(0,2),nextCursor:'2',done:false};}}});
 await f.planner.create(definition);await f.planner.command(definition.id,'schedule');
 const first=f.planner.runOnce(definition.id,'w1');while(!entered)await new Promise(r=>setImmediate(r));
 assert.equal((await f.planner.runOnce(definition.id,'w2')).status,'busy');
 resolve();assert.equal((await first).status,'running');assert.equal((await f.planner.get(definition.id)).scanned,2);
});
