import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createConnector } = require('../dist/index.js');
const { createTenantDatabaseFacade, createDatabaseMigrationRunner } = require('@zeruxjs/db');
const ctx = { connection: { slug:'main',name:'Main',connector:'sqlite',options:{} } };
const setup = async file => {
  const connector = await createConnector({filename:file,driver:'node'});
  const exec = operation => connector.execute(operation,ctx);
  return { connector, exec, facade:{ select:exec, insert:exec, update:exec, delete:exec, query:exec } };
};

test('tenant facade isolates reads, writes, bulk updates and deletes across real SQLite connections', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'zx-tenant-'));
  const a=await setup(path.join(dir,'data.sqlite'));
  const b=await setup(path.join(dir,'data.sqlite'));
  try {
    await a.exec({op:'createTable',table:'emails',columns:[{name:'id',type:'integer',primary:true},{name:'tenant_id',type:'text',notNull:true},{name:'body',type:'text'}]});
    const alice=createTenantDatabaseFacade(a.facade,{tenantId:'alice',tables:{messages:'emails'}});
    const bob=createTenantDatabaseFacade(b.facade,{tenantId:'bob',tables:{messages:'emails'}});
    await alice.insert({table:'messages',values:{id:1,body:'a'}});
    await bob.insert({table:'messages',values:{id:2,body:'b'}});
    assert.deepEqual((await alice.select({table:'messages'})).rows.map(row=>row.body),['a']);
    assert.deepEqual((await bob.select({table:'messages'})).rows.map(row=>row.body),['b']);
    // A caller-controlled OR condition cannot neutralize the injected tenant AND predicate.
    assert.deepEqual((await alice.select({table:'messages',where:{or:[{field:'id',operator:'eq',value:2},{field:'id',operator:'eq',value:1}]}})).rows.map(row=>row.id),[1]);
    await alice.update({table:'messages',values:{body:'updated'}});
    assert.equal((await bob.select({table:'messages'})).rows[0].body,'b');
    await alice.delete({table:'messages'});
    assert.equal((await alice.select({table:'messages'})).rows.length,0);
    assert.equal((await bob.select({table:'messages'})).rows.length,1);
    assert.throws(()=>alice.insert({table:'messages',values:{id:3,tenant_id:'bob',body:'bad'}}),/Tenant identifier/);
    assert.throws(()=>alice.update({table:'messages',values:{tenant_id:'bob'}}),/Tenant identifier/);
    assert.throws(()=>alice.select({table:'unknown'}),/allowlist/);
    assert.throws(()=>alice.select({table:'messages',into:'private_db'}),/Cross-connection/);
    assert.throws(()=>alice.select({table:'messages',joins:[{table:'users',type:'inner',on:{field:'id',operator:'eq',value:1}}]}),/joins\/unions/);
    assert.throws(()=>alice.select({table:'messages',where:{operator:'exists',query:{op:'select',table:'private'}}}),/subqueries/);
    assert.throws(()=>createTenantDatabaseFacade(a.facade,{tenantId:'alice',tables:{x:'emails; DROP TABLE emails'}}),/Unsafe tenant table/);
  } finally { await a.connector.disconnect(); await b.connector.disconnect(); rmSync(dir,{recursive:true,force:true}); }
});

test('exclusive SQLite transaction migration journal is reversible; failures roll back DDL and journal',async()=>{
  const db=await setup(':memory:');
  try {
    await db.exec({op:'createTable',table:'migration_journal',columns:[{name:'id',type:'text',primary:true},{name:'checksum',type:'text',notNull:true},{name:'appliedAt',type:'text',notNull:true}]});
    const native=db.connector.getNativeConnection();
    const transaction=async fn=>{
      native.exec('BEGIN IMMEDIATE');
      const journal={
        list: async()=> (await db.exec({op:'select',table:'migration_journal',orderBy:[{by:'id'}]})).rows,
        insert: async record=> {await db.exec({op:'insert',table:'migration_journal',values:record});},
        remove: async id=> {await db.exec({op:'delete',table:'migration_journal',where:{field:'id',operator:'eq',value:id}});}
      };
      try {const result=await fn(db.facade,journal);native.exec('COMMIT');return result;}
      catch(err){native.exec('ROLLBACK');throw err;}
    };
    const migrations=[{id:'2026101401_add_events',up:[{op:'createTable',table:'events',columns:[{name:'id',type:'integer',primary:true}]}],down:[{op:'dropTable',table:'events'}]}];
    const runner=createDatabaseMigrationRunner(migrations,{transaction});
    assert.deepEqual(await runner.status(),{applied:0,pending:1});
    assert.deepEqual(await runner.apply(),[migrations[0].id]);
    assert.deepEqual(await runner.apply(),[]);
    assert.deepEqual(await runner.status(),{applied:1,pending:0});
    await assert.rejects(runner.rollbackLast(async()=>false),/not approved/);
    assert.equal((await db.exec({op:'select',table:'migration_journal'})).rows.length,1);
    assert.equal(await runner.rollbackLast(async()=>true),migrations[0].id);
    assert.deepEqual(await runner.status(),{applied:0,pending:1});
    const fails=createDatabaseMigrationRunner([
      {id:'2026101401_add_events',up:[{op:'createTable',table:'events',columns:[{name:'id',type:'integer',primary:true}]},{op:'insert',table:'missing_table',values:{id:1}}],down:[{op:'dropTable',table:'events'}]}
    ],{transaction});
    await assert.rejects(fails.apply());
    assert.equal((await db.exec({op:'select',table:'migration_journal'})).rows.length,0);
    assert.equal((await db.exec({op:'select',table:'sqlite_master',columns:['name'],where:{field:'name',operator:'eq',value:'events'}})).rows.length,0);
    await runner.apply();
    const changed=createDatabaseMigrationRunner([{id:'2026101401_add_events',up:[{op:'createTable',table:'different',columns:[{name:'id',type:'integer'}]}],down:[{op:'dropTable',table:'different'}]}],{transaction});
    await assert.rejects(changed.status(),/modified migration/);
  }finally{await db.connector.disconnect();}
});
