import test from 'node:test';import assert from 'node:assert/strict';
import {createQueueService,QUEUE_JOB_LIMITS} from '@zeruxjs/queue-bullmq';
function fixture(){const log=[],workers=[],events=[];class Queue{constructor(){}async waitUntilReady(){}async add(name,data,opts){log.push(['add',data]);return {id:'one',name,data};}async addBulk(jobs){log.push(['bulk',jobs]);return jobs;}async close(){log.push('queue-close');}async upsertJobScheduler(id,repeat,template){log.push(['scheduler',template]);return {id};}}
 class Worker{constructor(name,processor){this.processor=processor;workers.push(this);}on(){return this;}async close(force){log.push(force?'force-close':'worker-close');}}
 class QueueEvents{constructor(){events.push(this);}on(){return this;}async waitUntilReady(){}async close(){log.push('events-close');}}
 return {driver:{Queue,Worker,QueueEvents},log,workers,events};}
const config={redis:{host:'localhost'},queues:['jobs']};
test('direct and bulk data snapshot/byte/count/depth checks run before any native enqueue',async()=>{
 const f=fixture(),service=await createQueueService(config,f.driver),queue=service.queue('jobs');
 try{const data={id:'one',nested:{ok:true}};const pending=queue.add('send',data);data.nested.ok=false;assert.equal((await pending).data.nested.ok,true);assert.equal(QUEUE_JOB_LIMITS.maxBulk,256);
 const bulk=await queue.addBulk([{name:'one',data:{}},{name:'two',data:{id:2}}]);assert.equal(bulk.length,2);
 const count=f.log.length;for(const data of [{large:'é'.repeat(40000)},JSON.parse('{"constructor":1}'),{fn(){}},{bad:NaN},{get secret(){throw Error('SECRET');}},new Date()])assert.throws(()=>queue.add('send',data),error=>!/SECRET/.test(error.message));
 const cycle={};cycle.cycle=cycle;assert.throws(()=>queue.add('send',cycle));const deep={};let node=deep;for(let i=0;i<34;i++)node=node.child={};assert.throws(()=>queue.add('send',deep),/nesting/);
 assert.throws(()=>queue.addBulk(Array.from({length:257},()=>({name:'send',data:{}}))),/count/);assert.throws(()=>queue.addBulk(Array.from({length:20},()=>({name:'send',data:{large:'x'.repeat(60000)}}))),/bulk byte/);
 assert.throws(()=>queue.addBulk([{name:'send',data:{}},{name:'bad:name',data:{}}]));assert.equal(f.log.length,count);
 await service.schedules('jobs').every('daily',{task:'sync',data:{id:'one'}},1000);assert.ok(f.log.some(item=>item[0]==='scheduler'));
 }finally{await service.close();}
});
test('worker counts survive force-close until processor and original native close really settle',async()=>{
 const f=fixture();let complete,finishClose;class Worker extends f.driver.Worker{close(force){if(force)return Promise.resolve();return new Promise(resolve=>finishClose=resolve);}}
 const service=await createQueueService({...config,shutdownGraceMs:5,workers:{jobs:{processor:()=>new Promise(resolve=>complete=resolve)}}},{...f.driver,Worker});
 const running=f.workers[0].processor({name:'send',data:{id:'one'}});assert.equal(service.shutdownStatus().activeProcessors,1);
 const keepAlive=setTimeout(()=>{},1000);try{await service.close();const status=service.shutdownStatus();assert.equal(status.state,'incomplete');assert.equal(status.workerDeadlines,1);assert.equal(status.forceCloseAttempts,1);assert.equal(status.activeProcessors,1);assert.equal(status.pendingClosures,1);assert.equal(JSON.stringify(status).includes('id'),false);complete();finishClose();await running;await Promise.resolve();assert.equal(service.shutdownStatus().state,'closed');}finally{clearTimeout(keepAlive);complete?.();finishClose?.();}
});
test('listener/stream startup failures close already acquired worker, events, queues and Cluster clients',async()=>{
 const f=fixture(),clusters=[];class Cluster{constructor(){clusters.push(this);}async quit(){this.closed=true;}}
 class Worker extends f.driver.Worker{on(){throw Error('listener failed');}}
 await assert.rejects(createQueueService({...config,redis:{cluster:{nodes:[{host:'localhost',port:7000}]}},prefix:'{isolated}',events:{enabled:true},workers:{jobs:{processor:async()=>{}}}},{...f.driver,Worker},Cluster),/listener failed/);
 assert.deepEqual(f.log,['worker-close','events-close','queue-close']);assert.ok(clusters.every(client=>client.closed));
 const g=fixture();class Events extends g.driver.QueueEvents{async waitUntilReady(){throw Error('stream unavailable');}}
 await assert.rejects(createQueueService({...config,events:{enabled:true}},{...g.driver,QueueEvents:Events}),/stream unavailable/);assert.deepEqual(g.log,['events-close','queue-close']);
});
test('failed owned Cluster quit uses disconnect, records failure and never repeats cleanup',async()=>{
 const f=fixture(),clusters=[];class Cluster{constructor(){clusters.push(this);}async quit(){throw Error('private credentials');}disconnect(){this.disconnected=(this.disconnected??0)+1;}}
 const service=await createQueueService({...config,redis:{cluster:{nodes:[{host:'localhost',port:7000}]}},prefix:'{isolated}'},f.driver,Cluster);
 await assert.rejects(service.close(),/shutdown failed/);await assert.rejects(service.close());assert.equal(service.shutdownStatus().state,'failed');assert.equal(service.shutdownStatus().cleanupFailures,2);assert.ok(clusters.every(c=>c.disconnected===1));
});
test('incoming invalid jobs and handler rejection never leak active slots or invoke handlers after close',async()=>{
 const f=fixture();let calls=0;const service=await createQueueService({...config,workers:{jobs:{processor:async()=>{calls++;throw Error('handler failed');}}}},f.driver);
 const process=f.workers[0].processor;await assert.rejects(process({name:'send',data:{huge:'x'.repeat(70000)}}),/byte limit/);assert.equal(calls,0);assert.equal(service.shutdownStatus().activeProcessors,0);
 await assert.rejects(process({name:'send',data:{id:'one'}}),/handler failed/);assert.equal(calls,1);assert.equal(service.shutdownStatus().activeProcessors,0);await service.close();await assert.rejects(process({name:'send',data:{}}),/closed/);assert.equal(calls,1);
});
