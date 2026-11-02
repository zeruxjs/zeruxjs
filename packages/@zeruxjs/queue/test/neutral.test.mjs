import test from 'node:test';import assert from 'node:assert/strict';
import {createQueueBackend,selectQueueBackend,validateQueueSelection} from '@zeruxjs/queue/neutral';
import {rabbitMQBackend,memcacheQBackend,bullMQBackend} from '@zeruxjs/queue/backends';
const code=expected=>error=>error.code===expected&&!error.message.includes('SECRET');
function client(manual=false){const log=[],messages=[];let closed=0;return {log,messages,get closed(){return closed;},async add(q,name,data){messages.push({name,data});log.push(['add',q]);return 'one';},async take(){const item=messages.shift();return item?{...item,...(manual?{ack(){log.push('ack');},reject(requeue){log.push(requeue?'requeue':'discard');}}:{})}:undefined;},async close(){closed++;log.push('close');}};}
test('MemcacheQ selection preserves destructive disposition, allowlist, bounds and unsupported feature rejection',async()=>{
 const native=client(),factory=memcacheQBackend(()=>native,['jobs']);const service=await createQueueBackend(selectQueueBackend(factory,{host:'localhost'},{maxBytes:64}));
 assert.equal(service.capabilities.destructiveRead,true);await service.publish('jobs','send',{id:'one'});const delivery=await service.take('jobs');assert.equal(delivery.disposition,'consumed');assert.equal(delivery.settle,undefined);
 for(const options of [{delay:0},{attempts:1},{repeat:{every:1000}}])await assert.rejects(service.publish('jobs','send',{},options));
 assert.throws(()=>service.require('acknowledgement'),code('UNSUPPORTED_CAPABILITY'));assert.throws(()=>service.require('scheduler'),code('UNSUPPORTED_CAPABILITY'));await assert.rejects(service.publish('other','send',{}),code('QUEUE_NOT_REGISTERED'));
 await assert.rejects(service.publish('jobs','send',{large:'x'.repeat(100)}),code('PAYLOAD_LIMIT'));await assert.rejects(service.publish('jobs','send',JSON.parse('{"__proto__":1}')),code('INVALID_PAYLOAD'));
 assert.equal(service.extension(factory),native);assert.throws(()=>service.extension(memcacheQBackend(()=>native,['jobs'])),code('UNSUPPORTED_EXTENSION'));
 await Promise.all([service.close(),service.close()]);assert.equal(native.closed,1);await assert.rejects(service.take('jobs'),code('CLOSED'));
});
test('RabbitMQ preserves confirmed IDs and exactly-once local disposition without auto retry',async()=>{
 const native=client(true),factory=rabbitMQBackend(async()=>native,['jobs']);const service=await createQueueBackend(selectQueueBackend(factory,{url:'amqps://host',queues:['jobs']}));
 assert.equal((await service.publish('jobs','send',{})).id,'one');const message=await service.take('jobs');assert.equal(message.disposition,'manual');await message.settle('requeue');await assert.rejects(message.settle('ack'),code('INVALID_DISPOSITION'));assert.ok(native.log.includes('requeue'));await service.close();
});
test('unknown backend options/capabilities fail before factory invocation; startup rollback and errors are redacted',async()=>{
 let opens=0;const factory=memcacheQBackend(()=>{opens++;return client();},['jobs']);
 assert.throws(()=>selectQueueBackend(factory,{servers:['SECRET']}),code('INVALID_OPTIONS'));assert.throws(()=>selectQueueBackend(factory,{}, {requireCapabilities:['retry']}),code('UNSUPPORTED_CAPABILITY'));assert.equal(opens,0);
 const log=[],broken={...factory,async open(_opts,own){own.onCleanup(()=>log.push('first'));own.onCleanup(()=>log.push('second'));throw Error('SECRET password');}};
 await assert.rejects(createQueueBackend({factory:broken,options:{}}),error=>{assert.equal(JSON.stringify(error).includes('SECRET'),false);return code('START_FAILED')(error);});assert.deepEqual(log,['second','first']);
 const missing={...factory,async open(){throw Error('Cannot find optional driver SECRET');}};await assert.rejects(createQueueBackend({factory:missing,options:{}}),code('START_FAILED'));
 const bad={...factory,capabilities:{...factory.capabilities,unknown:true}};assert.throws(()=>validateQueueSelection({factory:bad,options:{}}),code('INVALID_CAPABILITIES'));
});
test('close drains actual pending work before releasing resources, bounds pending calls and preserves uncertain failures',async()=>{
 let settle,closed=0;const factory=memcacheQBackend(()=>({async add(){return new Promise(resolve=>settle=resolve);},async take(){},close(){closed++;}}),['jobs']);const service=await createQueueBackend(selectQueueBackend(factory,{}, {maxPending:1}));
 const pending=service.publish('jobs','send',{});await Promise.resolve();await assert.rejects(service.publish('jobs','send',{}),code('PENDING_LIMIT'));const closing=service.close();assert.equal(closed,0);settle();await pending;await closing;assert.equal(closed,1);
 const failing=await createQueueBackend(selectQueueBackend(memcacheQBackend(()=>({async add(){throw Error('SECRET unknown outcome');},async take(){},close(){}}),['jobs']),{}));await assert.rejects(failing.publish('jobs','send',{}),code('OPERATION_FAILED'));await failing.close();
});
test('BullMQ neutral producer maps native options; push workers and schedulers stay typed extensions',async()=>{
 const calls=[];const native={queue(q){return {async add(name,data,options){calls.push({q,name,data,options});return {id:'bull-one'};}};},close:async()=>calls.push('close'),schedules(){return 'native';}};
 const factory=bullMQBackend(['jobs'],async()=>native);const selection=selectQueueBackend(factory,{redis:{host:'localhost'},queues:['jobs']});const service=await createQueueBackend(selection);
 assert.equal((await service.publish('jobs','send',{}, {delay:10,attempts:2})).id,'bull-one');assert.deepEqual(calls[0].options,{delay:10,attempts:2});assert.equal(service.extension(factory).schedules(),'native');await assert.rejects(service.take('jobs'),code('UNSUPPORTED_CAPABILITY'));await service.close();
 assert.throws(()=>selectQueueBackend(factory,{redis:{host:'localhost'},queues:[{name:'jobs',defaultJobOptions:{secretOption:true}}]}),code('INVALID_OPTIONS'));
});
test('malformed pulled payloads discard manual deliveries; cleanup failure remains private and close runs once',async()=>{
 const base=rabbitMQBackend(async()=>client(true),['jobs']);let discarded=0,closed=0;
 const factory={...base,open(_options,own){own.onCleanup(()=>{closed++;throw Error('SECRET cleanup');});return {async publish(){return {};},async take(){return {name:'invalid name',data:{},disposition:'manual',settle(action){assert.equal(action,'discard');discarded++;}};}};}};
 const service=await createQueueBackend(selectQueueBackend(factory,{url:'amqp://host',queues:['jobs']}));await assert.rejects(service.take('jobs'),code('INVALID_NAME'));assert.equal(discarded,1);await assert.rejects(service.close(),code('CLOSE_FAILED'));await assert.rejects(service.close(),code('CLOSE_FAILED'));assert.equal(closed,1);
 const mem=await createQueueBackend(selectQueueBackend(memcacheQBackend(()=>client(),['jobs']),{}));const sparse=[];sparse.length=100000000;await assert.rejects(mem.publish('jobs','send',{sparse}),code('PAYLOAD_LIMIT'));await mem.close();
});
test('MemcacheQ native close barrier is awaited without requiring it from older injected factories',async()=>{
 let finish,closed=0;const factory=memcacheQBackend(()=>({async add(){},async take(){},close(){closed++;},whenClosed(){return new Promise(resolve=>finish=resolve);}}),['jobs']);const service=await createQueueBackend(selectQueueBackend(factory,{}));let settled=false;const closing=service.close().then(()=>settled=true);await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(settled,false);assert.equal(closed,1);finish();await closing;assert.equal(settled,true);
});
