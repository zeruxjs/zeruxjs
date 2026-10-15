import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createConnector}=require('../dist/index.js');
const context={connection:{slug:'mysql',name:'mysql',connector:'mysql',options:{}}};
test('injected mysql2 Promise-style query result is not double-wrapped',async()=>{
 const connector=await createConnector({client:{query:async(sql,args)=>[[{id:2,name:'Alice'}],[{name:'id'}]]}});
 const result=await connector.execute({op:'select',table:'users'},context);
 assert.deepEqual(result.rows,[{id:2,name:'Alice'}]);
 await connector.disconnect();
});
test('MySQL injected executor uses parameter placeholders and returns affected rows',async()=>{
 let received;
 const connector=await createConnector({executor:async(sql,params)=>{received={sql,params};return {affectedRows:2,insertId:4};}});
 const result=await connector.execute({op:'update',table:'items',values:{name:'new'},where:{field:'id',operator:'eq',value:2}},context);
 assert.equal(result.affectedCount,2);assert.equal(result.insertedIds,undefined);
 assert.match(received.sql,/\?/);
 assert.deepEqual(received.params,['new',2]);
 await connector.disconnect();
});
