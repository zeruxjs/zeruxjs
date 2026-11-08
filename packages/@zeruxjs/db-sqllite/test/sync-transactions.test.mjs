import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';import path from 'node:path';
import { createConnector, openSqlite, createSqliteConsistentBackup } from '@zeruxjs/db-sqlite';
const code=value=>error=>error.details?.code===value;
const table={op:'createTable',table:'items',columns:[{name:'id',type:'integer',primary:true},{name:'value',type:'text'}],indexes:[{op:'createIndex',table:'items',name:'ix_value',columns:['value']}]};
const insert=id=>({op:'insert',table:'items',values:{id,value:'private'}});
test('sync commit, rollback-only failure, nested denial and stale scopes',async()=>{
 const db=await createConnector({driver:'node'});let captured;
 try{
 assert.equal(db.synchronousTransactions,true);assert.equal(db.capabilities.transactions,'unsupported');
 const result=db.transactionSync(tx=>{captured=tx;assert.equal(tx.execute(table).ok,true);tx.insert({table:'items',values:{id:1,value:'first'}});return 42;});assert.equal(result,42);
 assert.throws(()=>captured.execute(insert(2)),code('SQLITE_TRANSACTION_SCOPE_CLOSED'));
 assert.throws(()=>db.transactionSync(tx=>{tx.execute(insert(2));throw Error('callback failed');}),/callback failed/);
 assert.equal(db.transactionSync(tx=>tx.select({table:'items'})).rowCount,1);
 assert.throws(()=>db.transactionSync(tx=>{try{tx.execute(insert(1));}catch{ /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */ }}),code('SQLITE_TRANSACTION_ROLLBACK_ONLY'));
 db.transactionSync(tx=>{assert.throws(()=>db.transactionSync(()=>{}),code('SQLITE_NESTED_TRANSACTION_UNSUPPORTED'));assert.throws(()=>db.execute(insert(3)),code('SQLITE_USE_TRANSACTION_FACADE'));assert.throws(()=>db.getNativeConnection(),code('SQLITE_USE_TRANSACTION_FACADE'));tx.execute(insert(3));});
 }finally{await db.disconnect();await db.disconnect();}
 assert.throws(()=>db.transactionSync(()=>{}),code('SQLITE_CONNECTOR_CLOSED'));
});
test('async functions/thenables cannot cross BEGIN and escaped continuations cannot write',async()=>{
 const db=await createConnector({driver:'node'});
 try{
 db.transactionSync(tx=>tx.execute(table));
 assert.throws(()=>db.transactionSync(async()=>{}),code('SQLITE_ASYNC_TRANSACTION_CALLBACK'));
 let escaped;assert.throws(()=>db.transactionSync(tx=>{tx.execute(insert(1));escaped=Promise.resolve().then(()=>tx.execute(insert(2)));return escaped;}),code('SQLITE_ASYNC_RESULT'));
 await assert.rejects(escaped,code('SQLITE_TRANSACTION_SCOPE_CLOSED'));
 assert.equal(db.transactionSync(tx=>tx.select({table:'items'})).rowCount,0);
 const abort=new AbortController();abort.abort();assert.throws(()=>db.transactionSync(()=>{}, {signal:abort.signal}),code('SQLITE_TRANSACTION_ABORTED'));
 }finally{await db.disconnect();}
});
test('bigint IDs and rows preserve 64-bit precision through native run and returning',async()=>{
 const db=await createConnector({driver:'node'});
 try{
 db.transactionSync(tx=>tx.execute(table));
 const raw=db.getNativeConnection();raw.exec('INSERT INTO items(id,value) VALUES (9007199254740993,\'large\')');
 const result=db.transactionSync(tx=>tx.insert({table:'items',values:{value:'generated'}}));assert.deepEqual(result.insertedIds,['9007199254740994']);
 const rows=db.transactionSync(tx=>tx.select({table:'items',orderBy:['id']})).rows;assert.deepEqual(rows.map(r=>r.id),['9007199254740993','9007199254740994']);
 const returning=db.transactionSync(tx=>tx.update({table:'items',values:{value:'changed'},returning:['id']}));assert.equal(typeof returning.rows[0].id,'string');
 }finally{await db.disconnect();}
 const big=await createConnector({driver:'node',readBigInts:true});try{big.transactionSync(tx=>{tx.execute(table);tx.execute(insert(1));});const rows=big.transactionSync(tx=>tx.select({table:'items'})).rows;assert.equal(rows[0].id,1n);}finally{await big.disconnect();}
});
test('configured WAL and busy timeout retain single writer and integrity checked rollback backup',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'sqlite-sync-'));const filename=path.join(dir,'live.sqlite'),snapshot=path.join(dir,'snapshot.sqlite');let first,second;
 try{
 first=await createConnector({filename,driver:'node',journalMode:'wal',busyTimeoutMs:10});second=await createConnector({filename,driver:'node',busyTimeoutMs:10});
 first.transactionSync(tx=>tx.execute(table));first.transactionSync(tx=>tx.execute(insert(1)));
 const raw=first.getNativeConnection();assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(raw.prepare('PRAGMA busy_timeout').get().timeout,10);
 first.transactionSync(()=>{assert.throws(()=>second.transactionSync(tx=>tx.execute(insert(2))),/locked|busy/i);});
 assert.throws(()=>first.transactionSync(tx=>{tx.execute(insert(3));throw Error('rollback');}),/rollback/);
 await createSqliteConsistentBackup(raw,snapshot);const restored=await createConnector({filename:snapshot,driver:'node',readonly:true});try{assert.deepEqual(restored.transactionSync(tx=>tx.select({table:'items'}),{mode:'deferred'}).rows.map(r=>r.id),[1]);}finally{await restored.disconnect();}
 assert.equal(readdirSync(dir).some(name=>name.startsWith('.zerux-backup-')),false);
 }finally{await second?.disconnect();await first?.disconnect();rmSync(dir,{recursive:true,force:true});}
});
test('borrowed ownership, invalid policies, missing native dependencies and partial init cleanup',async()=>{
 const raw=await openSqlite(':memory:','node');const db=await createConnector({databaseInstance:raw,busyTimeoutMs:0});await db.disconnect();assert.equal(raw.prepare('SELECT 1').all().length,1);raw.close();
 await assert.rejects(createConnector({driver:'invalid'}),code('UNKNOWN_SQLITE_DRIVER'));await assert.rejects(createConnector({busyTimeoutMs:'1'}),code('INVALID_SQLITE_BUSY_TIMEOUT'));
 await assert.rejects(createConnector({journalMode:'wal',readonly:true}),code('SQLITE_READONLY_JOURNAL_POLICY'));
 const executor=await createConnector({executor:()=>({changes:0})});try{assert.equal(executor.synchronousTransactions,false);assert.throws(()=>executor.transactionSync(()=>{}),code('UNSUPPORTED_SQLITE_SYNC_TRANSACTION'));}finally{await executor.disconnect();}
 await assert.rejects(createConnector({driver:'auto',filename:path.join(os.tmpdir(),'missing-sqlite-parent-'+Date.now(),'data.sqlite')}),/unable to open|open database/i);
 const dir=mkdtempSync(path.join(os.tmpdir(),'sqlite-init-'));try{const filename=path.join(dir,'data.sqlite');await assert.rejects(createConnector({filename,driver:'node',readBigInts:'invalid'}),code('INVALID_SQLITE_OPTIONS'));assert.deepEqual(readdirSync(dir),[]);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed native initialization closes owned handles but never borrowed handles',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const original=DatabaseSync.prototype.close;let closed=0;
 DatabaseSync.prototype.close=function(...args){closed++;return original.apply(this,args);};
 try{await assert.rejects(createConnector({driver:'node',journalMode:'wal'}),code('SQLITE_JOURNAL_MODE_UNAVAILABLE'));assert.equal(closed,1);}finally{DatabaseSync.prototype.close=original;}
 let borrowedClosed=0;const borrowed={prepare(){throw Error('version probe failed');},exec(){},close(){borrowedClosed++;}};
 await assert.rejects(createConnector({databaseInstance:borrowed}),/version probe failed/);assert.equal(borrowedClosed,0);
});
test('commit/rollback failures remain actionable and borrowed ownership survives quarantine',async()=>{
 const raw=await openSqlite(':memory:','node');let close=0;const exec=raw.exec.bind(raw);let failCommit=true;
 const wrapped={prepare:raw.prepare.bind(raw),exec(sql){if(sql==='COMMIT'&&failCommit)throw Error('commit unavailable');return exec(sql);},close(){close++;raw.close();},get isTransaction(){return raw.isTransaction;}};
 const db=await createConnector({databaseInstance:wrapped});
 try{assert.throws(()=>db.transactionSync(tx=>tx.execute(table)),code('SQLITE_COMMIT_FAILED'));failCommit=false;db.transactionSync(tx=>tx.execute(table));
 wrapped.exec=sql=>{if(sql==='ROLLBACK')throw Error('rollback unavailable');return exec(sql);};assert.throws(()=>db.transactionSync(()=>{throw Error('callback');}),AggregateError);assert.throws(()=>db.execute(insert(1)),code('SQLITE_TRANSACTION_HANDLE_UNUSABLE'));
 }finally{await db.disconnect();assert.equal(close,0);if(raw.isTransaction)exec('ROLLBACK');raw.close();}
});
test('optional better-sqlite3 obeys the same synchronous surface when its native environment exists',async t=>{
 let Driver;try{({default:Driver}=await import('better-sqlite3'));const probe=new Driver(':memory:');probe.close();}catch{t.skip('optional better-sqlite3/native binding unavailable');return;}
 const db=await createConnector({driver:'better-sqlite3'});try{db.transactionSync(tx=>{tx.execute(table);tx.execute(insert(1));});assert.equal(db.transactionSync(tx=>tx.select({table:'items'})).rowCount,1);}finally{await db.disconnect();}
});
test('readonly borrowed facade rejects writes without changing native ownership',async()=>{
 const raw=await openSqlite(':memory:','node');raw.exec('CREATE TABLE items(id INTEGER PRIMARY KEY,value TEXT)');const db=await createConnector({databaseInstance:raw,readonly:true});
 try{assert.equal(db.capabilities.schema,'unsupported');assert.equal(db.transactionSync(tx=>tx.select({table:'items'})).rowCount,0);assert.throws(()=>db.transactionSync(tx=>tx.execute(insert(1))),code('SQLITE_READONLY_WRITE'));assert.equal(raw.prepare('SELECT count(*) AS count FROM items').all()[0].count,0);}finally{await db.disconnect();raw.close();}
});
test('sync callback elapsed deadline rolls back and row metadata ignores keyword literals',async()=>{
 const db=await createConnector({driver:'node'});try{
 db.transactionSync(tx=>tx.execute({...table,columns:[{name:'id',type:'integer',primary:true},{name:'value',type:'text',default:'RETURNING'}]}));
 assert.throws(()=>db.transactionSync(tx=>{tx.execute(insert(1));const end=performance.now()+5;while(performance.now()<end){ /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */ }},{timeoutMs:1}),code('SQLITE_TRANSACTION_ABORTED'));
 assert.equal(db.transactionSync(tx=>tx.select({table:'items'})).rowCount,0);
 }finally{await db.disconnect();}
});
test('quarantined connector-owned handles still close exactly once',async()=>{
 const db=await createConnector({driver:'node'}),raw=db.getNativeConnection(),originalExec=raw.exec.bind(raw),originalClose=raw.close.bind(raw);let closed=0;
 raw.exec=sql=>{if(sql==='ROLLBACK')throw Error('rollback failure');return originalExec(sql);};raw.close=()=>{closed++;return originalClose();};
 try{assert.throws(()=>db.transactionSync(()=>{throw Error('callback failure');}),AggregateError);assert.throws(()=>db.execute(insert(1)),code('SQLITE_TRANSACTION_HANDLE_UNUSABLE'));}
 finally{await db.disconnect();await db.disconnect();}assert.equal(closed,1);
});
