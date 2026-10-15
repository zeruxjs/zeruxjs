import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDatabaseCampaignTrendsReporter} from '../dist/index.js';
const stamp=day=>Date.parse(day+'T00:00:00Z');
function fakeDb(){
 const tables=new Map([['zerux_email_delivery',[]],['zerux_email_provider_outcomes',[]]]);
 let offline=false,queries=0,payloadRead=false;
 const matches=(r,w)=>w.and?w.and.every(x=>matches(r,x)):(w.operator==='eq'?r[w.field]===w.value:w.operator==='gte'?r[w.field]>=w.value:w.operator==='lt'?r[w.field]<w.value:false);
 return {tables,setOffline(v){offline=v},get queries(){return queries},get payloadRead(){return payloadRead},
  async select({table,where,groupBy,columns,limit}){
   if(offline)throw Error('database is offline');queries++;
   if(columns.some(c=>c==='payload_json'))payloadRead=true;
   if(!tables.has(table))throw Error('missing source table');
   const groups=new Map();
   for(const row of tables.get(table))if(matches(row,where))groups.set(row[groupBy[0]],(groups.get(row[groupBy[0]])??0)+1);
   return {ok:true,rows:[...groups].sort((a,b)=>a[0].localeCompare(b[0])).slice(0,limit).map(([category,event_count])=>({category,event_count}))};
  }};
}
const add=(db,day,number,campaign='fall',state='sent')=>{for(let i=0;i<number;i++)db.tables.get('zerux_email_delivery').push({id:`${campaign}_${day}_${i}`,campaign_id:campaign,state,updated_at:stamp(day)+i})};
const outcome=(db,day,campaign='fall',kind='delivered')=>db.tables.get('zerux_email_provider_outcomes').push({id:`${campaign}_${day}_${kind}`,campaign_id:campaign,kind,occurred_at:stamp(day)+1});
test('database-native daily counts avoid capped row scans, isolate campaigns and count notifications separately',async()=>{
 const db=fakeDb();add(db,'2026-10-11',110_013);add(db,'2026-10-12',1023);add(db,'2026-10-12',77,'another');
 outcome(db,'2026-10-11');outcome(db,'2026-10-11','another');outcome(db,'2026-10-12','fall','complaint');
 const report=await createDatabaseCampaignTrendsReporter({db,providerTable:'zerux_email_provider_outcomes'})('fall','2026-10-11','2026-10-13');
 assert.equal(report.total,111036);assert.equal(report.providerEvents,2);
 assert.deepEqual(report.days.map(x=>x.total),[110013,1023,0]);
 assert.deepEqual(report.days.map(x=>x.providerEvents),[1,1,0]);
 assert.equal(report.deliveryCoverage,'last-state-update-day');assert.equal(report.providerCoverage,'reported-events-only');
 assert.equal(report.snapshotConsistent,false);assert.equal(db.queries,6);assert.equal(db.payloadRead,false);
 const encoded=JSON.stringify(report);assert.ok(!encoded.includes('id:'));
});
test('range validation rejects invalid dates and unbounded requests',async()=>{
 const trends=createDatabaseCampaignTrendsReporter({db:fakeDb()});
 await assert.rejects(trends('fall','2026-02-29','2026-03-01'),/Invalid/);
 await assert.rejects(trends('fall','2026-03-01','2026-02-28'),/range|window/);
 await assert.rejects(trends('fall','2026-01-01','2026-10-01'),/window/);
 await assert.rejects(trends('../oops','2026-10-01','2026-10-02'),/Invalid/);
 await assert.rejects(trends('fall','2026-10-1','2026-10-02'),/Invalid/);
 const r=await trends('fall','2026-10-01','2026-10-01');assert.equal(r.providerEvents,null);assert.equal(r.days[0].provider,null);
});
test('unavailable storage and corrupt grouping fail rather than inventing zero',async()=>{
 const db=fakeDb();db.setOffline(true);
 await assert.rejects(createDatabaseCampaignTrendsReporter({db})('fall','2026-10-01','2026-10-02'),/offline/);
 const corrupt={select:async()=>({ok:true,rows:[{category:'unrecognized',event_count:2}]})};
 await assert.rejects(createDatabaseCampaignTrendsReporter({db:corrupt})('fall','2026-10-01','2026-10-01'),/category/);
 const overflow={select:async()=>({ok:true,rows:[{category:'sent',event_count:'9007199254740999'}]})};
 await assert.rejects(createDatabaseCampaignTrendsReporter({db:overflow})('fall','2026-10-01','2026-10-01'),/count/);
});
