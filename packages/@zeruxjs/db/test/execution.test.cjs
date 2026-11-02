const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createDatabaseManager,createTenantDatabaseFacade,createKeysetPage}=require('@zeruxjs/db');
const query={op:'update',table:'records',values:{password:'PRIVATE'},where:{field:'id',operator:'eq',value:'PRIVATE'}};
const code=expected=>error=>error.details?.code===expected;
async function fixture(connector,execution,run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'db-exec-'));const previous=process.cwd();let manager;
 try{fs.writeFileSync(path.join(dir,'package.json'),'{}');const mod=path.join(dir,'node_modules','test-execution');fs.mkdirSync(mod,{recursive:true});fs.writeFileSync(path.join(mod,'index.js'),'exports.createConnector=options=>options.instance;');process.chdir(dir);
 manager=await createDatabaseManager({connections:[{name:'Test',slug:'test',connector:'test-execution',options:{instance:connector,password:'PRIVATE'}}],execution});await run(manager);
 }finally{await manager?.disconnect();process.chdir(previous);fs.rmSync(dir,{recursive:true,force:true});}}
const result={ok:true,connection:'test',connector:'fake',operation:'update',affectedCount:0,rowCount:99};
test('capabilities reject unsupported batch before execution and preserve zero CAS misses',async()=>{
 let calls=0;const metrics=[];await fixture({kind:'fake',options:{},capabilities:{returning:'unsupported'},execute(){calls++;return result;}},{onMetric:m=>metrics.push(m)},async manager=>{
 assert.equal(manager.capabilities().transactions,'unknown');assert.ok(Object.isFrozen(manager.capabilities()));
 assert.throws(()=>manager.query([query,{...query,returning:['id']}]),code('UNSUPPORTED_CAPABILITY'));assert.equal(calls,0);
 assert.throws(()=>manager.query(query,{require:['transactions']}),code('UNSUPPORTED_CAPABILITY'));
 assert.equal(manager.update(query).affectedCount,0);assert.equal(metrics[0].count,0);assert.equal(JSON.stringify(metrics).includes('PRIVATE'),false);assert.deepEqual(Object.keys(metrics[0]).sort(),['operation','table','durationMs','count','outcome'].sort());
 });
});
test('cancelled callers retain the pending slot until actual driver settlement',async()=>{
 let resolve,signal,calls=0;await fixture({kind:'fake',options:{},execute(op,context){calls++;signal=context.signal;return calls===1?new Promise(r=>resolve=r):result;}},{maxPending:1},async manager=>{
 const abort=new AbortController();const pending=manager.query(query,{signal:abort.signal});abort.abort();await assert.rejects(pending,code('QUERY_CANCELLED'));assert.equal(signal.aborted,true);assert.throws(()=>manager.query(query),code('QUERY_LIMIT'));
 resolve(result);await new Promise(setImmediate);assert.equal((await manager.query(query)).affectedCount,0);
 });
});
test('deadline, batch bounds, metric failures and dependency failure are explicit',async()=>{
 await fixture({kind:'fake',options:{},execute(op,context){return new Promise((_,reject)=>context.signal.addEventListener('abort',()=>reject(Error('PRIVATE')),{once:true}));}},{maxBatch:1,onMetric(){throw Error('hook');}},async manager=>{
 assert.throws(()=>manager.query([query,query]),code('BATCH_LIMIT'));
 await assert.rejects(manager.query(query,{timeoutMs:10}),code('QUERY_DEADLINE'));
 const aborted=AbortSignal.abort();assert.throws(()=>manager.query(query,{signal:aborted}),code('QUERY_CANCELLED'));
 });
 const events=[];await fixture({kind:'fake',options:{},execute(){throw Error('driver unavailable PRIVATE');}},{onMetric:e=>events.push(e)},async manager=>{assert.throws(()=>manager.query(query),/driver unavailable/);assert.equal(events[0].outcome,'failure');assert.equal(JSON.stringify(events).includes('PRIVATE'),false);});
});
test('disconnect aborts callers, closes once and denies stale facades',async()=>{
 let closed=0;await fixture({kind:'fake',options:{},execute(){return new Promise(()=>{});},disconnect(){closed++;}},{shutdownGraceMs:10},async manager=>{
 const facade=manager.getConnectionFacade();const pending=manager.query(query);const rejected=assert.rejects(pending,code('QUERY_CANCELLED'));await manager.disconnect();await rejected;await manager.disconnect();assert.equal(closed,1);assert.throws(()=>facade.query(query),code('MANAGER_CLOSED'));assert.throws(()=>facade.native(),code('MANAGER_CLOSED'));
 });
});
test('keyset continuation validates stable ordering and retains tenant allowlists',async()=>{
 const order=[{column:'created',direction:'desc'},{column:'id',direction:'asc'}];const first=createKeysetPage({table:'records',order,uniqueKey:'id',limit:10});const cursor=first.continuation({created:12,id:'a'});const next=createKeysetPage({table:'records',order,uniqueKey:'id',limit:10,after:cursor});
 assert.equal(next.operation.offset,undefined);assert.equal(next.operation.where.or.length,2);assert.throws(()=>createKeysetPage({table:'other',order,uniqueKey:'id',limit:10,after:cursor}),code('INVALID_CONTINUATION'));assert.throws(()=>first.continuation({created:null,id:'a'}),code('INVALID_CONTINUATION'));
 await fixture({kind:'fake',options:{},execute(op){assert.equal(op.table,'private_records');assert.equal(op.where.and.at(-1).value,'verified');return result;}},{},async manager=>{
 const tenant=createTenantDatabaseFacade(manager.getConnectionFacade(),{tenantId:'verified',tables:{records:'private_records'}});await tenant.select(next.operation,{timeoutMs:100});assert.throws(()=>tenant.select({table:'other'}),code('TENANT_SCOPE_DENIED'));
 });
});
test('real SQLite keysets retain tenant scope and zero-row CAS counts',async()=>{
 const manager=await createDatabaseManager({connections:[{name:'SQLite',slug:'main',connector:'@zeruxjs/db-sqlite',options:{filename:':memory:',driver:'node'}}]});
 try{
 await manager.createTable({op:'createTable',table:'shared_records',columns:[{name:'id',type:'integer',primary:true},{name:'created',type:'integer'},{name:'tenant_id',type:'text'},{name:'revision',type:'integer'}]});
 await manager.insert({op:'insert',table:'shared_records',values:[{id:1,created:10,tenant_id:'A',revision:1},{id:2,created:10,tenant_id:'B',revision:1},{id:3,created:10,tenant_id:'A',revision:1}]});
 const tenant=createTenantDatabaseFacade(manager.getConnectionFacade(),{tenantId:'A',tables:{records:'shared_records'}});
 const request={table:'records',order:[{column:'created',direction:'desc'},{column:'id',direction:'asc'}],uniqueKey:'id',limit:1};
 const first=createKeysetPage(request);const rows=(await tenant.select(first.operation)).rows;assert.equal(rows[0].id,1);
 const next=createKeysetPage({...request,after:first.continuation(rows[0])});assert.equal((await tenant.select(next.operation)).rows[0].id,3);
 const miss=await tenant.update({table:'records',values:{revision:2},where:{field:'revision',operator:'eq',value:99}});assert.equal(miss.affectedCount,0);assert.equal(miss.counts.affected,'exact');
 }finally{await manager.disconnect();}
});
test('disconnect remains exactly once when driver abort callbacks reenter it',async()=>{
 let current,closed=0;
 await fixture({kind:'fake',options:{},execute(op,context){context.signal.addEventListener('abort',()=>{void current.disconnect();},{once:true});return new Promise(()=>{});},disconnect(){closed++;}},{shutdownGraceMs:5},async manager=>{
 current=manager;const pending=manager.query(query);const rejected=assert.rejects(pending,code('QUERY_CANCELLED'));await Promise.all([manager.disconnect(),manager.disconnect()]);await rejected;assert.equal(closed,1);
 });
});
