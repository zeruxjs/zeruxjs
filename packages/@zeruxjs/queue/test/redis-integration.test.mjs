import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createQueueService} from '../dist/index.js';
// Opt-in: QUEUE_REDIS_URL=redis://127.0.0.1:6379 npm test
// Requires installed BullMQ/ioredis and a dedicated non-production Redis instance.
test('real Redis/BullMQ producer and worker integration', {skip:!process.env.QUEUE_REDIS_URL}, async()=>{
 const prefix='ztest_'+randomUUID().replaceAll('-','').slice(0,15);
 let jobComplete;
 const completed=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Worker did not complete within 10 seconds')),10_000);
   jobComplete=value=>{clearTimeout(timer);resolve(value);};
 });
 const processed=[];
 const service=await createQueueService({
   redis:{url:process.env.QUEUE_REDIS_URL},prefix,queues:['integration'],readyTimeoutMs:5000,
   workers:{integration:{processor:async job=>{processed.push(job.id);jobComplete(job.data);return {ok:true};}}}
 });
 try {
   const job=await service.queue('integration').add('run',{marker:'live'},{jobId:`section52-${randomUUID()}`,removeOnComplete:true});
   assert.ok(job.id);
   assert.deepEqual(await completed,{marker:'live'});
   assert.deepEqual(processed,[job.id]);
 } finally {await service.close();}
});
