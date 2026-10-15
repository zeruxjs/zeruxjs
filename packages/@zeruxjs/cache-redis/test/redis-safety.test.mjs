import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createRedisCacheHelper, createCacheHelper}=require('../dist/index.js');
const {createCacheManagerWithHelper}=require('@zeruxjs/cache');
class FakeRedis {
  values=new Map(); ttl=new Map(); flushes=0; scans=0;
  async get(k){return this.values.get(k)??null}
  async set(k,v,opts={}){if(opts.NX&&this.values.has(k))return null;if(opts.XX&&!this.values.has(k))return null;this.values.set(k,v);if(opts.EX)this.ttl.set(k,opts.EX);return 'OK'}
  async del(keys){let n=0;for(const k of Array.isArray(keys)?keys:[keys])if(this.values.delete(k))n++;return n}
  async exists(k){return this.values.has(k)?1:0}
  async mGet(keys){return keys.map(k=>this.values.get(k)??null)}
  async mSet(obj){for(const [k,v] of Object.entries(obj))this.values.set(k,v)}
  async incrBy(k,n){const v=Number(this.values.get(k)||0)+n;this.values.set(k,String(v));return v}
  async decrBy(k,n){const v=Number(this.values.get(k)||0)-n;this.values.set(k,String(v));return v}
  async expire(k,t){if(!this.values.has(k))return 0;this.ttl.set(k,t);return 1}
  async *scanIterator(){this.scans++;const keys=[...this.values.keys()];yield keys.slice(0,2);yield keys.slice(2)}
  async flushDb(){this.flushes++;this.values.clear()}
}
test('namespace scan clears only owned keys, even if SCAN overmatches',async()=>{
 const db=new FakeRedis();const adapter=createRedisCacheHelper(db);
 const a=createCacheManagerWithHelper(adapter,{prefix:'app*'});
 const b=createCacheManagerWithHelper(adapter,{prefix:'other'});
 await a.set('id',1);await b.set('id',2);await db.set('app*not-a-child','survive');
 assert.deepEqual(await a.getMany(['id']),Object.assign(Object.create(null),{id:1}));
 await a.clear();assert.equal(await a.get('id'),undefined);assert.equal(await b.get('id'),2);
 assert.equal(await db.get('app*not-a-child'),'survive');assert.equal(db.flushes,0);
 await assert.rejects(adapter.clear(),/FLUSHDB is disabled/);
});
test('TTL, conditional writes, atomic counters and injected client',async()=>{
 const db=new FakeRedis();const adapter=await createCacheHelper({client:db});
 await adapter.set('v',1,{ttlSeconds:1.3});assert.equal(db.ttl.get('v'),2);
 assert.equal(await adapter.increment('v',2),3);assert.equal(await adapter.decrement('v',1),2);
 await adapter.set('v','wrong',{ifAbsent:true});assert.equal(await adapter.get('v'),2);
 await adapter.set('missing',2,{ifPresent:true});assert.equal(await adapter.has('missing'),false);
 assert.equal(await adapter.touch('v',3),true);assert.equal(await adapter.touch('missing',3),false);
 await adapter.setMany({hello:{a:1}, hi:true},{ttlSeconds:3});assert.equal(db.ttl.get('hello'),3);
 assert.equal(await adapter.deleteMany(['hello','hi']),2);
 await assert.rejects(adapter.clear(),/disabled/);
 await assert.rejects(adapter.set('bad',1,{ttlSeconds:1e40}),/range/);
 await assert.rejects(adapter.increment('v',0.3),/integer/);
});
