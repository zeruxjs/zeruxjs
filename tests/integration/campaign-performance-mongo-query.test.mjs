import {test} from 'node:test';import assert from 'node:assert/strict';
import {createConnector} from '@zeruxjs/db-mongo';
import {createDatabaseCampaignPerformanceReporter} from '../../packages/@zeruxjs/queue/dist/index.js';
const context={connection:{slug:'mongo',connector:'mongo',options:{},name:'Mongo'}};
test('Mongo connector compiles native campaign state grouping (mock, not live MongoDB)',async()=>{
 const pipelines=[];
 const db={collection:()=>({aggregate(pipeline){pipelines.push(pipeline);return {toArray:async()=>[{category:'sent',event_count:650},{category:'uncertain',event_count:3}]};}})};
 const connector=await createConnector({db},context.connection);
 const facade={createTable:async()=>({ok:true}),insert:async()=>({ok:true}),update:async()=>({ok:true}),select:op=>connector.execute({...op,op:'select'},context)};
 const summary=await createDatabaseCampaignPerformanceReporter({db:facade})('campaign58');
 assert.equal(summary.total,653);assert.equal(summary.counts.sent,650);assert.equal(summary.counts.uncertain,3);
 assert.deepEqual(pipelines[0][0],{$match:{campaign_id:'campaign58'}});
 assert.deepEqual(pipelines[0][1],{$group:{_id:'$state',event_count:{$sum:1}}});
});
