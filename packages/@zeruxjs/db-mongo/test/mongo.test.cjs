const {test} = require('node:test'); const assert=require('node:assert/strict');
const mongo=require('../dist/index.js');
const context={connection:{slug:'main',connector:'mongo',options:{},name:'Main'}};
function mockDatabase(){
 const calls=[], docs=[];
 const collection={
  async insertOne(value){calls.push(['insertOne',value]);docs.push(value);return {insertedId:'id1'};},
  find(where){calls.push(['find',where]);return {toArray:async()=>docs};},
  async updateMany(where,update){calls.push(['updateMany',where,update]);return {modifiedCount:1}},
  async deleteMany(where){calls.push(['deleteMany',where]);return {deletedCount:1}}
 };
 return { db:{collection(name){calls.push(['collection',name]);return collection}},calls };
}
test('Mongo connector inserts and rejects selector injection',async()=>{
 const {db,calls}=mockDatabase(), connector=await mongo.createConnector({db},context.connection);
 const inserted=await connector.execute({op:'insert',table:'users',values:{name:'Ada'}},context);
 assert.deepEqual(inserted.insertedIds,['id1']);
 await assert.rejects(connector.execute({op:'insert',table:'users',values:{$where:'bad'}},context), /Unsafe MongoDB field/);
 await assert.rejects(connector.execute({op:'select',table:'users',where:{field:'name',operator:'eq',value:{$ne:null}}},context),/Unsafe MongoDB field/);
 assert.equal(calls.filter(x=>x[0]==='insertOne').length,1);
});
test('Mongo protects destructive writes and validates fields',async()=>{
 const {db,calls}=mockDatabase(), connector=await mongo.createConnector({db},context.connection);
 await assert.rejects(connector.execute({op:'delete',table:'users'},context), /requires a where/);
 await assert.rejects(connector.execute({op:'update',table:'users',values:{name:'x'}},context), /requires a where/);
 await assert.rejects(connector.execute({op:'delete',table:'$users',where:{field:'a',operator:'eq',value:'b'}},context), /Unsafe MongoDB field/);
 const updated=await connector.execute({op:'update',table:'users',where:{field:'name',operator:'eq',value:'Ada'},values:{name:'Anne'}},context);
 assert.equal(updated.affectedCount,1);
});
test('Mongo SQL-like pattern escapes special regex characters',()=>{
 const result=mongo.buildWhere({field:'name',operator:'like',value:'a.%'});
 assert.deepEqual(result,{name:{$regex:'^a\\..*$'}});
});
test('Mongo simple filtered select uses find not aggregate', async()=> {
  const {db,calls}=mockDatabase(), connector=await mongo.createConnector({db},context.connection);
  const result=await connector.execute({op:'select',table:'users',where:{field:'name',operator:'eq',value:'Ada'}},context);
  assert.deepEqual(result.rows,[]);
  assert.equal(calls.some(x=>x[0]==='find'),true);
});
test('Mongo native count/group query DSL produces correct aggregation pipelines',async()=>{
 const seen=[];
 const db={collection:()=>({aggregate(pipeline){seen.push(pipeline);return {toArray:async()=>pipeline.some(s=>s.$count)?[]:[{category:'web',event_count:705},{category:'server',event_count:205}]};}})};
 const connector=await mongo.createConnector({db},context.connection);
 const count={expr:{kind:'function',name:'COUNT',args:[{kind:'column',name:'id'}]},as:'event_count'};
 const total=await connector.execute({op:'select',table:'analytics_events',columns:[count],where:{field:'site',operator:'eq',value:'a'}},context);
 assert.deepEqual(total.rows,[{event_count:0}]);assert.deepEqual(seen[0],[{$match:{site:'a'}},{$count:'event_count'}]);
 const result=await connector.execute({op:'select',table:'analytics_events',columns:[{expr:{kind:'column',name:'source'},as:'category'},count],groupBy:['source'],limit:3,where:{field:'site',operator:'eq',value:'a'}},context);
 assert.deepEqual(result.rows,[{category:'web',event_count:705},{category:'server',event_count:205}]);
 assert.deepEqual(seen[1],[{$match:{site:'a'}},{$group:{_id:'$source',event_count:{$sum:1}}},{$project:{_id:0,category:'$_id',event_count:1}},{$sort:{event_count:-1,category:1}},{$limit:3}]);
});
test('Mongo numeric fact expressions use native aggregation and preserve empty count',async()=>{
 const seen=[];
 const db={collection:()=>({aggregate(pipeline){seen.push(pipeline);return {toArray:async()=>pipeline.some(s=>s.$group?._id===null)?[]:[{category:'web',metric_value:55,numeric_count:11}]};}})};
 const connector=await mongo.createConnector({db},context.connection);
 const metric={expr:{kind:'function',name:'SUM',args:[{kind:'column',name:'numeric_value'}]},as:'metric_value'};
 const count={expr:{kind:'function',name:'COUNT',args:[{kind:'column',name:'event_id'}]},as:'numeric_count'};
 const total=await connector.execute({op:'select',table:'analytics_events_numeric',columns:[metric,count],where:{field:'property_name',operator:'eq',value:'cost'}},context);
 assert.deepEqual(total.rows,[{metric_value:null,numeric_count:0}]);
 assert.deepEqual(seen[0],[{$match:{property_name:'cost'}},{$group:{_id:null,metric_value:{$sum:'$numeric_value'},numeric_count:{$sum:1}}},{$project:{_id:0,metric_value:1,numeric_count:1}}]);
 const groups=await connector.execute({op:'select',table:'analytics_events_numeric',columns:[{expr:{kind:'column',name:'source'},as:'category'},metric,count],groupBy:['source'],limit:3},context);
 assert.deepEqual(groups.rows,[{category:'web',metric_value:55,numeric_count:11}]);
 assert.deepEqual(seen[1],[{$group:{_id:'$source',metric_value:{$sum:'$numeric_value'},numeric_count:{$sum:1}}},{$project:{_id:0,category:'$_id',metric_value:1,numeric_count:1}},{$sort:{metric_value:-1,category:1}},{$limit:3}]);
});

test('Mongo createTable ifNotExists tolerates existing namespaces for concurrent startups',async()=>{
 const db={createCollection:async()=>{const e=Error('already there');e.code=48;throw e;},collection:()=>({})};
 const connector=await mongo.createConnector({db},context.connection);
 const ok=await connector.execute({op:'createTable',table:'numeric_facts',ifNotExists:true,columns:[{name:'id',type:'varchar'}]},context);
 assert.equal(ok.ok,true);
 await assert.rejects(connector.execute({op:'createTable',table:'numeric_facts',columns:[{name:'id',type:'varchar'}]},context),/already there/);
});
