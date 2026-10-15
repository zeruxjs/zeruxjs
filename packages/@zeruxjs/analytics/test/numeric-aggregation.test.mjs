import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalytics,aggregateNumericFacts} from '../dist/index.js';
const ts=Date.UTC(2026,9,11,23,59,59,999);
function fixture({failFacts=false}={}){
  const facts=[],events=[];
  const adapter={
    async createTable(){return {ok:true}},
    async insert({table,values}){
      if(table.endsWith('_numeric')){if(failFacts)return {ok:false};facts.push(...(Array.isArray(values)?values:[values]));}
      else events.push(values);
      return {ok:true};
    },
    async select({table,columns,where,groupBy,limit}){
      assert.ok(table.endsWith('_numeric'));
      const conditions=where?.and??(where?[where]:[]);
      const eligible=facts.filter(row=>conditions.every(p=>p.operator==='eq'?row[p.field]===p.value:p.operator==='gte'?row[p.field]>=p.value:row[p.field]<=p.value));
      const metrics=columns.filter(c=>typeof c==='object'&&c.expr?.kind==='function');
      const summary=rows=>{
        const m=metrics.find(c=>c.as==='metric_value').expr.name;
        const vs=rows.map(r=>r.numeric_value);
        return {metric_value:!vs.length?null:m==='SUM'?vs.reduce((a,b)=>a+b,0):m==='AVG'?vs.reduce((a,b)=>a+b,0)/vs.length:m==='MIN'?Math.min(...vs):Math.max(...vs),numeric_count:vs.length};
      };
      if(!groupBy)return {ok:true,rows:[summary(eligible)]};
      const groups=new Map();for(const row of eligible){const key=row[groupBy[0]];if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
      return {ok:true,rows:[...groups].map(([category,rows])=>({category,...summary(rows)})).sort((a,b)=>b.metric_value-a.metric_value||a.category.localeCompare(b.category)).slice(0,limit)};
    }
  };
  return {facts,events,adapter,analytics:createAnalytics({analytics:'a',database:{connectionSlugs:['a'],getConnectionFacade:()=>adapter},numericFields:['cost','quantity'],onWarning:()=>{}})};
}
test('materialized numeric sum, mean, minimum, maximum and site isolation',async()=>{
  const f=fixture();await f.analytics.initialize();
  for(let i=0;i<1205;i++){
    const props=i%2?{cost:-2,quantity:1}:{cost:3};
    assert.ok(await f.analytics.track({name:'purchase',site:i%2?'b':'a',occurredAt:ts,properties:props}));
  }
  assert.equal(f.events.length,1205);
  assert.equal(f.facts.length,1205+602);
  const totals=await f.analytics.aggregateNumeric({groupBy:'site',metric:'sum',valueField:'cost'});
  assert.equal(totals.total,603*3-602*2);
  assert.deepEqual(totals.groups,[{category:'a',value:1809},{category:'b',value:-1204}]);
  assert.equal(totals.matchedFacts,1205);
  assert.equal(totals.coverage,'indexed-only');
  const avg=await f.analytics.aggregateNumeric({groupBy:'event',metric:'average',valueField:'cost',site:'b'});
  assert.equal(avg.total,-2);assert.equal(avg.matchedFacts,602);
  const min=await f.analytics.aggregateNumeric({groupBy:'event',metric:'min',valueField:'cost'});
  assert.equal(min.total,-2);
  const max=await f.analytics.aggregateNumeric({groupBy:'event',metric:'max',valueField:'cost'});
  assert.equal(max.total,3);
  await assert.rejects(f.analytics.aggregateNumeric({groupBy:'site',metric:'sum',valueField:'unknown'}),/not configured/);
  const limited=await f.analytics.aggregateNumeric({groupBy:'site',metric:'sum',valueField:'cost',limit:1});
  assert.equal(limited.truncated,true);assert.equal(limited.total,605);
});
test('UTC-day materialized metrics validate ranges and produce empty day buckets',async()=>{
  const f=fixture();await f.analytics.initialize();
  await f.analytics.track({name:'purchase',properties:{cost:5},occurredAt:ts});
  await f.analytics.track({name:'purchase',properties:{cost:-2},occurredAt:ts+1});
  const result=await f.analytics.aggregateNumeric({groupBy:'day',metric:'sum',valueField:'cost',since:ts,until:ts+86400000});
  assert.deepEqual(result.groups,[{category:'2026-10-11',value:5},{category:'2026-10-12',value:-2}]);
  await assert.rejects(f.analytics.aggregateNumeric({groupBy:'day',metric:'sum',valueField:'cost'}),/requires explicit/);
  await assert.rejects(f.analytics.aggregateNumeric({groupBy:'event',metric:'sum',valueField:'cost',site:'bad\n'}),/Invalid site/);
});
test('failed numeric writes do not stop event tracking but are exposed in status',async()=>{
  const f=fixture({failFacts:true});await f.analytics.initialize();
  assert.ok(await f.analytics.track({name:'purchase',properties:{cost:22}}));
  assert.equal(f.analytics.status().recorded,1);assert.equal(f.analytics.status().numericDropped,1);
  assert.equal(f.analytics.status().numericIndexed,0);
});
test('invalid aggregation or malformed connector results reject instead of false totals',async()=>{
  const conn={select:async()=>({ok:true,rows:[{metric_value:Infinity,numeric_count:2}]})};
  await assert.rejects(aggregateNumericFacts(conn,'facts',{groupBy:'event',metric:'sum',valueField:'cost'}),/Invalid numeric aggregate/);
  await assert.rejects(aggregateNumericFacts(conn,'facts',{groupBy:'event',metric:'sum',valueField:'__proto__'}),/Invalid numeric metric/);
  await assert.rejects(aggregateNumericFacts({select:async()=>({ok:false})},'facts',{groupBy:'event',metric:'sum',valueField:'cost'}),/unavailable/);
});
