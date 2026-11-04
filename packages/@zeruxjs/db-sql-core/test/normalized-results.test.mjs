import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSqlConnector}=require('../dist/index.js');
const context={connection:{slug:'test',name:'test',connector:'sqlite',options:{}}};
const dialect={kind:'sqlite',quoteIdentifier:s=>`"${s}"`,placeholder:()=> '?',functions:{},autoIncrementKeyword:'AUTOINCREMENT'};
test('result normalization avoids false inserted IDs for DDL and UPDATE', async()=>{
 const connector=createSqlConnector(dialect,{executor:()=>({lastInsertRowid:1,changes:3})});
 const table=await connector.execute({op:'createTable',table:'t',columns:[{name:'id',type:'integer'}]},context);
 const update=await connector.execute({op:'update',table:'t',values:{id:2}},context);
 assert.equal(table.insertedIds,undefined);
 assert.equal(update.insertedIds,undefined);
});
test('bigint insert IDs preserve precision',async()=>{
 const connector=createSqlConnector(dialect,{executor:()=>({lastInsertRowid:9007199254740993n,changes:1})});
 const result=await connector.execute({op:'insert',table:'t',values:{id:1}},context);
 assert.deepEqual(result.insertedIds,['9007199254740993']);
});
test('capabilities describe the structured API and zero affected counts remain exact',async()=>{
 let calls=0;const connector=createSqlConnector(dialect,{executor:()=>{calls++;return {changes:0};}});
 assert.equal(connector.capabilities.returning,'unsupported');assert.equal(connector.capabilities.transactions,'unsupported');assert.equal(connector.capabilities.cancellation,'unsupported');
 assert.throws(()=>connector.execute({op:'update',table:'t',values:{id:1},returning:['id']},context),/RETURNING/);assert.equal(calls,0);
 const result=await connector.execute({op:'update',table:'t',values:{id:1}},context);assert.equal(result.affectedCount,0);assert.equal(result.counts.affected,'exact');
});
test('explicit synchronous execution never creates an async multi-statement tail',async()=>{
 const operation={op:'createTable',table:'t',columns:[{name:'id',type:'integer'}],indexes:[{op:'createIndex',table:'t',name:'ix',columns:['id']}]};
 const seen=[];const synchronous=createSqlConnector(dialect,{synchronous:true,executor(sql){seen.push(sql);return {changes:0};}});const result=synchronous.execute(operation,context);assert.equal(typeof result.then,'undefined');assert.equal(seen.length,2);
 const asynchronous=[];const denied=createSqlConnector(dialect,{synchronous:true,executor(sql){asynchronous.push(sql);return Promise.resolve({changes:0});}});assert.throws(()=>denied.execute(operation,context),error=>error.details?.code==='ASYNCHRONOUS_EXECUTOR');await new Promise(setImmediate);assert.equal(asynchronous.length,1);
});
