import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDatabaseEmailDeliveryStore,createEmailDeliveryRecoveryScanner,createDatabaseEmailDeliveryHistory,createJournaledEmailDeliveryStore} from '../dist/index.js';
const require=createRequire(import.meta.url);const {createConnector}=require('../../db-sqllite/dist/index.js');
const ctx={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
const facade=c=>Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,arg=>c.execute({op,...arg},ctx)]));
test('expired claimed is retry-safe, sending becomes uncertain; history reports actual recovery only',async()=>{
 const c=await createConnector({filename:':memory:',driver:'node'});
 try{let t=10000;const db=facade(c),raw=createDatabaseEmailDeliveryStore(db),history=createDatabaseEmailDeliveryHistory(db),store=createJournaledEmailDeliveryStore(raw,history,()=>t);
  for(const [id,state,expiresAt] of [['a','claimed',9000],['b','sending',9000],['c','sending',11000],['d','sent',9000]]){
   await store.create({id,version:1,purpose:'marketing',recipient:'private@example.test',campaignId:'camp69',state,
    lease:state==='sent'?null:{owner:'worker',token:'opaque',expiresAt},updatedAt:8000});
  }
  const run=createEmailDeliveryRecoveryScanner({store:{...store,pageCampaign:raw.pageCampaign},now:()=>t});
  const dry=await run('camp69',{limit:2});assert.equal(dry.dryRun,true);assert.equal(dry.expiredClaims,1);assert.equal(dry.uncertainSubmissions,1);
  assert.equal((await raw.load('a')).state,'claimed');
  const result=await run('camp69',{limit:3,dryRun:false});
  assert.deepEqual([result.recoveredClaims,result.markedUncertain,result.contended],[1,1,0]);
  assert.equal((await raw.load('a')).state,'pending');assert.equal((await raw.load('b')).state,'uncertain');
  assert.equal((await raw.load('c')).state,'sending');
  assert.equal((await history.latest('camp69','a')).to,'pending');
  assert.equal((await history.latest('camp69','b')).to,'uncertain');
  const repeat=await run('camp69',{limit:4,dryRun:false});assert.equal(repeat.recoveredClaims,0);assert.equal(repeat.markedUncertain,0);
  assert.equal(JSON.stringify(result).includes('private@example.test'),false);
  await assert.rejects(run('other!',{}),/Invalid/);
 }finally{await c.disconnect();}
});
