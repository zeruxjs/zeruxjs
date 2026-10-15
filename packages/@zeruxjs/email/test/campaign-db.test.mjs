import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDatabaseCampaignStore,createDatabaseMarketingSuppressionStore,createMarketingSuppressionService,createCampaignPlanner} from '../dist/index.js';
/** SQL-shaped CAS adapter exercises the actual atomic result/affectedCount contract. */
function fakeDb(){
 const tables=new Map();
 return {
  async createTable({table}){if(!tables.has(table))tables.set(table,new Map());return {ok:true};},
  async insert({table,values}){const t=tables.get(table);if(t.has(values.id))throw Error('UNIQUE constraint');t.set(values.id,{...values});return {ok:true,affectedCount:1};},
  async select({table,where}){const v=tables.get(table).get(where.value);return {ok:true,rows:v?[v]:[]};},
  async update({table,values,where}){const [id,version]=where.and.map(c=>c.value),t=tables.get(table),existing=t.get(id);if(!existing||existing.version!==version)return {ok:true,affectedCount:0};t.set(id,{...existing,...values});return {ok:true,affectedCount:1};}
 };
}
test('DB-backed campaign store enforces CAS and stores resumable checkpoints',async()=>{
 const db=fakeDb(),a=createDatabaseCampaignStore(db),b=createDatabaseCampaignStore(db);
 const setup=store=>createCampaignPlanner({store,now:()=>1000,source:{page:async()=>({contacts:[],done:true,nextCursor:null})},isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{}});
 const p1=setup(a),p2=setup(b);
 await p1.create({id:'shared1',name:'Test',sendAt:1000});
 await assert.rejects(p2.create({id:'shared1',name:'Test',sendAt:1000}),/already exists/);
 await p2.command('shared1','schedule');
 const old=await a.load('shared1');
 await p1.runOnce('shared1','worker');
 assert.equal((await b.load('shared1')).status,'completed');
 assert.equal(await a.save({...old,version:old.version+1},old.version),false);
});
test('DB-backed suppression service persists hard bounces across service instances',async()=>{
 const db=fakeDb(),s1=createMarketingSuppressionService({store:createDatabaseMarketingSuppressionStore(db)}),s2=createMarketingSuppressionService({store:createDatabaseMarketingSuppressionStore(db)});
 assert.equal(await s2.isSuppressed('a@example.test'),false);
 await s1.recordFeedback({email:'a@example.test',kind:'complaint',eventId:'provider-1'});
 assert.equal(await s2.isSuppressed('A@example.test'),true);
});
test('CAS stores refuse connectors that do not report affected rows',async()=>{
 const db=fakeDb(),store=createDatabaseCampaignStore({...db,update:async()=>({ok:true})});
 const p=createCampaignPlanner({store,now:()=>1000,source:{page:async()=>({contacts:[],done:true,nextCursor:null})},isSubscribed:async()=>true,isSuppressed:async()=>false,ensureMessage:async()=>{},enqueue:async()=>{}});
 await p.create({id:'unsafe',name:'Unsafe',sendAt:1000});
 await assert.rejects(p.command('unsafe','schedule'),/missing affectedCount/);
});
