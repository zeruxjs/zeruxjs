import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQueueService,createEmailDeliveryProcessor} from '../dist/index.js';

function fakeBull() {
  const trace=[];
  const jobs = new Map();
  const streams=[];
  class Queue {
    constructor(name){this.name=name;trace.push(['queue',name]);}
    async waitUntilReady(){}
    async add(name,data,opts={}){const j={id:opts.jobId??'1',name,data,attemptsMade:0,async getState(){return this.state??'failed';},async retry(state){trace.push(['retry',this.id,state]);this.state='waiting';}};jobs.set(j.id,j);return j;}
    async addBulk(){return [];}
    async getJob(id){return jobs.get(id)??null;}
    async getJobCounts(){return {waiting:1,failed:1};}
    async getJobs(states,start,end){trace.push(['getJobs',states,start,end]);return [...jobs.values()].slice(start,end+1);}
    async pause(){trace.push(['pause',this.name]);}
    async resume(){trace.push(['resume',this.name]);}
    async close(){trace.push(['closeQueue',this.name]);}
  }
  class Worker {
    constructor(name){this.name=name;trace.push(['worker',name]);}
    on(){return this;}
    async close(){trace.push(['closeWorker',this.name]);}
    async pause(){trace.push(['pauseWorker',this.name]);}
    resume(){trace.push(['resumeWorker',this.name]);}
  }
  class QueueEvents {
    constructor(name,opts){this.name=name;this.opts=opts;this.handlers={};streams.push(this);}
    on(event,cb){this.handlers[event]=cb;return this;}
    async waitUntilReady(){trace.push(['readyEvents',this.name]);}
    async close(){trace.push(['closeEvents',this.name]);}
  }
  return {factory:{Queue,Worker,QueueEvents},trace,jobs,streams};
}
test('queue administration defaults to deny-all and cannot leak payload from inspection',async()=>{
  const fake=fakeBull();
  const svc=await createQueueService({redis:{host:'localhost'},queues:['emails']},fake.factory);
  await svc.queue('emails').add('deliver',{password:'private',email:'private@example.com'},{jobId:'safe1'});
  await assert.rejects(svc.operations.inspect('emails',{},{}),/forbidden/);
  await assert.rejects(svc.operations.retryFailed('emails','safe1',{}),/forbidden/);
  await assert.rejects(svc.operations.pauseQueue('emails',{}),/forbidden/);
  assert.equal(fake.trace.filter(x=>x[0]==='retry').length,0);
  await svc.close();
});
test('authorized controls are bounded, replay-safe, and locally separate from global queue pause',async()=>{
  const fake=fakeBull(),audit=[],auth=[];
  const svc=await createQueueService({redis:{host:'localhost'},queues:['emails'],workers:{emails:{processor:async()=>{}}},administration:{
    authorize:async(action,name,ctx)=>{auth.push([action,name]);return ctx?.role==='operator'},
    onAudit:e=>audit.push(e),maxPageSize:2
  }},fake.factory);
  await svc.queue('emails').add('send',{secret:'DONT-LEAK'},{jobId:'mail1'});
  await assert.rejects(svc.operations.inspect('emails',{},{}),/forbidden/);
  const ctx={role:'operator'};
  const result=await svc.operations.inspect('emails',{states:['failed'],start:0,limit:2},ctx);
  assert.equal(result.jobs[0].id,'mail1');assert.equal(result.jobs[0].state,'failed');
  assert.equal(JSON.stringify(result).includes('DONT-LEAK'),false);
  await assert.rejects(svc.operations.inspect('emails',{limit:3},ctx),/Invalid inspection limit/);
  await assert.rejects(svc.operations.inspect('emails',{states:['__proto__']},ctx),/Invalid job states/);
  await svc.operations.retryFailed('emails','mail1',ctx);
  assert.equal(fake.trace.filter(x=>x[0]==='retry').length,1);
  await assert.rejects(svc.operations.retryFailed('emails','mail1',ctx),/Only failed/);
  await svc.operations.pauseQueue('emails',ctx);await svc.operations.resumeQueue('emails',ctx);
  await svc.operations.pauseWorker('emails',ctx);await svc.operations.resumeWorker('emails',ctx);
  assert.deepEqual(fake.trace.filter(x=>['pause','resume','pauseWorker','resumeWorker'].includes(x[0])).map(x=>x[0]),['pause','resume','pauseWorker','resumeWorker']);
  assert.ok(audit.some(x=>x.action==='retry'&&x.success===true));
  assert.ok(audit.some(x=>x.action==='retry'&&x.success===false));
  assert.deepEqual((await svc.snapshot()).emails.counts,{waiting:1,failed:1});
  await svc.close();
});
test('QueueEvents contain no job content, close with service, and callback throws cannot break stream',async()=>{
 const f=fakeBull(),received=[];
 const svc=await createQueueService({redis:{url:'redis://localhost'},queues:['q'],events:{enabled:true,onEvent:e=>{received.push(e);throw Error('logger broke');}}},f.factory);
 assert.equal(f.streams.length,1);
 f.streams[0].handlers.failed({jobId:'abc',failedReason:'PRIVATE'});
 assert.deepEqual(Object.keys(received[0]).sort(),['at','jobId','queue','type']);
 assert.equal(JSON.stringify(received).includes('PRIVATE'),false);
 assert.equal((await svc.snapshot()).q.events,true);
 await svc.close();
 assert.ok(f.trace.findIndex(x=>x[0]==='closeEvents') < f.trace.findIndex(x=>x[0]==='closeQueue'));
});
test('queue startup rolls back events if stream readiness fails',async()=>{
 const f=fakeBull();
 class BadEvents extends f.factory.QueueEvents {async waitUntilReady(){throw Error('events offline');}}
 await assert.rejects(createQueueService({redis:{host:'localhost'},queues:['q'],events:{enabled:true}},{...f.factory,QueueEvents:BadEvents}),/events offline/);
 assert.equal(f.trace.filter(x=>x[0]==='closeEvents').length,1);
 assert.equal(f.trace.filter(x=>x[0]==='closeQueue').length,1);
});
test('queued email adapter checks CURRENT marketing consent and never changes tracking',async()=>{
 const actions=[];const messages=new Map([
  ['market',{id:'market',purpose:'marketing',recipient:'member@example.com'}],
  ['receipt',{id:'receipt',purpose:'transactional'}]
 ]);
 let optIn=false;
 const processor=createEmailDeliveryProcessor({
  load:async id=>messages.get(id),isSubscribed:async to=>{actions.push('consent:'+to);return optIn;},
  suppress:async(id,reason)=>{actions.push('suppressed:'+id+':'+reason);},
  deliver:async id=>{actions.push('delivered:'+id);return 'sent';}
 });
 assert.deepEqual(await processor({name:'email.deliver',data:{messageId:'market'}}),{status:'suppressed'});
 assert.deepEqual(actions,['consent:member@example.com','suppressed:market:unsubscribed']);
 optIn=true;
 assert.deepEqual(await processor({name:'email.deliver',data:{messageId:'market'}}),{status:'sent'});
 assert.deepEqual(await processor({name:'email.deliver',data:{messageId:'receipt'}}),{status:'sent'});
 assert.equal(actions.filter(x=>x==='consent:member@example.com').length,2);
 await assert.rejects(processor({name:'email.deliver',data:{messageId:'missing'}}),/missing/);
 await assert.rejects(processor({name:'bad',data:{messageId:'receipt'}}),/Unexpected/);
 await assert.rejects(processor({name:'email.deliver',data:{messageId:'../../../etc'}}),/Invalid/);
});
test('consent outage fails closed and cannot deliver marketing mail',async()=>{
 let sent=false;
 const processor=createEmailDeliveryProcessor({load:async id=>({id,purpose:'marketing',recipient:'a@example.com'}),isSubscribed:async()=>{throw Error('db offline');},suppress:async()=>{},deliver:async()=>{sent=true;return 'sent';}});
 await assert.rejects(processor({name:'email.deliver',data:{messageId:'market'}}),/db offline/);
 assert.equal(sent,false);
});

test('enqueueEmailById stores only opaque DB ID with safe retry options',async()=>{
 const {enqueueEmailById}=await import('../dist/index.js');
 const f=fakeBull();const svc=await createQueueService({redis:{host:'localhost'},queues:['emails']},f.factory);
 const queued=await enqueueEmailById(svc.queue('emails'),'mail_234',{delay:2000});
 assert.deepEqual(queued.data,{messageId:'mail_234'});
 assert.equal(queued.id,'email-mail_234');
 assert.equal(queued.name,'email.deliver');
 await assert.rejects(enqueueEmailById(svc.queue('emails'),'user@example.com'),/Invalid/);
 await assert.rejects(enqueueEmailById(svc.queue('emails'),'msg',{delay:-3}),/Invalid/);
 await svc.close();
});
