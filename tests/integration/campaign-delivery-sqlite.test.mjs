import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createDatabaseEmailDeliveryStore,createCampaignDeliveryReporter} from '../../packages/@zeruxjs/queue/dist/index.js';
const context={connection:{slug:'primary',connector:'sqlite',options:{},name:'Primary'}};
const facade=driver=>({createTable:op=>driver.execute({...op,op:'createTable'},context),
  insert:op=>driver.execute({...op,op:'insert'},context),
  select:op=>driver.execute({...op,op:'select'},context),
  update:op=>driver.execute({...op,op:'update'},context)});
const message=i=>({id:`delivery${String(i).padStart(6,'0')}`,version:1,purpose:'marketing',campaignId:'octoberCampaign',recipient:'private@example.test',state:'pending',lease:null,updatedAt:Date.UTC(2026,9,13)});

test('real SQLite durable delivery CAS and exact report across two connections',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zerux-delivery-'));let a,b;
  try{
    const file=join(dir,'delivery.sqlite');
    a=await createConnector({filename:file,driver:'node'},context.connection);
    b=await createConnector({filename:file,driver:'node'},context.connection);
    const first=createDatabaseEmailDeliveryStore(facade(a)),second=createDatabaseEmailDeliveryStore(facade(b));
    for(let i=0;i<611;i++)assert.equal(await first.create(message(i)),true);
    const stale=await second.load('delivery000000');
    assert.equal(await first.save(stale.id,{...stale,state:'sent',version:2},1),true);
    assert.equal(await second.save(stale.id,{...stale,state:'uncertain',version:2},1),false);
    assert.equal((await second.load('delivery000000')).state,'sent');
    const report=await createCampaignDeliveryReporter({source:second,pageSize:115,maxRecords:611})('octoberCampaign');
    assert.equal(report.complete,true);assert.equal(report.scanned,611);
    assert.equal(report.counts.sent,1);assert.equal(report.counts.pending,610);
    assert.equal(report.sentPercent,100/611);
    assert.equal(JSON.stringify(report).includes('private@example.test'),false);
  }finally{await a?.disconnect?.();await b?.disconnect?.();await rm(dir,{recursive:true,force:true});}
});
