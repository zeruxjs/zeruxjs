import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDatabaseCampaignPerformanceReporter,createDatabaseProviderOutcomeLedger} from '../dist/index.js';

function db(){
 const tables=new Map();let down=false;
 const filter=(row,w)=>!w||w.and?w?.and?.every(part=>filter(row,part))??true:row[w.field]===w.value;
 return {tables,setDown(v){down=v},
  async createTable({table}){if(!tables.has(table))tables.set(table,new Map());return {ok:true}},
  async createIndex(){return {ok:true}},
  async insert({table,values}){if(down)throw Error('offline');const rows=tables.get(table);if(rows.has(values.id))throw Error('duplicate');rows.set(values.id,{...values});return {ok:true}},
  async select({table,where,groupBy,columns,limit}){if(down)throw Error('offline');if(!tables.has(table))throw Error('missing table');let rows=[...tables.get(table).values()].filter(r=>filter(r,where));
   if(groupBy){const key=groupBy[0];const groups=new Map();for(const row of rows)groups.set(row[key],(groups.get(row[key])||0)+1);rows=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([category,event_count])=>({category,event_count}));}
   return {ok:true,rows:rows.slice(0,limit??rows.length)};
  },async update(){throw Error('not needed')}
 };
}
const event=(i,kind='delivered',campaignId='fall')=>({provider:'mailprovider',eventId:`evt-${i}`,campaignId,messageId:`mail-${i}`,kind,occurredAt:1000+i});
test('native campaign states count over 100,000 records without reading payloads',async()=>{
 const database=db();await database.createTable({table:'zerux_email_delivery'});
 const table=database.tables.get('zerux_email_delivery');
 for(let i=0;i<100_123;i++)table.set(`mail-${i}`,{id:`mail-${i}`,campaign_id:i%2?'fall':'other',state:i%3?'sent':'uncertain'});
 const report=await createDatabaseCampaignPerformanceReporter({db:database})('fall');
 assert.equal(report.total,50_061);assert.equal(report.counts.sent+report.counts.uncertain,report.total);
 assert.equal(report.mode,'database');assert.equal(report.dailyCoverage,'not-computed');assert.equal(report.activityCoverage,'not-computed');
 assert.equal(report.provider,null);assert.equal('days' in report,false);
});
test('provider outcomes dedupe replay, reject conflicts, and scope counts per campaign',async()=>{
 const database=db(),ledger=createDatabaseProviderOutcomeLedger(database);
 assert.equal(await ledger.record(event(1)),true);
 assert.equal(await ledger.record(event(1)),false);
 await assert.rejects(ledger.record({...event(1),kind:'complaint'}),/Conflicting/);
 assert.equal(await ledger.record(event(2,'hard-bounce')),true);
 assert.equal(await ledger.record(event(3,'complaint','other')),true);
 const total=await ledger.summarize('fall');
 assert.equal(total.events,2);assert.equal(total.counts.delivered,1);assert.equal(total.counts['hard-bounce'],1);
 const report=await createDatabaseCampaignPerformanceReporter({db:database,provider:ledger})('fall').catch(()=>null);
 assert.equal(report,null); // caller must initialize the delivery store first, never return false zeros
 await database.createTable({table:'zerux_email_delivery'});
 const actual=await createDatabaseCampaignPerformanceReporter({db:database,provider:ledger})('fall');
 assert.equal(actual.total,0);assert.equal(actual.provider.events,2);
 database.setDown(true);
 await assert.rejects(ledger.summarize('fall'),/offline/);
 await assert.rejects(createDatabaseCampaignPerformanceReporter({db:database})('fall'),/offline/);
});
test('invalid provider events and corrupt grouped counts are rejected',async()=>{
 const database=db(),ledger=createDatabaseProviderOutcomeLedger(database);
 await assert.rejects(ledger.record({...event(2),messageId:'evil@address'}),/Invalid/);
 await assert.rejects(ledger.record({...event(2),occurredAt:-1}),/Invalid/);
 await assert.rejects(ledger.summarize('../outside'),/Invalid/);
 await database.createTable({table:'zerux_email_delivery'});
 database.tables.get('zerux_email_delivery').set('bad',{id:'bad',campaign_id:'fall',state:'corrupt'});
 await assert.rejects(createDatabaseCampaignPerformanceReporter({db:database})('fall'),/Invalid/);
});
