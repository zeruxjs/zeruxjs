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
