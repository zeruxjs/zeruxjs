import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQueueService,createAnalyticsReconciliationProcessor} from '../dist/index.js';

const makeFake=()=>{
  const calls=[];const active=new Map();
  class Queue {
    constructor(name,opts){this.name=name;this.options=opts;calls.push(['queue',name,opts]);active.set(name,this);this.jobs=[];}
    async waitUntilReady(){calls.push(['ready',this.name]);}
    async add(name,data,options){const job={id:options?.jobId??`job-${this.jobs.length+1}`,name,data,options};this.jobs.push(job);return job;}
    async addBulk(jobs){return Promise.all(jobs.map(j=>this.add(j.name,j.data,j.opts)));}
    async getJob(id){return this.jobs.find(j=>j.id===id);}
    async getJobCounts(){return {waiting:this.jobs.length};}
    async pause(){calls.push(['pause',this.name]);}
    async resume(){calls.push(['resume',this.name]);}
    async close(){calls.push(['closeQueue',this.name]);}
  }
  class Worker {
    constructor(name,process,options){calls.push(['worker',name,options]);this.processor=process;this.callbacks={};}
    on(event,fn){this.callbacks[event]=fn;return this;}
    async close(force){calls.push(['closeWorker',force??false]);}
  }
  return {driver:{Queue,Worker},active,calls};
};
test('producer and worker use distinct Redis policies, enqueue and lifecycle close',async()=>{
 const fake=makeFake();
 const service=await createQueueService({redis:{url:'rediss://user:pwd@localhost:6380/2'},prefix:'product',queues:[{name:'emails',defaultJobOptions:{attempts:4}}],workers:{emails:{processor:async job=>job.data,concurrency:3}}},fake.driver);
 const producer=fake.calls.find(c=>c[0]==='queue')[2];
 const worker=fake.calls.find(c=>c[0]==='worker')[2];
 assert.equal(producer.connection.maxRetriesPerRequest,1);
 assert.equal(producer.connection.enableOfflineQueue,false);
 assert.equal(worker.connection.maxRetriesPerRequest,null);
 assert.equal(worker.connection.enableOfflineQueue,true);
 assert.equal(worker.connection.password,'pwd');
 assert.equal(worker.connection.db,2);assert.deepEqual(worker.connection.tls,{});
 assert.equal(producer.prefix,'product');
 assert.equal(producer.defaultJobOptions.attempts,4);
 assert.equal(producer.defaultJobOptions.removeOnComplete.count,10000);
 const queue=service.queue('emails');
 const job=await queue.add('deliver',{emailId:'mail-1'},{jobId:'mail-1',attempts:3,backoff:{type:'exponential',delay:1000}});
 assert.equal((await queue.getJob('mail-1')).id,job.id);
 assert.equal((await queue.counts('waiting')).waiting,1);
 await queue.addBulk([{name:'deliver',data:{emailId:'mail-2'}},{name:'deliver',data:{emailId:'mail-3'}}]);
 assert.equal((await queue.counts('waiting')).waiting,3);
 await queue.pause();await queue.resume();
 assert.deepEqual(await service.health(),{emails:true});
 await Promise.all([service.close(),service.close()]);
 assert.equal(fake.calls.filter(c=>c[0]==='closeWorker').length,1);
 assert.equal(fake.calls.filter(c=>c[0]==='closeQueue').length,1);
 assert.ok(fake.calls.findIndex(c=>c[0]==='closeWorker')<fake.calls.findIndex(c=>c[0]==='closeQueue'));
 assert.throws(()=>queue.add('deliver',{}),/closed/);
});
test('fail closed on bad queue/job names, missing processors and Redis key prefixes',async()=>{
 const fake=makeFake();
 for(const opts of [
   {queues:['emails','emails']},
   {queues:['emails'],workers:{missing:{processor:()=>{}}}},
   {queues:['emails'],workers:{emails:{processor:'not a function'}}},
   {queues:['bad:queue']},
   {queues:['emails'],redis:{host:'localhost',keyPrefix:'bad'}}
 ]) await assert.rejects(createQueueService({redis:{host:'localhost'},...opts},fake.driver),/Duplicate|unknown|function|Invalid|keyPrefix/);
 const manager=await createQueueService({redis:{host:'localhost'},queues:['emails']},fake.driver);
 assert.throws(()=>manager.queue('emails').add('not:valid',{}),/Invalid/);
 assert.throws(()=>manager.queue('emails').add('valid',{},{jobId:'danger:colon'}),/jobId/);
 assert.throws(()=>manager.queue('emails').add('valid',{},{repeat:{every:0}}),/Repeat interval/);
 assert.throws(()=>manager.queue('nope'),/Unknown queue/);
 await manager.close();
});
test('startup failure closes all successfully created producer queues',async()=>{
 const fake=makeFake();
 class BrokenQueue extends fake.driver.Queue {
   async waitUntilReady(){if(this.name==='b') throw new Error('Redis failed');}
 }
 await assert.rejects(createQueueService({redis:{host:'127.0.0.1'},queues:['a','b']},{...fake.driver,Queue:BrokenQueue}),/Redis failed/);
 assert.equal(fake.calls.filter(c=>c[0]==='closeQueue').length,2);
});
test('worker errors are sent to app hook and callback exceptions do not escape',async()=>{
 const fake=makeFake();let errors=[];
 const manager=await createQueueService({redis:{host:'localhost'},queues:['jobs'],workers:{jobs:{processor:async()=>{},autorun:false}},onWorkerError:(name,error)=>{errors.push([name,error.message]);throw Error('log failed');}},fake.driver);
 assert.doesNotThrow(()=>manager.worker('jobs').callbacks.error(new Error('temporary outage')));
 assert.deepEqual(errors,[['jobs','temporary outage']]);await manager.close();
});

test('analytics reconciliation worker runs only allowlisted administrative jobs',async()=>{
 const owners=[];
 const processor=createAnalyticsReconciliationProcessor({year2025:{runOnce:async owner=>{owners.push(owner);return {busy:false,state:{status:'running'}};}}});
 const result=await processor({name:'analytics.reconcile',data:{id:'year2025'}});
 assert.equal(result.status,'running');assert.match(owners[0],/^bullmq-/);
 await assert.rejects(processor({name:'analytics.reconcile',data:{id:'other'}}),/Unknown/);
 await assert.rejects(processor({name:'not_analytics',data:{id:'year2025'}}),/Unexpected/);
});
