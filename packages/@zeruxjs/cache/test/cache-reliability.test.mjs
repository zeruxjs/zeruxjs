import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMemoryCacheHelper, createCacheManagerWithHelper, createCacheManager } = require('../dist/index.js');

test('TTL, LRU, copy isolation, namespace clear and counters', async () => {
  let now = 10000;
  const adapter = createMemoryCacheHelper({maxEntries:3, now:()=>now});
  const a = createCacheManagerWithHelper(adapter,{prefix:'tenantA'});
  const b = createCacheManagerWithHelper(adapter,{prefix:'tenantB'});
  const value = {children:[1]};
  await a.set('v',value,{ttlSeconds:1}); value.children.push(2);
  assert.deepEqual(await a.get('v'),{children:[1]});
  (await a.get('v')).children.push(3);
  assert.deepEqual(await a.get('v'),{children:[1]});
  await b.set('v', 'keep');
  const values = await a.getMany(['v','absent','__proto__']);
  assert.deepEqual(values.v,{children:[1]});
  assert.ok(Object.hasOwn(values,'__proto__'));
  await a.clear();
  assert.equal(await a.get('v'),undefined);
  assert.equal(await b.get('v'),'keep');
  assert.equal(await a.increment('count',4),4);
  assert.equal(await a.decrement('count',3),1);
  await a.touch('count',2); now += 2100;
  assert.equal(await a.get('count'),undefined);
  await a.set('exp',1,{ttlSeconds:1}); now += 1001;
  assert.equal(await a.has('exp'),false);
  assert.ok(adapter.stats().misses>0);
});

test('conditional writes, LRU eviction and invalid inputs', async () => {
  const a = createCacheManagerWithHelper(createMemoryCacheHelper({maxEntries:2}));
  await a.set('k','first',{ifAbsent:true});
  await a.set('k','second',{ifAbsent:true});
  assert.equal(await a.get('k'),'first');
  await a.set('not-yet','bad',{ifPresent:true});
  assert.equal(await a.get('not-yet'),undefined);
  await a.set('k','second',{ifPresent:true});
  await a.set('l',2);
  await a.get('k');
  await a.set('m',3);
  assert.equal(await a.get('l'),undefined);
  assert.throws(()=>a.increment('k',0.2), /integer/);
  assert.throws(()=>a.set('x',1,{ttlSeconds:0}), /ttlSeconds/);
});

test('remember coalesces concurrent misses but not failed producers', async () => {
  const manager = createCacheManagerWithHelper(createMemoryCacheHelper());
  let calls=0;
  const producer=async()=>{calls++;await new Promise(r=>setTimeout(r,8));return {works:true}};
  const result=await Promise.all(Array.from({length:12},()=>manager.remember('id',producer)));
  assert.equal(calls,1);
  assert.equal(result.length,12);
  assert.deepEqual(await manager.get('id'),{works:true});
  await assert.rejects(manager.remember('err',()=>{throw Error('offline')}),/offline/);
  assert.equal(await manager.remember('err',()=>5),5);
});

test('namespace clearing fails closed when helper lacks clearPrefix', async()=>{
  const stub=createMemoryCacheHelper();
  const { clearPrefix, ...unsafe }=stub;
  const manager=createCacheManagerWithHelper(unsafe,{prefix:'safe'});
  assert.throws(()=>manager.clear(),/cannot safely clear/);
});

test('built-in memory helper works through normal cache config',async()=>{
 const a=await createCacheManager({helper:'memory',prefix:'project',options:{maxEntries:2}});
 await a.set('message','cached');
 assert.equal(await a.get('message'),'cached');
 await a.clear();
 assert.equal(await a.get('message'),undefined);
});
