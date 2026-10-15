import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDatabaseEmailDeliveryStore,createCampaignDeliveryReporter,createDurableEmailDeliveryProcessor} from '../dist/index.js';

function database(){
 const rows=new Map();let down=false;
 const conditions=(row,where)=>!where||(where.and?where.and.every(c=>conditions(row,c)):({eq:row[where.field]===where.value,gt:row[where.field]>where.value})[where.operator]);
 return {rows,setDown(value){down=value;},
  async createTable(){return {ok:true};},async createIndex(){return {ok:true};},
  async insert({values}){if(rows.has(values.id))throw Error('duplicate');rows.set(values.id,{...values});return {ok:true};},
  async select({where,orderBy,limit=500}){if(down)throw Error('database unavailable');let list=[...rows.values()].filter(row=>conditions(row,where));if(orderBy)list.sort((a,b)=>String(a.id).localeCompare(String(b.id)));return {ok:true,rows:list.slice(0,limit)};},
  async update({where,values}){if(down)throw Error('database unavailable');let n=0;for(const [id,row] of rows)if(conditions(row,where)){rows.set(id,{...row,...values});n++;}return {ok:true,affectedCount:n};}
 };
}
const delivery=(i,state='pending',campaignId='campaignA')=>({id:`message${String(i).padStart(5,'0')}`,version:1,purpose:'marketing',campaignId,recipient:'hidden@example.test',state,lease:null,updatedAt:1000+i});

test('database delivery records use atomic CAS and support durable delivery worker',async()=>{
 const db=database(),a=createDatabaseEmailDeliveryStore(db),b=createDatabaseEmailDeliveryStore(db);
 assert.equal(await a.create(delivery(1)),true);
 assert.equal(await b.create(delivery(1)),false);
 const first=await a.load('message00001');
 assert.equal(await a.save(first.id,{...first,version:2,state:'claimed'},1),true);
 assert.equal(await b.save(first.id,{...first,version:2,state:'sent'},1),false);
 await assert.rejects(a.save(first.id,{...first,version:3,campaignId:'campaignOther'},2),/routing identity/);
 const found=await b.load('message00001');assert.equal(found.state,'claimed');
 const processor=createDurableEmailDeliveryProcessor({store:a,isSubscribed:async()=>true,send:async()=>{},now:()=>2000});
 assert.deepEqual(await processor({name:'email.deliver',data:{messageId:'message00001'}}),{status:'sent'});
 assert.equal((await b.load('message00001')).state,'sent');
});

test('exact campaign counts beyond 500 rows, explicit incomplete scans, and date totals',async()=>{
 const db=database(),store=createDatabaseEmailDeliveryStore(db);
 for(let i=0;i<1103;i++)await store.create(delivery(i,i%7===0?'uncertain':i%4===0?'suppressed':'sent'));
 await store.create(delivery(99999,'sent','campaignOther'));
 const result=await createCampaignDeliveryReporter({source:store,pageSize:123,maxRecords:1103})('campaignA');
 assert.equal(result.scanned,1103);assert.equal(result.complete,true);assert.equal(result.counts.sent+result.counts.suppressed+result.counts.uncertain,1103);
 assert.ok(result.sentPercent>0);assert.equal(result.days.length,1);
 assert.equal(JSON.stringify(result).includes('hidden@example.test'),false);
 assert.equal(JSON.stringify(result).includes('message00001'),false);
 const partial=await createCampaignDeliveryReporter({source:store,pageSize:200,maxRecords:500})('campaignA');
 assert.equal(partial.scanned,500);assert.equal(partial.complete,false);assert.equal(partial.sentPercent,null);
 const other=await createCampaignDeliveryReporter({source:store})('campaignOther');assert.equal(other.scanned,1);assert.equal(other.counts.sent,1);
});

test('activity counts are coverage-labelled, optional, and never infer absent activity is zero engagement',async()=>{
 const db=database(),store=createDatabaseEmailDeliveryStore(db);
 await store.create(delivery(1,'sent'));await store.create(delivery(2,'sent'));
 const report=await createCampaignDeliveryReporter({source:store,activity:{get:async(id)=>id==='message00001'?{opens:3,clicks:2,downloadClicks:1,downloads:1,downloadedBytes:2500}:null}})('campaignA');
 assert.equal(report.activity.coverage,'available-summaries-only');assert.equal(report.activity.summariesAvailable,1);
 assert.equal(report.activity.uniqueOpens,1);assert.equal(report.activity.opens,3);
 assert.equal(report.activity.downloadedBytes,2500);
});

test('connector errors, corrupt index fields and out of scope rows fail closed',async()=>{
 const db=database(),store=createDatabaseEmailDeliveryStore(db);
 await store.create(delivery(1,'sent'));
 db.setDown(true);await assert.rejects(createCampaignDeliveryReporter({source:store})('campaignA'),/unavailable/);
 db.setDown(false);db.rows.get('message00001').campaign_id='campaignB';
 await assert.rejects(store.load('message00001'),/mismatch/);
 await assert.rejects(createCampaignDeliveryReporter({source:{pageCampaign:async()=>[{...delivery(1,'sent'),campaignId:'campaignOther'}]}})('campaignA'),/out-of-scope|unordered/);
});
