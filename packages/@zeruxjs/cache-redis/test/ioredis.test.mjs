import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCacheHelper,createBullMQRedisOptions,createIORedisCacheHelper} from '../dist/index.js';
class FakeIO {
 values=new Map();closed=0;
 async get(k){return this.values.get(k)??null;}
 async set(k,v,...args){if(args.includes('NX')&&this.values.has(k))return null;if(args.includes('XX')&&!this.values.has(k))return null;this.values.set(k,v);return 'OK';}
 async del(...keys){let count=0;for(const key of keys) if(this.values.delete(key))count++;return count;}
 async exists(k){return this.values.has(k)?1:0;}
 async mget(...keys){return keys.map(k=>this.values.get(k)??null);}
 async mset(items){for(const [key,value] of Object.entries(items))this.values.set(key,value);}
 async incrby(k,n){const value=Number(this.values.get(k)??0)+n;this.values.set(k,String(value));return value;}
 async decrby(k,n){return this.incrby(k,-n);}
 async expire(){return 1;}
 async scan(cursor,...options){return ['0',[...this.values.keys()]];}
 async flushdb(){this.values.clear();}
 async quit(){this.closed++;}
 on(){return this;}
}
test('ioredis adapter handles JSON, SET NX, mget and safe SCAN namespacing',async()=>{
 const db=new FakeIO();const adapter=await createCacheHelper({driver:'ioredis',client:db});
 await adapter.set('shop:1',{stock:3});await adapter.set('shop:1',{stock:4},{ifAbsent:true});
 assert.deepEqual(await adapter.get('shop:1'),{stock:3});
 await adapter.setMany({'shop:2':false,'other:2':9});
 assert.deepEqual({...await adapter.getMany(['shop:2','missing'])},{'shop:2':false,missing:undefined});
 await adapter.clearPrefix('shop');assert.equal(await adapter.get('shop:1'),undefined);assert.equal(await adapter.get('other:2'),9);
 await assert.rejects(adapter.clear(),/disabled/);
 await adapter.close();assert.equal(db.closed,0);
 const owned=createIORedisCacheHelper(db,{ownClient:true});await owned.close();assert.equal(db.closed,1);
});
test('BullMQ connection options reject keyPrefix and separate producer and worker retry policies',()=>{
 const pair=createBullMQRedisOptions({url:'redis://:secret@cache:6379/0'});
 assert.equal(pair.producer.password,'secret');assert.equal(pair.producer.maxRetriesPerRequest,1);
 assert.equal(pair.worker.maxRetriesPerRequest,null);assert.equal(pair.worker.enableOfflineQueue,true);
 assert.throws(()=>createBullMQRedisOptions({host:'localhost',keyPrefix:'queue:'}),/keyPrefix/);
 assert.throws(()=>createBullMQRedisOptions({url:'http://localhost'}),/redis:/);
 assert.throws(()=>createBullMQRedisOptions({url:'redis://localhost/xyz'}),/Invalid Redis database/);
});
