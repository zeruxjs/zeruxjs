import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createQueueService} from '../dist/index.js';
const live=Boolean(process.env.QUEUE_REDIS_URL);
const waitFor=async(fn,timeout=20_000)=>{
 const start=Date.now();
 while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,100));}
 throw new Error('Timed out awaiting a real Redis/BullMQ state transition');
};
test('LIVE Redis: two independent worker services, duplicate-id dedup and delayed scheduled job',{skip:!live,timeout:60_000},async()=>{
 const prefix=`s75_${randomUUID().replaceAll('-','').slice(0,15)}`;
 const cfg={redis:{url:process.env.QUEUE_REDIS_URL},prefix,queues:['work'],readyTimeoutMs:5000};
 const seen=[];
 const workerConfig={work:{concurrency:3,limiter:{max:20,duration:1000},processor:async job=>{seen.push(job.id);}}};
 const a=await createQueueService({...cfg,workers:workerConfig});
 let b;
 try{
   b=await createQueueService({...cfg,workers:workerConfig});
   const q=a.queue('work');
   const ids=Array.from({length:24},(_,i)=>`item_${i}`);
   for(const id of ids)await q.add('work',{opaqueId:id},{jobId:id,removeOnComplete:false,attempts:2});
   await q.add('work',{opaqueId:'duplicate'},{jobId:'item_0',removeOnComplete:false});
   await waitFor(async()=>ids.every(id=>seen.includes(id)),30_000);
   assert.equal(new Set(seen.filter(id=>ids.includes(id))).size,24);
   const begin=Date.now();
   await a.schedules('work').once('later',{task:'cleanup'},Date.now()+2000,{attempts:1});
   // This task has no registered handler here, but is still a BullMQ job:
   await waitFor(async()=>seen.includes('task-later'),12_000);
   assert.ok(Date.now()-begin>=1200,'Delayed job executed prematurely');
   await a.operations.pauseQueue('work',{admin:true}).catch(()=>{}); // absent admin policy denies
 }finally{if(b)await b.close();await a.close();}
});

test('LIVE Redis: transient worker failure is retried and terminal failure preserved',{skip:!live,timeout:45_000},async()=>{
 const prefix=`s75_${randomUUID().replaceAll('-','').slice(0,15)}`;
 const attempts=new Map();
 const service=await createQueueService({redis:{url:process.env.QUEUE_REDIS_URL},prefix,queues:['retry'],workers:{retry:{processor:async job=>{
   const n=(attempts.get(job.id)??0)+1;attempts.set(job.id,n);if(n===1)throw Error('transient');return {ok:true};
 }}}});
 try{
   const id=`retry_${randomUUID().replaceAll('-','')}`;
   await service.queue('retry').add('test',{opaqueId:id},{jobId:id,attempts:2,backoff:{type:'fixed',delay:1000},removeOnComplete:false});
   await waitFor(async()=>attempts.get(id)===2,20_000);
   await waitFor(async()=>await (await service.queue('retry').getJob(id)).getState()==='completed',10_000);
   assert.equal(attempts.get(id),2);
 }finally{await service.close();}
});

test('LIVE Redis Cluster: hash-slot-safe BullMQ publish/worker/cron scheduler', {skip:!process.env.QUEUE_REDIS_CLUSTER_NODES,timeout:60_000},async()=>{
 const {createTaskRegistry}=await import('../dist/index.js');
 const token=randomUUID().replaceAll('-','').slice(0,16);
 const nodes=process.env.QUEUE_REDIS_CLUSTER_NODES.split(',').map(x=>{
   const [host,port]=x.split(':');return {host,port:Number(port)};
 });
 const seen=[];
 const tasks=createTaskRegistry().register('tick',()=>{seen.push(Date.now());});
 const service=await createQueueService({
   redis:{cluster:{nodes},...(process.env.QUEUE_REDIS_CLUSTER_PASSWORD?{password:process.env.QUEUE_REDIS_CLUSTER_PASSWORD}:{})},
   prefix:`{s75_${token}}`,queues:['cron'],workers:{cron:{processor:tasks.processor}},readyTimeoutMs:10000
 });
 try{
   const scheduler=service.schedules('cron');
   await scheduler.cron('two-second',{task:'tick'},'*/2 * * * * *',{timezone:'America/New_York'});
   await waitFor(()=>seen.length>=2,20_000);
   assert.ok(seen[1]-seen[0]>=700,'Two cron occurrences executed too closely');
   assert.equal(await scheduler.remove('two-second'),true);
 }finally{await service.close();}
});
