import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalytics} from '../dist/index.js';

function fixture({uniqueIndex=true}={}){
 const events=[],facts=[];let failInsert=false;
 const conditions=(where)=>(where?.and??(where?[where]:[]));
 const eligible=(record,where)=>conditions(where).every(c=>c.operator==='eq'?record[c.field]===c.value:c.operator==='gte'?record[c.field]>=c.value:c.operator==='lte'?record[c.field]<=c.value:record[c.field]>c.value);
 const adapter={
  createTable:async()=>({ok:true}),
  createIndex:async(op)=>({ok:!op.unique||uniqueIndex}),
  insert:async({table,values})=>{
   const target=table.endsWith('_numeric')?facts:events;
   for(const row of (Array.isArray(values)?values:[values])){
    if(table.endsWith('_numeric')&&(failInsert||facts.some(f=>f.id===row.id||f.event_id===row.event_id&&f.property_name===row.property_name)))return {ok:false,error:{code:'DUPLICATE_OR_DOWN'}};
    target.push(row);
   }
   return {ok:true};
  },
  select:async({table,where,orderBy,limit,columns})=>{
   const target=table.endsWith('_numeric')?facts:events;
   const rows=target.filter(r=>eligible(r,where)).sort((a,b)=>orderBy?.[0]?.by==='id'?a.id.localeCompare(b.id):0).slice(0,limit??Infinity);
   return {ok:true,rows:rows.map(r=>Object.fromEntries((columns??Object.keys(r)).map(k=>[k,r[k]])))};
  }
 };
 const analytics=createAnalytics({analytics:'db',numericFields:['revenue','quantity'],database:{connectionSlugs:['db'],getConnectionFacade:()=>adapter},onWarning:()=>{}});
 return {events,facts,adapter,analytics,setFailure:v=>{failInsert=v;}};
}
const at=Date.UTC(2022,3,10);
test('bounded keyset backfill resumes, repairs gaps, remains idempotent',async()=>{
 const f=fixture();assert.equal(await f.analytics.initialize(),true);
 for(let i=0;i<251;i++)f.events.push({id:`evt_${String(i).padStart(5,'0')}`,event_name:'purchase',source:'server',site:'store',pathname:'/',occurred_at:at,properties_json:JSON.stringify({revenue:i,quantity:2})});
 let cursor;let pages=0,created=0;
 do{
  const page=await f.analytics.reconcileNumeric({since:at,until:at,site:'store',batchSize:80,...(cursor?{cursor}:{})});
  pages++;created+=page.created;cursor=page.nextCursor;
  assert.equal(page.invalidRows,0);
  if(!page.hasMore)break;
 }while(pages<10);
 assert.equal(pages,4);assert.equal(created,502);assert.equal(f.facts.length,502);
 const repeated=await f.analytics.reconcileNumeric({since:at,until:at,batchSize:200});
 assert.equal(repeated.created,0);assert.equal(repeated.existing,400);
 // Simulate partially missing stored projection and replay.
 f.facts.splice(0,1);
 const repaired=await f.analytics.reconcileNumeric({since:at,until:at,batchSize:200});
 assert.equal(repaired.created,1);
 assert.equal(f.facts.length,502);
});
test('legacy positional fact is reused and a new stable fact ID cannot collide after field reordering',async()=>{
 const f=fixture();await f.analytics.initialize();
 const row={id:'old',event_name:'buy',source:'web',site:'s',pathname:'/',occurred_at:at,properties_json:'{"revenue":8,"quantity":3}'};
 f.events.push(row);
 f.facts.push({id:'old_0',event_id:'old',property_name:'revenue',numeric_value:8,event_name:'buy',source:'web',site:'s',pathname:'/',occurred_at:at});
 const result=await f.analytics.reconcileNumeric({since:at,until:at});
 assert.equal(result.existing,1);assert.equal(result.created,1);
 assert.equal(f.facts.length,2);
 assert.notEqual(f.facts.at(-1).id,'old_1');
});
test('reconciliation reports storage failure instead of silent success and retry is safe',async()=>{
 const f=fixture();await f.analytics.initialize();
 f.events.push({id:'retry',event_name:'buy',source:'web',site:'s',pathname:'/',occurred_at:at,properties_json:'{"revenue":8}'});
 f.setFailure(true);
 await assert.rejects(f.analytics.reconcileNumeric({since:at,until:at}),/insert failed/);
 f.setFailure(false);
 assert.equal((await f.analytics.reconcileNumeric({since:at,until:at})).created,1);
});
test('malformed historic properties are explicitly counted and range, cursor, site validated',async()=>{
 const f=fixture();await f.analytics.initialize();
 f.events.push({id:'broken',event_name:'buy',source:'server',site:'s',pathname:'/',occurred_at:at,properties_json:'{oops'});
 const result=await f.analytics.reconcileNumeric({since:at,until:at});
 assert.equal(result.invalidRows,1);assert.equal(result.expectedFacts,0);
 await assert.rejects(f.analytics.reconcileNumeric({since:at,until:at-1}),/valid closed/);
 await assert.rejects(f.analytics.reconcileNumeric({since:at,until:at,batchSize:201}),/batch size/);
 await assert.rejects(f.analytics.reconcileNumeric({since:at,until:at,cursor:'bad\n'}),/cursor/);
});
test('backfill refuses to run without database-enforced unique event/property index',async()=>{
 const f=fixture({uniqueIndex:false});await f.analytics.initialize();
 assert.equal(f.analytics.status().numericUniqueIndexReady,false);
 await assert.rejects(f.analytics.reconcileNumeric({since:at,until:at}),/verified unique/);
});
test('externally managed unique index can be explicitly asserted for migration-managed schemas',async()=>{
 const f=fixture();
 const m=createAnalytics({analytics:'db',numericFields:['revenue'],indexes:false,numericUniqueIndexManagedExternally:true,
  database:{connectionSlugs:['db'],getConnectionFacade:()=>f.adapter},onWarning:()=>{}});
 await m.initialize();
 assert.equal(m.status().numericUniqueIndexReady,true);
});
