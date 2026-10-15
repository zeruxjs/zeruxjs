import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQueueService,createQueueTaskScheduler,createTaskRegistry} from '../dist/index.js';
const fake=()=>{
  const schedules=new Map(),jobs=new Map(),actions=[];
  class Queue{
    async waitUntilReady(){}
    async close(){}
    async add(name,data,options){const id=options?.jobId??'one';const job={id,name,data,getState:async()=> 'delayed',remove:async()=>{jobs.delete(id);}};jobs.set(id,job);return job;}
    async getJob(id){return jobs.get(id)??null;}
    async upsertJobScheduler(id,repeat,template){schedules.set(id,{id,repeat,template});return {id};}
    async removeJobScheduler(id){return schedules.delete(id);}
    async getJobSchedulers(start,end){return [...schedules.values()].slice(start,end+1).map(s=>({id:s.id,name:s.template.name,next:123,payload:'secret'}));}
    async getJobCounts(){return {waiting:jobs.size};}
    async pause(){}async resume(){}
  }
  class Worker{on(){return this;}async close(){}}
  return {driver:{Queue,Worker},schedules,jobs,actions};
};
test('schedule administration is per action and per queue, redacted, and audited',async()=>{
  const f=fake();const audit=[];
  const svc=await createQueueService({redis:{host:'localhost'},queues:['tenant-a','tenant-b'],
    administration:{authorize:(action,name,ctx)=>ctx?.tenant===name&&ctx.permissions?.includes(action),onAudit:e=>audit.push(e)}},f.driver);
  try{
    const admin={tenant:'tenant-a',permissions:['schedule-create','schedule-inspect','schedule-remove']};
    const read={tenant:'tenant-a',permissions:['schedule-inspect']};
    await assert.rejects(svc.operations.scheduleCron('tenant-b','nightly',{task:'task'},'0 0 * * *',admin),/forbidden/);
    await assert.rejects(svc.operations.scheduleCron('tenant-a','nightly',{task:'task'},'0 0 * * *',read),/forbidden/);
    const result=await svc.operations.scheduleCron('tenant-a','nightly',{task:'task'},'0 0 * * *',admin,{timezone:'Asia/Kolkata'});
    assert.equal(result.id,'nightly');assert.equal(f.schedules.get('nightly').repeat.tz,'Asia/Kolkata');
    assert.deepEqual(await svc.operations.listSchedules('tenant-a',{},read),[{id:'nightly',name:'zerux.task',next:123}]);
    assert.equal(await svc.operations.removeSchedule('tenant-a','nightly',admin),true);
    await svc.operations.scheduleOnce('tenant-a','once1',{task:'task'},Date.now()+30_000,admin);
    assert.equal(await svc.operations.cancelOneOff('tenant-a','once1',admin),true);
    assert.ok(audit.every(e=>e.queue==='tenant-a'&&!('payload' in e)));
    assert.deepEqual(audit.map(e=>e.action),['schedule-create','schedule-inspect','schedule-remove','schedule-create','schedule-remove']);
  }finally{await svc.close();}
});
test('job retry/retention/dedup and worker lock settings are checked before Redis',async()=>{
 const f=fake(),svc=await createQueueService({redis:{host:'localhost'},queues:['q']},f.driver);
 try{
   for(const opts of [{attempts:-1},{backoff:{type:'evil',delay:20}},{delay:1e20},{deduplication:{id:'bad:colon'}},{removeOnFail:{age:-3}},{repeat:{every:0}},{jobId:'a'.repeat(200)}]){
     assert.throws(()=>svc.queue('q').add('job',{},opts),/Invalid|Repeat interval/);
   }
 }finally{await svc.close();}
 for(const lockDuration of [0,-100,900000])await assert.rejects(createQueueService({redis:{host:'localhost'},queues:['q'],workers:{q:{processor:async()=>{},lockDuration}}},f.driver),/lock duration/);
});
test('scheduled registry rejects nested unsafe properties, over-deep objects, and arbitrary handler names',async()=>{
 const registry=createTaskRegistry();registry.register('safe',async data=>data);
 const malicious=JSON.parse('{"safe":{"nested":{"__proto__":{"unsafe":true}}}}');
 const s=createQueueTaskScheduler({async add(_name,data){return {id:'x',data};}});
 assert.throws(()=>s.once('once',{task:'safe',data:malicious},Date.now()+30_000),/Unsafe/);
 const nested={};let at=nested;for(let i=0;i<40;i++){at.child={};at=at.child;}
 assert.throws(()=>s.once('once',{task:'safe',data:nested},Date.now()+30_000),/nesting/);
 await assert.rejects(registry.processor({name:'zerux.task',data:{task:'missing',payload:{}}}),/Unregistered/);
});
