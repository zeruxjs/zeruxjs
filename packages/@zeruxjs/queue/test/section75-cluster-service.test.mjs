import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQueueService} from '../dist/index.js';
import {createBullMQRedisClusterConnections} from '../../cache-redis/dist/index.js';
const setup=()=>{
 const clients=[];let sequence=0;
 class Cluster{
   constructor(nodes,opts){this.nodes=nodes;this.opts=opts;this.id=++sequence;this.closed=false;clients.push(this);}
   async quit(){this.closed=true;}
 }
 class Queue{
   constructor(name,opts){this.name=name;this.opts=opts;}
   async waitUntilReady(){}
   async getJobCounts(){return {waiting:0};}
   async close(){}
 }
 class Worker{
   constructor(name,handler,opts){this.opts=opts;}
   on(){return this;}
   async close(){}
 }
 return {Cluster,driver:{Queue,Worker},clients};
};
test('real Cluster objects are distinct, hash-tagged and owned through managed shutdown',async()=>{
 const f=setup();
 const config={redis:{cluster:{nodes:[{host:'127.0.0.1',port:7000},{host:'127.0.0.1',port:7001}]},password:'secret'},prefix:'{tenant_75}',queues:['work'],workers:{work:{processor:async()=>{}}}};
 const service=await createQueueService(config,f.driver,f.Cluster);
 try{
   assert.equal(f.clients.length,2);
   assert.notEqual(f.clients[0],f.clients[1]);
   assert.equal(f.clients[0].opts.redisOptions.maxRetriesPerRequest,1);
   assert.equal(f.clients[0].opts.redisOptions.enableOfflineQueue,false);
   assert.equal(f.clients[1].opts.redisOptions.maxRetriesPerRequest,null);
   assert.equal(f.clients[1].opts.redisOptions.enableOfflineQueue,true);
   assert.deepEqual(await service.health(),{work:true});
 }finally{await service.close();}
 assert.deepEqual(f.clients.map(x=>x.closed),[true,true]);
});
test('cluster mode refuses non-hash-tagged prefix and standalone/conflicting settings',async()=>{
 const f=setup();
 const base={redis:{cluster:{nodes:[{host:'localhost',port:7000}]}},queues:['q']};
 await assert.rejects(createQueueService(base,f.driver,f.Cluster),/hash-tagged/);
 await assert.rejects(createQueueService({...base,prefix:'plain'},f.driver,f.Cluster),/hash-tagged/);
 await assert.rejects(createQueueService({...base,prefix:'{same}',redis:{...base.redis,url:'redis://localhost'}},f.driver,f.Cluster),/cannot specify standalone/);
 assert.throws(()=>createBullMQRedisClusterConnections({...base.redis,cluster:{nodes:[{host:'localhost',port:70000}]}},f.Cluster),/seed node/);
 assert.equal(f.clients.length,0);
});
test('cluster connections close on queue startup failure',async()=>{
 const f=setup();class BadQueue extends f.driver.Queue{async waitUntilReady(){throw new Error('cluster unavailable');}}
 await assert.rejects(createQueueService({redis:{cluster:{nodes:[{host:'localhost',port:7000}]}},prefix:'{test}',queues:['q']},{...f.driver,Queue:BadQueue},f.Cluster),/cluster unavailable/);
 assert.deepEqual(f.clients.map(x=>x.closed),[true,true]);
});
