// Cross-package integration: execute with the built @zeruxjs/db and
// @zeruxjs/db-sql-core + @zeruxjs/db-sqlite packages (not part of unit-only test).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createAnalytics} from '../../packages/@zeruxjs/analytics/dist/index.js';
const context={connection:{slug:'analytics',connector:'sqlite',options:{},name:'Analytics'}};
test('real SQLite counts >500 persisted events and UTC day totals without raw-row scans',async()=>{
 const driver=await createConnector({filename:':memory:',driver:'node'},context.connection);
 const adapter={createTable:op=>driver.execute({...op,op:'createTable'},context),insert:op=>driver.execute({...op,op:'insert'},context),select:op=>driver.execute({...op,op:'select'},context),createIndex:op=>driver.execute({...op,op:'createIndex'},context)};
 const analytics=createAnalytics({analytics:'analytics',database:{connectionSlugs:['analytics'],getConnectionFacade:()=>adapter},onWarning:()=>{}});
 try{
  assert.equal(await analytics.initialize(),true);
  assert.equal(analytics.status().indexesReady,true);
  const db=driver.getNativeConnection();assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'analytics_events_%'").all()[0].n,4); // Unique event-ID index added in Section 71
  const when=Date.now();
  for(let i=0;i<1101;i++)assert.ok(await analytics.track({name:i%2?'visit':'purchase',source:'web',site:i%2?'siteA':'siteB',occurredAt:when}));
  const counts=await analytics.aggregate({groupBy:'event'});
  assert.equal(counts.total,1101);assert.deepEqual(counts.groups,[{category:'purchase',value:551},{category:'visit',value:550}]);
  const site=await analytics.aggregate({groupBy:'event',site:'siteA'});
  assert.equal(site.total,550);assert.equal(site.groups[0].category,'visit');
  const daily=await analytics.aggregate({groupBy:'day',since:when-1000,until:when+1000});
  assert.equal(daily.total,1101);assert.equal(daily.groups.reduce((n,g)=>n+g.value,0),1101);
 }finally{await driver.disconnect?.();}
});
