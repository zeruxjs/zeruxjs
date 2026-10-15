import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createConnector}=require('../dist/index.js');
const context={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
test('SQLite builtin driver supports parameterized CRUD and accurate insert IDs',async()=>{
 const db=await createConnector({filename:':memory:',driver:'node'});
 try{
  const create=await db.execute({op:'createTable',table:'people',columns:[{name:'id',type:'integer',primary:true},{name:'name',type:'text'}]},context);
  assert.equal(create.ok,true);assert.equal(create.insertedIds,undefined);
  const inserted=await db.execute({op:'insert',table:'people',values:{id:1,name:'First'}},context);
  assert.deepEqual(inserted.insertedIds,[1]);
  const injected=`O'Reilly'); DROP TABLE people; --`;
  await db.execute({op:'insert',table:'people',values:{id:2,name:injected}},context);
  const selected=await db.execute({op:'select',table:'people',columns:['name'],where:{field:'id',operator:'eq',value:2}},context);
  assert.equal(selected.rows[0].name,injected);
  const updated=await db.execute({op:'update',table:'people',values:{name:'New'},where:{field:'id',operator:'eq',value:1}},context);
  assert.equal(updated.insertedIds,undefined);
  await db.execute({op:'turcunateTable',table:'people'},context);
  assert.equal((await db.execute({op:'select',table:'people'},context)).rowCount,0);
  assert.throws(()=>db.execute({op:'createDb',name:'not-supported'},context), /SQLite cannot/);
  assert.equal(db.getNativeConnection().prepare('SELECT count(*) as count FROM people').get?.()?.count ?? 0,0);
 }finally{await db.disconnect();}
});
