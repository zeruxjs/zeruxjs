import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createAnalytics} from '../../packages/@zeruxjs/analytics/dist/index.js';
const context={connection:{slug:'reporting',connector:'sqlite',options:{},name:'Reporting'}};

test('SQLite historical backfill over 600 events: stable keyset pages, unique facts, resumable reruns',async()=>{
 const driver=await createConnector({filename:':memory:',driver:'node'},context.connection);
 const adapter={
  createTable:op=>driver.execute({...op,op:'createTable'},context),
  insert:op=>driver.execute({...op,op:'insert'},context),
  select:op=>driver.execute({...op,op:'select'},context),
  createIndex:op=>driver.execute({...op,op:'createIndex'},context)
 };
 const manager=createAnalytics({analytics:'reporting',numericFields:['revenue','quantity'],database:{connectionSlugs:['reporting'],getConnectionFacade:()=>adapter},onWarning:()=>{}});
 try{
  assert.equal(await manager.initialize(),true);
  assert.equal(manager.status().numericUniqueIndexReady,true);
  const now=Date.UTC(2020,0,1);
  for(let i=0;i<623;i++){
   const result=await adapter.insert({table:'analytics_events',values:{
    id:`e${String(i).padStart(35,'0')}`,event_name:'purchase',source:'server',site:i%2?'secondary':'main',pathname:'/purchase',session_id:'',occurred_at:now,
    properties_json:JSON.stringify({revenue:i%2?2.5:1,quantity:i%2?null:2})
   }});
   assert.equal(result.ok,true);
  }
  let cursor,created=0,scanned=0,cycles=0;
  do{
   const batch=await manager.reconcileNumeric({since:now,until:now,batchSize:79,...(cursor?{cursor}:{})});
   scanned+=batch.scanned;created+=batch.created;cycles++;
   cursor=batch.nextCursor;
   if(!batch.hasMore)break;
  }while(cycles<20);
  assert.equal(scanned,623);assert.equal(created,623+312);
  assert.equal((await manager.aggregateNumeric({groupBy:'event',metric:'sum',valueField:'revenue'})).total,311*2.5+312);
  // Replaying a prior page must not generate additional facts.
  const repeated=await manager.reconcileNumeric({since:now,until:now,batchSize:100});
  assert.equal(repeated.created,0);assert.equal(repeated.existing,100+50);
  const native=driver.getNativeConnection();
  assert.equal(native.prepare('SELECT COUNT(*) AS n FROM analytics_events_numeric').get().n,935);
  const fact=native.prepare('SELECT event_id, property_name, numeric_value FROM analytics_events_numeric LIMIT 1').get();
  assert.throws(()=>native.prepare('INSERT INTO analytics_events_numeric(id,event_id,property_name,numeric_value,event_name,source,site,pathname,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)').run('different_id',fact.event_id,fact.property_name,5,'purchase','server','main','/',now),/UNIQUE/);
  // Deliberate missing projection is correctly restored on the next pass.
  const removed=native.prepare('SELECT id FROM analytics_events_numeric LIMIT 1').get().id;
  native.prepare('DELETE FROM analytics_events_numeric WHERE id=?').run(removed);
  const repaired=await manager.reconcileNumeric({since:now,until:now,batchSize:200});
  assert.equal(repaired.created,1);
  assert.equal(native.prepare('SELECT COUNT(*) AS n FROM analytics_events_numeric').get().n,935);
 }finally{await driver.disconnect?.();}
});
