// Release CAS parity with two real SQLite connections. Run after workspace build:
// node --test tests/integration/tags-sqlite.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createDatabaseDocumentStore} from '@zeruxjs/analytics';
import {emptyTagContainer,saveTagDraft,publishTagDraft,rollbackTagRelease,publishedContainer,releaseSummary} from '@zeruxjs/tags';

const connection={slug:'tagdb',connector:'sqlite',options:{},name:'Tag governance'};
function adapter(driver){
  return {
    createTable:op=>driver.execute({...op,op:'createTable'},{connection}),
    insert:op=>driver.execute({...op,op:'insert'},{connection}),
    select:op=>driver.execute({...op,op:'select'},{connection}),
    update:op=>driver.execute({...op,op:'update'},{connection})
  };
}
test('two real SQLite connections atomically draft, publish and rollback releases',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'zerux-tags-'));
  const filename=join(directory,'tags.sqlite');
  let first,second;
  try{
    first=await createConnector({filename,driver:'node'},connection);
    second=await createConnector({filename,driver:'node'},connection);
    const a=createDatabaseDocumentStore(adapter(first),'analytics_tag_containers','site_one',emptyTagContainer('site_one'));
    const b=createDatabaseDocumentStore(adapter(second),'analytics_tag_containers','site_one',emptyTagContainer('site_one'));
    assert.equal((await a.load()).version,1);
    assert.equal((await b.load()).version,1);
    const draft={...await a.load(),version:2,name:'new site'};
    assert.equal(await saveTagDraft(a,draft,1),true);
    assert.equal((await b.load()).version,2);
    assert.equal((await b.load()).governance.published.name,'Default');
    assert.equal(await saveTagDraft(b,{...draft,name:'conflicting'},1),false);
    assert.equal(await publishTagDraft(b,2),true);
    assert.equal((await publishedContainer(await a.load())).name,'new site');
    assert.equal(await publishTagDraft(a,2),false);
    assert.equal(await rollbackTagRelease(a,3,1),true);
    assert.equal((await publishedContainer(await b.load())).name,'Default');
    assert.deepEqual(releaseSummary(await b.load()).history.map(h=>h.action),['initial','publish','rollback']);
    const database=first.getNativeConnection();
    assert.equal(database.prepare('SELECT COUNT(*) as n FROM analytics_tag_containers').get().n,1);
  }finally{
    await first?.disconnect?.();await second?.disconnect?.();await rm(directory,{recursive:true,force:true});
  }
});
