import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {mkdtempSync,rmSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url);
const {createConnector,createSqliteConsistentBackup}=require('../dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'sqlite',options:{}}};
test('consistent SQLite WAL backup passes integrity check and offline restore rehearsal',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'zx-backup-'));
 const source=path.join(dir,'live.sqlite'), backup=path.join(dir,'snapshot.sqlite'), restored=path.join(dir,'restored.sqlite');
 const live=await createConnector({filename:source,driver:'node'});
 try {
  const raw=live.getNativeConnection();raw.exec('PRAGMA journal_mode=WAL');
  await live.execute({op:'createTable',table:'audit',columns:[{name:'id',type:'integer',primary:true},{name:'message',type:'text'}]},ctx);
  await live.execute({op:'insert',table:'audit',values:{id:1,message:'keep'}},ctx);
  assert.deepEqual(await createSqliteConsistentBackup(raw,backup),{destination:backup,integrity:'ok'});
  await assert.rejects(createSqliteConsistentBackup(raw,backup),/already exists/);
  await live.execute({op:'insert',table:'audit',values:{id:2,message:'after backup'}},ctx);
  copyFileSync(backup,restored); // offline restore into an unallocated destination, NEVER over a live SQLite DB
  const recovered=await createConnector({filename:restored,driver:'node',readonly:true});
  try {const rows=(await recovered.execute({op:'select',table:'audit'},ctx)).rows;assert.deepEqual(rows.map(r=>r.message),['keep']);}
  finally{await recovered.disconnect();}
  assert.equal(existsSync(backup),true);
 }finally {await live.disconnect();rmSync(dir,{recursive:true,force:true});}
});
