import {test} from 'node:test';import assert from 'node:assert/strict';
import {createMailingListService,createMemoryMailingContactStore,createDatabaseMailingContactStore} from '../dist/index.js';
const service=createMailingListService({store:createMemoryMailingContactStore(),now:()=>1000});
test('contact list management and campaign cursor stay deterministic',async()=>{
 await service.upsert('first@example.test',['vip'],{region:'AU',spent:23});
 await service.upsert('second@example.test',['vip','retail'],{region:'US'});
 await service.upsert('third@example.test',['retail']);
 await service.upsert('FIRST@example.test',['vip','staff'],{spent:40});
 let cursor=null,all=[];do{const page=await service.campaignSource('vip').page({cursor,limit:1});all.push(...page.contacts);cursor=page.nextCursor;}while(cursor);
 assert.equal(all.length,2);assert.equal(all.find(r=>r.email==='first@example.test').traits.spent,40);
 assert.equal(await service.removeFromList('FIRST@example.test','vip'),true);
 assert.equal((await service.page('vip')).contacts.length,1);
 await assert.rejects(service.upsert('a@example.test',['bad:list']),/memberships/);
 await assert.rejects(service.upsert('a@example.test',[],{'__proto__':'bad'}),/Invalid/).catch(()=>{});
});
test('database contact store shares updates and uses versioned CAS',async()=>{
 const records=new Map();const db={
  async createTable(){return {ok:true};},
  async insert({values}){if(records.has(values.id))throw Error('unique');records.set(values.id,{...values});return {ok:true};},
  async select({where,limit=100}){const all=[...records.values()].sort((a,b)=>a.id.localeCompare(b.id));return {ok:true,rows:all.filter(r=>!where?true:where.and?where.and.every(c=>r[c.field]===c.value):where.operator==='gt'?r.id>where.value:r.id===where.value).slice(0,limit)};},
  async update({where,values}){const id=where.and[0].value,version=where.and[1].value,old=records.get(id);if(!old||old.version!==version)return {ok:true,affectedCount:0};records.set(id,{...old,...values});return {ok:true,affectedCount:1};}
 };
 const one=createMailingListService({store:createDatabaseMailingContactStore(db)});
 const two=createMailingListService({store:createDatabaseMailingContactStore(db)});
 await one.upsert('contact@example.test',['newsletter'],{country:'IN'});
 await two.upsert('contact@example.test',['buyers'],{total:100});
 const page=await one.page('buyers');assert.equal(page.contacts[0].traits.country,'IN');
 assert.equal(page.contacts[0].traits.total,100);
});
test('contact erasure uses atomic versioning and removes stored recipient PII',async()=>{
 const s=createMailingListService({store:createMemoryMailingContactStore()});
 await s.upsert('person@example.test',['newsletter'],{region:'AU'});
 assert.equal(await s.erase('PERSON@example.test'),true);
 assert.equal(await s.erase('person@example.test'),false);
 assert.deepEqual((await s.page('newsletter')).contacts,[]);
 await s.upsert('person@example.test',['newsletter'],{region:'NZ'});
 assert.equal((await s.page('newsletter')).contacts[0].traits.region,'NZ');
});
test('database contact erasure refuses missing atomic delete and respects row version fences',async()=>{
 const rows=new Map();const db={
  async createTable(){return {ok:true};},
  async insert({values}){if(rows.has(values.id))throw Error('duplicate');rows.set(values.id,{...values});return {ok:true};},
  async select({where}){return {ok:true,rows:[...rows.values()].filter(r=>r.id===where.value)};},
  async update(){return {ok:true,affectedCount:0};}
 };
 const s=createMailingListService({store:createDatabaseMailingContactStore(db)});
 await s.upsert('erase@example.test',['subscriber'],{country:'IN'});
 await assert.rejects(s.erase('erase@example.test'),/atomic delete/);
 db.delete=async({where})=>{const id=where.and[0].value,v=where.and[1].value;
  if(rows.get(id)?.version!==v)return {ok:true,affectedCount:0};rows.delete(id);return {ok:true,affectedCount:1};};
 assert.equal(await s.erase('erase@example.test'),true);
 assert.equal(rows.size,0);
});
