import {test} from 'node:test';
import assert from 'node:assert/strict';
import {queryChart,createReports,createMemoryReportsStore} from '../dist/index.js';
const chart={id:'count',title:'All events',type:'kpi',metric:'count',groupBy:'event',limit:1};
const doc={version:1,reports:[{id:'r',name:'R',pages:[{id:'p',name:'P',charts:[chart]}]}]};
test('reports use exact database totals even when group display is bounded',async()=>{
  let called=false;
  const src={events:async()=>{throw new Error('Should never perform 500-row sample')},async aggregate(query){called=true;assert.equal(query.groupBy,'event');return {groups:[{category:'page_view',value:777}],total:2500,truncated:true,mode:'database',groupBy:'event'}}};
  const out=await queryChart(src,chart);
  assert.equal(called,true);assert.equal(out.total,2500);assert.equal(out.queryMode,'database');assert.equal(out.sampledRows,0);assert.equal(out.truncated,true);
});
test('non-count metrics retain sampled provenance and do not call SQL COUNT path',async()=>{
  const src={events:async()=>[{event_name:'order',properties_json:'{"cost":12}',occurred_at:Date.now(),site:'a'}],aggregate:async()=>{throw new Error('Never count sums')}};
  const out=await queryChart(src,{...chart,metric:'sum',valueField:'cost',limit:500});
  assert.equal(out.queryMode,'sampled');assert.equal(out.total,12);
});
test('host-enforced site overrides a malicious cross-site report filter on both query paths',async()=>{
  const queries=[];
  const src={events:async query=>{queries.push(query);return []},aggregate:async query=>{queries.push(query);return {groups:[],total:0,truncated:false,mode:'database',groupBy:'event'}}};
  const reports=createReports({analytics:src,store:createMemoryReportsStore(doc),site:'tenant-safe',authorize:()=>true});
  await reports.query('r','p','count');assert.equal(queries[0].site,'tenant-safe');
  const raw={...chart,metric:'sum',site:'tenant-danger',valueField:'cost'};
  await queryChart(src,raw,500,'tenant-safe');assert.equal(queries[1].site,'tenant-safe');
});
test('database failures propagate to 503 (no fake zero result)',async()=>{
  const src={events:async()=>[],aggregate:async()=>{throw new Error('Storage down')}};
  const routes=new Map(createReports({analytics:src,store:createMemoryReportsStore(doc),authorize:()=>true}).routes().map(route=>[route.pattern,route.handler]));
  const res=await routes.get('/_reports/query')(new Request('https://site.example/_reports/query?report=r&page=p&chart=count'));
  assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'Report query unavailable'});
});
test('numeric report selects opt-in materialized path and exposes coverage metadata',async()=>{
  const src={events:async()=>{throw Error('Should not sample')},async aggregateNumeric(q){assert.equal(q.site,'tenant-safe');assert.equal(q.valueField,'cost');return {groups:[{category:'purchase',value:1200}],total:1200,matchedFacts:500,truncated:false,mode:'materialized',coverage:'indexed-only',groupBy:'event',metric:'sum',valueField:'cost'}}};
  const out=await queryChart(src,{...chart,metric:'sum',valueField:'cost'},500,'tenant-safe');
  assert.equal(out.queryMode,'materialized');assert.equal(out.total,1200);assert.equal(out.matchedFacts,500);
  assert.equal(out.numericCoverage,'indexed-only');assert.equal(out.sampledRows,0);
});

test('non-enabled numeric materialization preserves bounded legacy report mode',async()=>{
 const src={events:async()=>[{event_name:'purchase',properties_json:'{"cost":3}',occurred_at:Date.now()}],supportsNumericField:()=>false,aggregateNumeric:async()=>{throw Error('Not configured')}};
 const chartData=await queryChart(src,{...chart,metric:'sum',valueField:'cost'});
 assert.equal(chartData.queryMode,'sampled');assert.equal(chartData.total,3);
});
