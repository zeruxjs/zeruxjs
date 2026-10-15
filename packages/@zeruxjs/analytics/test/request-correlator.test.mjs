import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequestId,validRequestId,requestUtcDay,createMemoryRequestIdStore,createDatabaseRequestIdStore,createDatabaseDocumentStore,createAnalyticsCollector} from '../dist/index.js';
test('request IDs are cryptographically sized, valid and diverse',()=>{
 const ids=new Set(Array.from({length:1000},createRequestId));assert.equal(ids.size,1000);for(const id of ids)assert.ok(validRequestId(id));
 assert.equal(requestUtcDay(Date.UTC(2026,9,11,23,59,59)),'2026-10-11');assert.equal(requestUtcDay(Date.UTC(2026,9,12,0,0)),'2026-10-12');
});
test('UTC-day request reservations are atomic in memory and reject duplicates',async()=>{
 const store=createMemoryRequestIdStore();const id=createRequestId(),day=requestUtcDay();
 assert.deepEqual(await Promise.all(Array.from({length:10},()=>store.reserve(day,id))),[true,...Array(9).fill(false)]);
 assert.equal(store.size(),1);await assert.rejects(()=>store.reserve('1980-01-01',id));
});
test('collector reserves and echoes ID; replay responds 409 without invoking tags',async()=>{
 const store=createMemoryRequestIdStore();const recorded=[];const collector=createAnalyticsCollector({analytics:{track:async()=>undefined},allowedOrigins:['https://demo.test'],requestIdStore:store,requireRequestId:true,dispatch:async(ev,ctx)=>{recorded.push([ev.name,ctx]);}});
 const id=createRequestId();const request=()=>new Request('https://demo.test/_analytics/collect',{method:'POST',headers:{origin:'https://demo.test','content-type':'application/json'},body:JSON.stringify({name:'page_view',requestId:id,properties:{page:'home'}})});
 const a=await collector.handler(request());assert.equal(a.status,204);assert.equal(a.headers.get('x-zerux-request-id'),id);assert.equal(a.headers.get('x-zerux-request-day'),requestUtcDay());
 const b=await collector.handler(request());assert.equal(b.status,409);assert.equal(recorded.length,1);
 const missing=await collector.handler(new Request('https://demo.test/_analytics/collect',{method:'POST',headers:{origin:'https://demo.test','content-type':'application/json'},body:JSON.stringify({name:'page_view'})}));assert.equal(missing.status,422);
});
test('primary-key DB request reservations and durable CAS documents',async()=>{
 const rows=new Map(),requestIds=new Set();
 const conn={createTable:async()=>({ok:true}),insert:async({table,values})=>{
   if(table==='req'){if(requestIds.has(values.id))return {ok:false,error:{code:'23505'}};requestIds.add(values.id);return {ok:true};}
   if(rows.has(values.id))return {ok:false,error:{code:'23505'}};
   rows.set(values.id,{...values});return {ok:true};
 },select:async({where})=>({ok:true,rows:rows.has(where.value)?[rows.get(where.value)]:[]}),
 update:async({values,where})=>{const [id,version]=where.and;const row=rows.get(id.value);if(!row||row.version!==version.value)return {ok:true,affectedCount:0};rows.set(id.value,{...row,...values});return {ok:true,affectedCount:1};}};
 const reserve=createDatabaseRequestIdStore(conn,'req');const id=createRequestId();assert.equal(await reserve.reserve(requestUtcDay(),id),true);assert.equal(await reserve.reserve(requestUtcDay(),id),false);
 const store=createDatabaseDocumentStore(conn,'docs','example',{version:1,value:7});assert.deepEqual(await store.load(),{version:1,value:7});
 assert.equal(await store.save({version:2,value:8},1),true);assert.equal(await store.save({version:2,value:9},1),false);assert.equal((await store.load()).value,8);
});
