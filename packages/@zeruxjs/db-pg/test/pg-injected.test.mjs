import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createConnector}=require('../dist/index.js');
const context={connection:{slug:'pg',name:'postgres',connector:'pg',options:{}}};
test('PG injected client executes parameterized query with correct result',async()=>{
 const calls=[];
 const connector=await createConnector({client:{query:async(sql, params)=>{calls.push({sql,params});return {rows:[{id:3}],rowCount:1};}}});
 try {
  const result=await connector.execute({op:'select',table:'users',where:{field:'id',operator:'eq',value:3}},context);
  assert.deepEqual(result.rows,[{id:3}]);
  assert.match(calls[0].sql,/\$1/);
  assert.deepEqual(calls[0].params,[3]);
 }finally{await connector.disconnect();}
});
test('external PG pools are not closed by connector',async()=>{
 let closed=false;
 const connector=await createConnector({pool:{query:async()=>({rows:[],rowCount:0}),end:async()=>{closed=true;}}});
 await connector.disconnect();assert.equal(closed,false);
});
