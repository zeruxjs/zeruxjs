// Integration using the native Node SQLite driver, not mocked SQL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createAnalytics} from '../../packages/@zeruxjs/analytics/dist/index.js';
import {queryChart} from '../../packages/@zeruxjs/reports/dist/index.js';
const context={connection:{slug:'reporting',connector:'sqlite',options:{},name:'Reporting'}};
test('native SQLite indexes 1201 numeric events, aggregates and isolates sites',async()=>{
 const driver=await createConnector({filename:':memory:',driver:'node'},context.connection);
 const adapter={createTable:op=>driver.execute({...op,op:'createTable'},context),insert:op=>driver.execute({...op,op:'insert'},context),select:op=>driver.execute({...op,op:'select'},context),createIndex:op=>driver.execute({...op,op:'createIndex'},context)};
 const db={connectionSlugs:['reporting'],getConnectionFacade:()=>adapter};
 const analytics=createAnalytics({analytics:'reporting',database:db,numericFields:['revenue'],onWarning:()=>{}});
 try{
  assert.equal(await analytics.initialize(),true);
  assert.equal(analytics.status().numericReady,true);
  const now=Date.now();
  // Legacy/nonindexed historical data must not be silently counted as numeric facts.
  assert.equal((await adapter.insert({table:'analytics_events',values:{id:'legacy',event_name:'purchase',source:'server',site:'a',pathname:'',session_id:'',occurred_at:now,properties_json:'{"revenue":99999}'}})).ok,true);
  for(let i=0;i<1201;i++){
   const value=i%2?2.5:-1;
   assert.ok(await analytics.track({name:'purchase',site:i%2?'b':'a',source:'web',properties:{revenue:value},occurredAt:now}));
  }
  const all=await analytics.aggregateNumeric({groupBy:'site',metric:'sum',valueField:'revenue'});
  assert.equal(all.total,600*2.5-601);assert.equal(all.matchedFacts,1201);
  assert.deepEqual(all.groups,[{category:'b',value:1500},{category:'a',value:-601}]);
  assert.equal((await analytics.aggregate({groupBy:'event'})).total,1202);
  assert.equal((await analytics.aggregateNumeric({groupBy:'site',metric:'min',valueField:'revenue'})).total,-1);
  assert.equal((await analytics.aggregateNumeric({groupBy:'site',metric:'max',valueField:'revenue'})).total,2.5);
  const avg=await analytics.aggregateNumeric({groupBy:'event',metric:'average',valueField:'revenue',site:'b'});
  assert.equal(avg.total,2.5);assert.equal(avg.matchedFacts,600);
  const chart=await queryChart(analytics,{id:'chart',title:'Revenue',metric:'sum',valueField:'revenue',type:'bar',groupBy:'site',limit:1});
  assert.equal(chart.queryMode,'materialized');assert.equal(chart.numericCoverage,'indexed-only');
  assert.equal(chart.total,899);assert.equal(chart.truncated,true);
  const native=driver.getNativeConnection();
  assert.equal(native.prepare("SELECT COUNT(*) AS n FROM analytics_events_numeric").all()[0].n,1201);
 }finally{await driver.disconnect?.();}
});
