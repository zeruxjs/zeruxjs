import {test} from 'node:test';import assert from 'node:assert/strict';
import {createMemoryMailingContactStore,createMailingListService,sweepMailingContactRetention} from '../dist/index.js';
test('retention is dry-run by default, bounded, authorization-gated and version fenced',async()=>{
 const store=createMemoryMailingContactStore(),contacts=createMailingListService({store,now:()=>1000});
 for(let i=0;i<10;i++)await contacts.upsert(`contact${i}@example.org`,['old'],{cohort:'old'});
 const blocked=new Set();let canErase=0;
 const policy=async contact=>{canErase++;return !blocked.has(contact.email);};
 const dry=await sweepMailingContactRetention({store,olderThan:2000,canErase:policy,pageSize:3,maxScanned:20});
 assert.equal(dry.eligible,10);assert.equal(dry.erased,0);assert.equal((await contacts.page('old')).contacts.length,10);
 const page=await sweepMailingContactRetention({store,olderThan:2000,canErase:policy,dryRun:false,maxScanned:4,pageSize:2,now:()=>2000});
 assert.equal(page.scanned,4);assert.equal(page.erased,4);assert.equal(page.done,false);
 const remaining=await sweepMailingContactRetention({store,olderThan:2000,canErase:policy,dryRun:false,cursor:page.nextCursor,maxScanned:20});
 assert.equal(remaining.erased,6);assert.equal((await contacts.page('old')).contacts.length,0);
 await assert.rejects(sweepMailingContactRetention({store,olderThan:2000}),/Invalid contact retention/);
 assert.ok(canErase>=20);
});
test('retention respects policy, recent updates, CAS conflicts and does not leak PII into metrics',async()=>{
 const store=createMemoryMailingContactStore();const c=createMailingListService({store,now:()=>100});
 await c.upsert('recent@example.org',['retained']);await c.upsert('held@example.org',['retained']);
 const result=await sweepMailingContactRetention({store,olderThan:200,canErase:person=>person.email!=='held@example.org',dryRun:false});
 assert.equal(result.erased,1);assert.equal(result.skipped,1);
 assert.equal(JSON.stringify(result).includes('@example.org'),false);
 await c.upsert('new@example.org',['fresh']);
 const later=await sweepMailingContactRetention({store,olderThan:50,canErase:()=>true,dryRun:false});
 assert.equal(later.erased,0);
});

test('SQLite retention uses version-checked deletion across two independent connections',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {createConnector}=require('../../db-sqllite/dist/index.js');
 const {createDatabaseMailingContactStore}=await import('../dist/index.js');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const folder=await mkdtemp(join(tmpdir(),'retention-')),file=join(folder,'contacts.db');
 const c1=await createConnector({filename:file,driver:'node'}),c2=await createConnector({filename:file,driver:'node'});
 const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
 const adapter=c=>Object.fromEntries(['createTable','insert','select','update','delete'].map(op=>[op,args=>c.execute({op,...args},ctx)]));
 try{
  const s1=createDatabaseMailingContactStore(adapter(c1)),s2=createDatabaseMailingContactStore(adapter(c2));
  const contact=createMailingListService({store:s1,now:()=>1000});
  await contact.upsert('old@example.org',['list']);await contact.upsert('hold@example.org',['list']);
  const results=await sweepMailingContactRetention({store:s2,olderThan:1500,canErase:v=>v.email!=='hold@example.org',dryRun:false});
  assert.equal(results.erased,1);assert.equal(results.skipped,1);
  assert.equal((await contact.page('list')).contacts.length,1);
  assert.equal((await contact.page('list')).contacts[0].email,'hold@example.org');
 }finally{await c1.disconnect();await c2.disconnect();await rm(folder,{recursive:true,force:true});}
});
