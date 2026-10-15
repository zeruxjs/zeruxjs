import {test} from 'node:test';import assert from 'node:assert/strict';
import {createQueueTaskScheduler,createTaskRegistry,createQueueService} from '../dist/index.js';
const make=()=>{
 const schedules=new Map(),calls=[];
 const queue={
  async add(name,data,opts){calls.push(['add',name,data,opts]);return {id:opts?.jobId??'job'};},
  async upsertJobScheduler(id,repeat,template){schedules.set(id,{id,repeat,template});return {id};},
  async removeJobScheduler(id){return schedules.delete(id);},
  async getJobSchedulers(){return [...schedules.values()].map(x=>({id:x.id,name:x.template.name,next:123,secret:'must-not-expose'}));}
 };
 return {queue,schedules,calls};
};
test('one-off, interval and cron tasks are registered through durable BullMQ scheduler',async()=>{
 const f=make(),scheduler=createQueueTaskScheduler(f.queue);
 await scheduler.once('nightly1',{task:'sync',data:{limit:2}},Date.now()+60000);
 assert.equal(f.calls[0][1],'zerux.task');assert.equal(f.calls[0][2].task,'sync');
 await scheduler.every('hourly1',{task:'sync'},60000,{limit:3});
 await scheduler.cron('morning1',{task:'sync'},'0 6 * * *',{timezone:'Asia/Kolkata'});
 assert.equal(f.schedules.get('hourly1').repeat.every,60000);
 assert.equal(f.schedules.get('morning1').repeat.tz,'Asia/Kolkata');
 assert.deepEqual((await scheduler.list()).map(i=>Object.keys(i).sort()),[['id','name','next'],['id','name','next']]);
 assert.equal(await scheduler.remove('hourly1'),true);
});
test('scheduler rejects malformed IDs, data, cron, dates and timezone',async()=>{
 const s=createQueueTaskScheduler(make().queue);
 assert.throws(()=>s.once('bad:id',{task:'ok'},Date.now()+40000),/schedule ID/);
 assert.throws(()=>s.once('ok',{task:'foo'},Date.now()-1),/Scheduled execution/);
 assert.throws(()=>s.cron('ok',{task:'foo'},'* * * * *',{timezone:'Not/AZone'}),/timezone/);
 assert.throws(()=>s.cron('ok',{task:'foo'},'curl https://evil.test'),/cron/);
 assert.throws(()=>s.every('ok',{task:'foo'},99),/interval/);
 assert.throws(()=>s.every('ok',{task:'foo',data:{large:'x'.repeat(9000)}},1000),/8 KiB/);
});
test('task registry invokes only explicitly registered code, and rejects unknown handlers',async()=>{
 const reg=createTaskRegistry();reg.register('purge',async data=>data.count+2);
 assert.equal(await reg.processor({name:'zerux.task',data:{task:'purge',payload:{count:5}},attemptsMade:1}),7);
 await assert.rejects(reg.processor({name:'zerux.task',data:{task:'remote',payload:{}}}),/Unregistered/);
 assert.throws(()=>reg.register('purge',()=>{}),/duplicate/);
 await assert.rejects(reg.processor({name:'other',data:{task:'purge'}}),/Unexpected/);
});
test('service schedules are invalidated after shutdown and are redis-backed',async()=>{
 const f=make();
 class Queue{constructor(){this.api=f.queue;}async waitUntilReady(){} async add(...x){return f.queue.add(...x);} async upsertJobScheduler(...x){return f.queue.upsertJobScheduler(...x);} async getJobSchedulers(...x){return f.queue.getJobSchedulers(...x);} async removeJobScheduler(...x){return f.queue.removeJobScheduler(...x);} async close(){} }
 class Worker{on(){return this;} async close(){}}
 const svc=await createQueueService({redis:{host:'localhost'},queues:['tasks']},{Queue,Worker});
 await svc.schedules('tasks').cron('daily',{task:'purge'},'0 0 * * *');
 assert.equal(f.schedules.size,1);await svc.close();
 assert.throws(()=>svc.schedules('tasks').list(),/closed/);
});
test('worker rate limiting is passed to BullMQ and validated per queue',async()=>{
 const seen=[];
 class Queue{async waitUntilReady(){}async close(){}}
 class Worker{constructor(_name,_fn,opts){seen.push(opts);}on(){return this;}async close(){}}
 const opts={redis:{host:'localhost'},queues:['emails'],workers:{emails:{processor:async()=>{},limiter:{max:120,duration:60000}}}};
 const service=await createQueueService(opts,{Queue,Worker});assert.deepEqual(seen[0].limiter,{max:120,duration:60000});await service.close();
 await assert.rejects(createQueueService({...opts,workers:{emails:{processor:async()=>{},limiter:{max:0,duration:500}}}},{Queue,Worker}),/rate limit/);
});
test('one-off tasks can be canceled safely only while waiting or delayed',async()=>{
 const states=new Map();
 const q={async getJob(id){return states.get(id)??null;}};
 const s=createQueueTaskScheduler(q);
 let removed=0;
 states.set('task-later',{getState:async()=> 'delayed',remove:async()=>{removed++;states.delete('task-later');}});
 assert.equal(await s.cancelOnce('later'),true);assert.equal(removed,1);
 assert.equal(await s.cancelOnce('later'),false);
 states.set('task-running',{getState:async()=> 'active',remove:async()=>{removed++;}});
 await assert.rejects(s.cancelOnce('running'),/Only pending/);
 assert.equal(removed,1);
 states.set('task-unknown',{getState:async()=> 'waiting'});
 await assert.rejects(s.cancelOnce('unknown'),/cannot safely cancel/);
});
