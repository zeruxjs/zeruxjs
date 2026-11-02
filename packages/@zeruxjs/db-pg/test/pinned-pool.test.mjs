import test from 'node:test';import assert from 'node:assert/strict';import { EventEmitter } from 'node:events';
import { createConnector } from '@zeruxjs/db-pg';
const context={connection:{slug:'pg',name:'PostgreSQL',connector:'@zeruxjs/db-pg',options:{}}};
const select={op:'select',table:'items',where:{field:'id',operator:'eq',value:'PRIVATE'}};
const code=value=>error=>error.details?.code===value;
function poolFixture(flags={}){
 const events=[],clients=[];let next=0,ended=0;
 const pool=Object.assign(new EventEmitter(),{totalCount:0,idleCount:0,waitingCount:0,async query(){throw Error('unpinned pool query');},async connect(){
  const id=++next,settings={statement_timeout:'30000',lock_timeout:'1000'};let rejectQuery,inTransaction=false;
  const client=Object.assign(new EventEmitter(),{async query(sql,params=[]){events.push({id,event:'query',sql,params});
   if(sql.startsWith('SELECT current_setting'))return {rows:[{...settings}]};
   if(sql.startsWith('SELECT set_config')){if(flags.resetFailure&&params[0]==='30000')throw Object.assign(Error('reset unavailable PRIVATE'),{code:'42501'});settings.statement_timeout=params[0];settings.lock_timeout=params[1];return {rows:[{}]};}
   if(sql.startsWith('BEGIN')){inTransaction=true;return {rows:[],rowCount:null};}
   if(sql==='COMMIT'){if(flags.commitFailure)throw Object.assign(Error('commit failed PRIVATE'),{code:'08006'});inTransaction=false;return {rows:[],rowCount:null};}
   if(sql==='ROLLBACK'){if(flags.rollbackFailure)throw Object.assign(Error('rollback failed'),{code:'08006'});inTransaction=false;return {rows:[],rowCount:null};}
   if(flags.hang)return new Promise((_,reject)=>{rejectQuery=reject;});
   if(flags.queryFailure)throw Object.assign(Error('statement failed PRIVATE'),{code:'23505'});
   return {rows:sql.startsWith('SELECT')?[{id:1}]:[],rowCount:sql.startsWith('UPDATE')?0:1};
  },async end(){events.push({id,event:'end'});inTransaction=false;rejectQuery?.(Error('connection ended'));},release(destroy){events.push({id,event:'release',destroy,settings:{...settings},inTransaction});}});
  clients.push(client);return client;
 },async end(){ended++;}});
 return {pool,clients,events,get ended(){return ended;}};
}
test('native-compatible leases pin transactions, reset settings and preserve zero CAS returning',async()=>{
 const f=poolFixture(),connector=await createConnector({pool:f.pool});
 try{
 assert.equal(connector.capabilities.transactions,'supported');assert.equal(connector.capabilities.cancellation,'supported');
 await connector.transaction(async tx=>{await tx.query(select);const result=await tx.update({table:'items',values:{value:'PRIVATE'},where:{field:'id',operator:'eq',value:1},returning:['id']});assert.equal(result.affectedCount,0);},{isolation:'serializable',timeoutMs:1000});
 assert.equal(f.clients.length,1);assert.equal(f.events.filter(e=>e.event==='release').length,1);const released=f.events.at(-1);assert.equal(released.destroy,false);assert.equal(released.inTransaction,false);assert.deepEqual(released.settings,{statement_timeout:'30000',lock_timeout:'1000'});
 assert.ok(f.events.some(e=>e.sql==='BEGIN ISOLATION LEVEL SERIALIZABLE'));const update=f.events.find(e=>e.sql?.startsWith('UPDATE'));assert.match(update.sql,/\$1.*\$2/);assert.equal(update.sql.includes('PRIVATE'),false);
 assert.equal(JSON.stringify(connector.getPoolStatus()).includes('PRIVATE'),false);assert.equal(connector.getPoolStatus().activeLeases,0);
 }finally{await connector.disconnect();}assert.equal(f.ended,0);assert.equal(f.pool.listenerCount('error'),0);
});
test('callback failures roll back before release, failed cleanup destroys rather than reuses',async()=>{
 const f=poolFixture();const connector=await createConnector({pool:f.pool});try{await assert.rejects(connector.transaction(async tx=>{await tx.query(select);throw Error('callback');}),/callback/);assert.ok(f.events.findIndex(e=>e.sql==='ROLLBACK')<f.events.findIndex(e=>e.event==='release'));assert.equal(f.events.at(-1).destroy,false);}finally{await connector.disconnect();}
 for(const flags of [{commitFailure:true},{queryFailure:true,rollbackFailure:true},{resetFailure:true}]){const f=poolFixture(flags),connector=await createConnector({pool:f.pool});try{await assert.rejects(connector.transaction(tx=>tx.query(select)));assert.equal(f.events.filter(e=>e.event==='release').length,1);assert.equal(f.events.at(-1).destroy,true);}finally{await connector.disconnect();}}
});
test('abort/query watchdog ends and settles native work before destroying the leased client',async()=>{
 for(const abortRequest of [true,false]){const f=poolFixture({hang:true}),connector=await createConnector({pool:f.pool,queryTimeoutMs:20});const abort=new AbortController();try{
 const pending=connector.execute(select,{...context,signal:abort.signal});while(!f.events.some(e=>e.sql?.startsWith('SELECT *')))await new Promise(setImmediate);if(abortRequest)abort.abort();
 await assert.rejects(pending,code(abortRequest?'PG_QUERY_CANCELLED':'PG_QUERY_TIMEOUT'));const end=f.events.findIndex(e=>e.event==='end'),release=f.events.findIndex(e=>e.event==='release');assert.ok(end>=0&&release>end);assert.equal(f.events[release].destroy,true);assert.equal(connector.getPoolStatus().activeLeases,0);
 }finally{await connector.disconnect();}}
});
test('acquisition deadlines/overload retain bounded waiting and destroy late arrivals',async()=>{
 const f=poolFixture();let resolve;const original=f.pool.connect;f.pool.connect=()=>new Promise(r=>{resolve=async()=>r(await original());});const connector=await createConnector({pool:f.pool,acquireTimeoutMs:5,maxPendingAcquires:1});
 try{await assert.rejects(connector.execute(select,context),code('PG_ACQUIRE_TIMEOUT'));assert.equal(connector.getPoolStatus().pendingAcquisitions,1);await assert.rejects(connector.execute(select,context),code('PG_POOL_SATURATED'));await resolve();await new Promise(setImmediate);assert.equal(f.events.at(-1).destroy,true);assert.equal(connector.getPoolStatus().lateReleases,1);assert.equal(connector.getPoolStatus().pendingAcquisitions,0);}finally{await connector.disconnect();}
});
test('invalid compiler/config input acquires zero clients and query-only transport stays unowned',async()=>{
 const f=poolFixture();const connector=await createConnector({pool:f.pool});try{await assert.rejects(connector.execute({...select,table:'bad;DROP'},context));assert.equal(f.clients.length,0);}finally{await connector.disconnect();}
 await assert.rejects(createConnector({acquireTimeoutMs:0}),code('INVALID_PG_LIMIT'));
 let ended=0;const old=await createConnector({client:{query:async()=>({rows:[],rowCount:0}),end:async()=>{ended++;}}});try{assert.equal(old.capabilities.transactions,'unsupported');await assert.rejects(old.transaction(()=>{}),code('UNSUPPORTED_PG_TRANSACTION'));}finally{await old.disconnect();}assert.equal(ended,0);
});
test('shutdown destroys active leases and never closes the caller-owned pool',async()=>{
 const f=poolFixture({hang:true}),connector=await createConnector({pool:f.pool});const pending=connector.execute(select,context);const rejected=assert.rejects(pending);while(!f.events.some(e=>e.sql?.startsWith('SELECT *')))await new Promise(setImmediate);await connector.disconnect();await rejected;await connector.disconnect();assert.equal(f.ended,0);assert.equal(f.events.filter(e=>e.event==='release').length,1);assert.equal(connector.getPoolStatus().activeLeases,0);
});
test('shared manager negotiates the real pg extension and pins callback operations once',async()=>{
 const {createDatabaseManager}=await import('@zeruxjs/db');const f=poolFixture();const manager=await createDatabaseManager({connections:[{name:'Main',slug:'main',connector:'@zeruxjs/db-pg',options:{pool:f.pool}}]});
 try{assert.equal(manager.capabilities().transactions,'supported');await manager.transaction(async tx=>{await tx.query(select);await tx.update({table:'items',values:{value:'new'},where:{field:'id',operator:'eq',value:1}});});assert.equal(f.clients.length,1);assert.equal(f.events.filter(e=>e.event==='release').length,1);}finally{await manager.disconnect();}
 assert.equal(f.ended,0);
});
test('an owned empty pool closes once without making any network connection',async()=>{
 const connector=await createConnector({max:2});const pool=connector.getNativeConnection();const end=pool.end.bind(pool);let ends=0;pool.end=()=>{ends++;return end();};assert.equal(connector.getPoolStatus().owned,true);await connector.disconnect();await connector.disconnect();assert.equal(ends,1);assert.equal(connector.getPoolStatus().closed,true);
});
test('reentrant shutdown/error callbacks cannot double-end or double-release clients',async()=>{
 const f=poolFixture({hang:true}),connect=f.pool.connect;f.pool.connect=async()=>{const client=await connect(),end=client.end;client.end=async()=>{client.emit('error',Error('closing'));return end.call(client);};return client;};
 const connector=await createConnector({pool:f.pool}),pending=connector.execute(select,context);const rejected=assert.rejects(pending);while(!f.events.some(e=>e.sql?.startsWith('SELECT *')))await new Promise(setImmediate);
 await Promise.all([connector.disconnect(),connector.disconnect()]);await rejected;assert.equal(f.events.filter(e=>e.event==='end').length,1);assert.equal(f.events.filter(e=>e.event==='release').length,1);
});
