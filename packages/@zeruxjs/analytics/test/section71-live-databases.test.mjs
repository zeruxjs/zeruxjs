/** Opt-in parity gate; no external services, credentials or native drivers required for offline npm test.
 * Provision dedicated disposable databases and build the four DB workspaces first.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAnalytics} from '../dist/index.js';
const ctx=(engine)=>({connection:{slug:'analytics',name:'analytics',connector:engine,options:{}}});
const uniqueTable=()=>`a71_${Date.now().toString(36)}_${randomUUID().slice(0,8)}`;
async function verify({connector,engine,close}){
  const table=uniqueTable();const context=ctx(engine);
  const db=Object.fromEntries(['createTable','createIndex','insert','select','update','delete'].map(op=>[op,args=>connector.execute({op,...args},context)]));
  const a=createAnalytics({analytics:'analytics',database:{connectionSlugs:['analytics'],getConnectionFacade:()=>db},
    table,numericFields:['amount'],approveRetention:()=>true});
  const site=uniqueTable(),now=Date.now(),old=now-4*86400000;
  try{
    assert.equal(await a.initialize(),true,'collection schema must initialize');
    assert.equal(typeof await a.track({name:'purchase',site,occurredAt:old,properties:{amount:12}}),'string');
    assert.equal(typeof await a.track({name:'purchase',site,properties:{amount:7}}),'string');
    const counts=await a.aggregate({groupBy:'event',site});
    assert.equal(counts.total,2,'native count should be exact over persisted rows');
    assert.equal((await a.aggregateNumeric({metric:'sum',valueField:'amount',groupBy:'event',site})).total,19);
    const deleted=await a.purgePage({site,before:now-2*86400000,dryRun:false,limit:1});
    assert.equal(deleted.deleted,1);assert.equal(deleted.deletedNumericFacts,1);
    assert.equal((await a.aggregate({groupBy:'event',site})).total,1);
    assert.equal((await a.aggregateNumeric({metric:'sum',valueField:'amount',groupBy:'event',site})).total,7);
  }finally{
    // Only drop the unique disposable collections after this particular test; no application data touched.
    for(const name of [table,`${table.slice(0,55)}_numeric`]){
      try{await connector.execute({op:'dropTable',table:name,ifExists:true},context);}catch{/* Preserve original failure */}
    }
    await close();
  }
}
const pg=process.env.ZERUX_TEST_PG_URL;
test('PostgreSQL: ingestion/count/numeric/tenant retention parity (opt-in)',{skip:!pg},async()=>{
  const {createConnector}=await import('../../db-pg/dist/index.js');
  const connector=await createConnector({connectionString:pg});
  await verify({connector,engine:'@zeruxjs/db-pg',close:()=>connector.disconnect()});
});
const host=process.env.ZERUX_TEST_MYSQL_HOST,dbname=process.env.ZERUX_TEST_MYSQL_DATABASE;
test('MySQL: ingestion/count/numeric/tenant retention parity (opt-in)',{skip:!host||!dbname},async()=>{
  const {createConnector}=await import('../../db-mysql/dist/index.js');
  const connector=await createConnector({host,port:Number(process.env.ZERUX_TEST_MYSQL_PORT??3306),
    user:process.env.ZERUX_TEST_MYSQL_USER,password:process.env.ZERUX_TEST_MYSQL_PASSWORD,database:dbname});
  await verify({connector,engine:'@zeruxjs/db-mysql',close:()=>connector.disconnect()});
});
const mongo=process.env.ZERUX_TEST_MONGO_URI,mongodb=process.env.ZERUX_TEST_MONGO_DATABASE;
test('MongoDB: ingestion/count/numeric/tenant retention parity (opt-in)',{skip:!mongo||!mongodb},async()=>{
  const {MongoClient}=await import('mongodb');
  const client=new MongoClient(mongo,{serverSelectionTimeoutMS:5000});
  await client.connect();
  try{
    const {createConnector}=await import('../../db-mongo/dist/index.js');
    const connector=await createConnector({client,database:mongodb});
    await verify({connector,engine:'@zeruxjs/db-mongo',close:async()=>connector.disconnect?.()});
  }finally{await client.close();}
});
