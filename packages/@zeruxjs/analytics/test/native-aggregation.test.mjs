import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalytics,aggregateEventCounts} from '../dist/index.js';

const at=Date.UTC(2026,9,11,23,59,59,999);
function database(){
  const records=[];let fail=false;
  const conn={
    async createTable(){return {ok:true}},
    async insert({values}){records.push(values);return {ok:true}},
    async select(op){
      if(fail)return {ok:false,error:{code:'OFFLINE'}};
      if(op.columns?.some(c=>typeof c==='object'&&c.as==='event_count')){
        const filters=op.where?.and??(op.where?[op.where]:[]);
        const rows=records.filter(row=>filters.every(f=>f.operator==='eq'?row[f.field]===f.value:f.operator==='gte'?row[f.field]>=f.value:row[f.field]<=f.value));
        const counter=op.columns[op.columns.length-1];
        assert.equal(counter.expr.kind,'function');assert.equal(counter.expr.name,'COUNT');
        if(!op.groupBy)return {ok:true,rows:[{event_count:rows.length}]};
        const field=op.groupBy[0],totals=new Map();
        for(const row of rows)totals.set(row[field],(totals.get(row[field])??0)+1);
        return {ok:true,rows:[...totals].map(([category,event_count])=>({category,event_count})).sort((a,b)=>b.event_count-a.event_count||a.category.localeCompare(b.category)).slice(0,op.limit)};
      }
      return {ok:true,rows:[]};
    }
  };
  const manager={connectionSlugs:['reporting'],getConnectionFacade(){return conn}};
  return {records,conn,manager,setOffline(value){fail=value}};
}
test('exact grouping reads all 1200+ events instead of stopping at 500',async()=>{
  const db=database(),analytics=createAnalytics({analytics:'reporting',database:db.manager,onWarning:()=>{}});
  await analytics.initialize();
  // load independently to avoid spending time generating thousands of UUIDs
  for(let i=0;i<1203;i++)db.records.push({id:String(i),event_name:i%3===0?'purchase':'view',source:'web',site:i%2?'site-b':'site-a',pathname:'/',occurred_at:at,properties_json:'{}'});
  const all=await analytics.aggregate({groupBy:'event'});
  assert.equal(all.total,1203);assert.deepEqual(all.groups,[{category:'view',value:802},{category:'purchase',value:401}]);
  assert.equal(all.mode,'database');assert.equal(all.truncated,false);
  const narrow=await analytics.aggregate({groupBy:'event',name:'purchase',site:'site-a'});
  assert.equal(narrow.total,201);assert.deepEqual(narrow.groups,[{category:'purchase',value:201}]);
  const limit=await analytics.aggregate({groupBy:'event',limit:1});
  assert.equal(limit.total,1203);assert.equal(limit.truncated,true);assert.equal(limit.groups.length,1);
});
test('exact UTC day intervals handle midnight and inclusive millisecond boundaries',async()=>{
  const db=database();
  db.records.push(...[at,at+1,at+2,at+86400000].map((stamp,i)=>({id:String(i),event_name:'view',source:'web',site:'app',pathname:'/',occurred_at:stamp,properties_json:'{}'})));
  const result=await aggregateEventCounts(db.conn,'analytics_events',{groupBy:'day',since:at,until:at+2});
  assert.equal(result.total,3);assert.deepEqual(result.groups,[{category:'2026-10-11',value:1},{category:'2026-10-12',value:2}]);
  assert.equal(result.truncated,false);
});
test('offline native aggregation rejects rather than reporting fabricated zero counts',async()=>{
  const db=database(),a=createAnalytics({analytics:'reporting',database:db.manager});db.setOffline(true);
  await assert.rejects(a.aggregate({groupBy:'event'}),/unavailable/);
});
test('rejects invalid group dimensions, time ranges, unsafe filters and nonnumeric counts',async()=>{
  const db=database();
  for(const q of [{groupBy:'__proto__'},{groupBy:'event',site:'test\nX'},{groupBy:'event',since:4,until:3},{groupBy:'day',since:at},{groupBy:'day',since:0,until:Date.UTC(2026,9,12)},{groupBy:'event',limit:501}]){
    await assert.rejects(aggregateEventCounts(db.conn,'analytics_events',q));
  }
  const broken={select:async()=>({ok:true,rows:[{event_count:'bad'}]})};
  await assert.rejects(aggregateEventCounts(broken,'analytics_events',{groupBy:'event'}),/Invalid analytics count/);
});
