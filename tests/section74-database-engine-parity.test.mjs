/** Run on a clean checkout after building packages, with optional real-engine URLs.
 * Real PG/MySQL/Mongo are intentionally skipped unless configured; never silently fake them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require=createRequire(import.meta.url);
const root='../packages/@zeruxjs/';
const context=(engine)=>({connection:{slug:'parity',name:'Parity',connector:engine,options:{}}});
const table=()=>`zx_parity_${randomBytes(6).toString('hex')}`;
async function parity(connector,engine){
 const c=context(engine), name=table();
 try {
  await connector.execute({op:'createTable',table:name,columns:[{name:'id',type:'integer',primary:true},{name:'tenant_id',type:'varchar',length:128},{name:'value',type:'varchar',length:128}]},c);
  const insert=await connector.execute({op:'insert',table:name,values:{id:1,tenant_id:'A',value:'before'}},c);
  assert.equal(insert.ok,true);
  const read=await connector.execute({op:'select',table:name,where:{field:'tenant_id',operator:'eq',value:'A'}},c);
  assert.equal(read.rows.length,1);
  assert.equal(read.rows[0].value,'before');
  const update=await connector.execute({op:'update',table:name,where:{field:'id',operator:'eq',value:1},values:{value:'after'}},c);
  assert.equal(update.affectedCount,1);
  const missed=await connector.execute({op:'update',table:name,where:{field:'id',operator:'eq',value:999},values:{value:'missed'}},c);
  assert.equal(missed.affectedCount,0);
  const final=await connector.execute({op:'select',table:name,where:{field:'id',operator:'eq',value:1}},c);
  assert.equal(final.rows[0].value,'after');
  const removed=await connector.execute({op:'delete',table:name,where:{field:'id',operator:'eq',value:1}},c);
  assert.equal(removed.affectedCount,1);
 } finally {
  try {await connector.execute({op:'dropTable',table:name,ifExists:true},c);} finally {await connector.disconnect?.();}
 }
}
test('SQLite native connector real-engine parity',async()=>{
 const {createConnector}=require(`${root}db-sqllite/dist/index.js`);
 await parity(await createConnector({filename:':memory:',driver:'node'}),'sqlite');
});
test('PostgreSQL real-engine parity', {skip:!process.env.ZX_TEST_PG_URL},async()=>{
 const {createConnector}=require(`${root}db-pg/dist/index.js`);
 await parity(await createConnector({connectionString:process.env.ZX_TEST_PG_URL}),'pg');
});
test('MySQL real-engine parity', {skip:!process.env.ZX_TEST_MYSQL_DB || !process.env.ZX_TEST_MYSQL_USER},async()=>{
 const {createConnector}=require(`${root}db-mysql/dist/index.js`);
 await parity(await createConnector({host:process.env.ZX_TEST_MYSQL_HOST || '127.0.0.1',port:Number(process.env.ZX_TEST_MYSQL_PORT||3306),user:process.env.ZX_TEST_MYSQL_USER,password:process.env.ZX_TEST_MYSQL_PASSWORD,database:process.env.ZX_TEST_MYSQL_DB}),'mysql');
});
test('MongoDB real-engine parity', {skip:!process.env.ZX_TEST_MONGO_URI},async()=>{
 const {createConnector}=require(`${root}db-mongo/dist/index.js`);
 const connector=await createConnector({uri:process.env.ZX_TEST_MONGO_URI,database:process.env.ZX_TEST_MONGO_DB || 'zerux_test'});
 await connector.connect?.();
 await parity(connector,'mongo');
});
