import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createRabbitMQWorker} from '@zeruxjs/queue-rabbitmq/worker';
const error=code=>e=>e.code===code&&!e.message.includes('SECRET');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('fixture condition not reached');}
function fixture(){
 const connections=[],log=[];let mode='confirm',backpressure=false;
 class Producer extends EventEmitter{
  constructor(id){super();this.id=id;this.published=[];this.topology=[];}
  async assertQueue(name,options){this.topology.push({name,options});}
  sendToQueue(queue,body,options,callback){const publish={queue,body,options,callback};this.published.push(publish);log.push(['publish',this.id,queue]);if(mode==='return'){this.emit('return',{properties:{headers:options.headers}});queueMicrotask(()=>callback(null));}else if(mode==='nack')queueMicrotask(()=>callback(Error('message nacked')));else if(mode==='confirm')queueMicrotask(()=>callback(null));return !backpressure;}
  async close(){log.push(['producer-close',this.id]);this.emit('close');}
 }
 class Consumer extends EventEmitter{
  constructor(id){super();this.id=id;this.handlers=new Map();this.dispositions=[];this.credits=[];}
  async prefetch(n,global){this.credits.push([n,global]);}
  async consume(queue,handler){this.handlers.set(queue,handler);return {consumerTag:queue};}
  async cancel(tag){log.push(['cancel',this.id,tag]);}
  ack(message){this.dispositions.push(['ack',message]);log.push(['ack',this.id]);}
  nack(message,all,requeue){assert.equal(all,false);assert.equal(requeue,false);this.dispositions.push(['dead',message]);log.push(['dead',this.id]);}
  async close(){log.push(['consumer-close',this.id]);this.emit('close');}
 }
 class Connection extends EventEmitter{
  constructor(){super();this.connection={serverProperties:{product:'RabbitMQ',version:'4.1.4'}};this.id=connections.length+1;this.producer=new Producer(this.id);this.consumer=new Consumer(this.id);connections.push(this);}
  async createConfirmChannel(){return this.producer;}
  async createChannel(){return this.consumer;}
  async close(){log.push(['connection-close',this.id]);this.emit('close');}
 }
 return {connections,log,connector:async()=>new Connection(),set mode(value){mode=value;},set backpressure(value){backpressure=value;}};
}
const options=(handler)=>({url:'amqp://user:SECRET@localhost',prefix:'test',queues:[{name:'jobs',type:'quorum',...(handler?{handler}:{})}],timeoutMs:30,drainMs:30,reconnect:{maxAttempts:2,delayMs:1}});
function message(attempt=1,count=0){return {content:Buffer.from(JSON.stringify({name:'send',data:{recordId:'one'}})),properties:{contentType:'application/json',messageId:'message-one',headers:{'x-zerux-attempt':attempt,'x-delivery-count':count}},fields:{redelivered:count>0}};}
function deliver(f,messageValue,index=0){f.connections[index].consumer.handlers.get('test.jobs')(messageValue);}
test('mandatory publish, returned routing, broker nack and drain backpressure never auto-replay',async()=>{
 const f=fixture(),service=await createRabbitMQWorker(options(),f.connector);
 try{assert.equal(service.capabilities.publisherConfirms,true);await service.add('jobs','send',{recordId:'one'});assert.equal(f.connections[0].producer.published[0].options.mandatory,true);
 f.mode='return';await assert.rejects(service.add('jobs','send',{}),error('UNROUTABLE'));assert.equal(service.status().returnedPublishes,1);assert.equal(service.status().state,'ready');
 f.mode='nack';await assert.rejects(service.add('jobs','send',{}),error('PUBLISH_NACK'));f.mode='confirm';f.backpressure=true;await service.add('jobs','send',{});await assert.rejects(service.add('jobs','send',{}),error('PUBLISH_BACKPRESSURE'));f.backpressure=false;f.connections[0].producer.emit('drain');await service.add('jobs','send',{});
 await assert.rejects(service.add('other','send',{}),error('QUEUE_NOT_CONFIGURED'));await assert.rejects(service.add('jobs','send',{fn(){}}),error('INVALID_PAYLOAD'));
 }finally{await service.close();}assert.equal(service.status().state,'closed');assert.equal(service.status().pendingNative,0);
});
test('declared topology uses broker TTL, per-consumer credits, finite attempt headers and dead-letter nack',async()=>{
 const f=fixture();let calls=0;const service=await createRabbitMQWorker(options(async()=>{calls++;return 'retry';}),f.connector);
 try{const producer=f.connections[0].producer,consumer=f.connections[0].consumer;assert.deepEqual(consumer.credits,[[16,false]]);const retry=producer.topology.find(t=>t.name==='test.jobs.retry');assert.equal(retry.options.arguments['x-message-ttl'],1000);assert.equal(retry.options.arguments['x-dead-letter-routing-key'],'test.jobs');assert.equal(producer.topology.find(t=>t.name==='test.jobs').options.arguments['x-delivery-limit'],3);
 deliver(f,message());await until(()=>consumer.dispositions.length===1);assert.equal(producer.published[0].queue,'test.jobs.retry');assert.equal(producer.published[0].options.headers['x-zerux-attempt'],2);assert.equal(consumer.dispositions[0][0],'ack');
 deliver(f,message(3));await until(()=>consumer.dispositions.length===2);assert.equal(consumer.dispositions[1][0],'dead');assert.equal(producer.published.length,1);deliver(f,message(1,3));await until(()=>consumer.dispositions.length===3);assert.equal(calls,2);
 const invalid=message();invalid.properties.headers['x-zerux-attempt']=-1;deliver(f,invalid);await until(()=>consumer.dispositions.length===4);assert.equal(calls,2);
 }finally{await service.close();}
});
test('graceful close cancels consumption, drains handler ack on original channel, then closes resources once',async()=>{
 const f=fixture();let finish;const service=await createRabbitMQWorker(options(()=>new Promise(resolve=>finish=resolve)),f.connector);deliver(f,message());await until(()=>finish);const closing=service.close();await tick();assert.equal(service.status().state,'closing');assert.ok(f.log.some(e=>e[0]==='cancel'));assert.equal(f.connections[0].consumer.dispositions.length,0);finish('ack');await closing;await service.close();assert.equal(f.connections[0].consumer.dispositions[0][0],'ack');assert.ok(f.log.findIndex(e=>e[0]==='ack')<f.log.findIndex(e=>e[0]==='consumer-close'));assert.equal(f.log.filter(e=>e[0]==='connection-close').length,1);
});
test('disconnect fences old ack and waits for actual callback settlement before replacing channels',async()=>{
 const f=fixture();let finish,signal,calls=0;const service=await createRabbitMQWorker(options(job=>{calls++;signal=job.signal;return calls===1?new Promise(resolve=>finish=resolve):'ack';}),f.connector);
 try{deliver(f,message());await until(()=>finish);f.connections[0].emit('close');await tick();assert.equal(signal.aborted,true);assert.equal(f.connections.length,1);finish('ack');await until(()=>f.connections.length===2&&service.status().state==='ready');assert.equal(f.connections[0].consumer.dispositions.length,0);
 deliver(f,message(1,1),1);await until(()=>f.connections[1].consumer.dispositions.length===1);assert.equal(f.connections[1].consumer.dispositions[0][0],'ack');assert.equal(calls,2);
 }finally{await service.close();}
});
test('unknown confirmation is rejected once, never replayed; reconnect budget is finite',async()=>{
 const f=fixture(),settings=options();settings.timeoutMs=5;settings.reconnect.maxAttempts=1;const service=await createRabbitMQWorker(settings,f.connector);
 try{f.mode='hold';await assert.rejects(service.add('jobs','send',{}),error('PUBLISH_OUTCOME_UNKNOWN'));await until(()=>f.connections.length===2&&service.status().state==='ready');assert.equal(f.connections[0].producer.published.length,1);assert.equal(f.connections[1].producer.published.length,0);assert.equal(service.status().unknownPublishes,1);f.connections[1].emit('close');await until(()=>service.status().state==='failed');assert.equal(f.connections.length,2);await assert.rejects(service.add('jobs','send',{}),error('UNAVAILABLE'));
 }finally{await service.close();}
});
test('bad topology/config and dependency startup failure are redacted; acquired channels are closed',async()=>{
 const f=fixture();for(const settings of [{...options(),queues:[{name:'jobs',type:'classic',handler:async()=> 'ack'}]},{...options(),queues:[{name:'jobs',type:'quorum'},{name:'jobs.retry',type:'classic'}]},{...options(),unknown:'SECRET'},{...options(),reconnect:{maxAttempts:100,delayMs:1}}])await assert.rejects(createRabbitMQWorker(settings,f.connector),e=>!e.message.includes('SECRET'));assert.equal(f.connections.length,0);
 await assert.rejects(createRabbitMQWorker(options(),async()=>{throw Error('SECRET connection string');}),error('START_FAILED'));
 const connector=async()=>{const connection=await f.connector();connection.producer.assertQueue=async()=>{throw Error('broker topology denied SECRET');};return connection;};await assert.rejects(createRabbitMQWorker(options(),connector),error('START_FAILED'));assert.equal(f.log.filter(e=>e[0]==='connection-close').length,1);
});
test('drain deadline aborts cooperative signal and reports incomplete until the callback actually settles',async()=>{
 const f=fixture();let finish,signal;const settings=options(job=>{signal=job.signal;return new Promise(resolve=>finish=resolve);});settings.timeoutMs=5;settings.drainMs=5;const service=await createRabbitMQWorker(settings,f.connector);deliver(f,message());await until(()=>finish);await service.close();assert.equal(signal.aborted,true);assert.equal(service.status().state,'incomplete');assert.equal(service.status().pendingHandlers,1);finish('ack');await until(()=>service.status().state==='closed');assert.equal(f.connections[0].consumer.dispositions.length,0);
});
test('handler deadline aborts cooperatively and replacement waits for real settlement; broker blocked state survives drain',async()=>{
 const f=fixture();let finish,signal;const settings=options(job=>{signal=job.signal;return new Promise(resolve=>finish=resolve);});settings.handlerTimeoutMs=5;const service=await createRabbitMQWorker(settings,f.connector);
 try{f.connections[0].emit('blocked');f.connections[0].producer.emit('drain');await assert.rejects(service.add('jobs','send',{}),error('PUBLISH_BACKPRESSURE'));f.connections[0].emit('unblocked');
 deliver(f,message());await until(()=>signal?.aborted);assert.equal(service.status().handlerDeadlines,1);assert.equal(f.connections.length,1);finish('ack');await until(()=>f.connections.length===2&&service.status().state==='ready');assert.equal(f.connections[0].consumer.dispositions.length,0);
 }finally{finish?.('ack');await service.close();}assert.equal(service.status().pendingTimers,0);
});
test('service-wide consumer credits sum to concurrency rather than enabling unsupported quorum global prefetch',async()=>{
 const f=fixture(),settings=options(async()=> 'ack');settings.concurrency=3;settings.queues.push({name:'second',type:'quorum',handler:async()=> 'ack'});const service=await createRabbitMQWorker(settings,f.connector);try{assert.deepEqual(f.connections[0].consumer.credits,[[2,false],[1,false]]);}finally{await service.close();}
});
test('drain with pending confirmation reports unknown, and late native cancellation remains owned after close deadline',async()=>{
 const f=fixture(),settings=options(async()=> 'ack');settings.timeoutMs=5;settings.drainMs=5;const service=await createRabbitMQWorker(settings,f.connector);let finishCancel;f.connections[0].consumer.cancel=()=>new Promise(resolve=>finishCancel=resolve);f.mode='hold';const rejection=assert.rejects(service.add('jobs','send',{}),error('PUBLISH_OUTCOME_UNKNOWN'));await service.close();await rejection;assert.equal(service.status().state,'incomplete');assert.equal(service.status().unknownPublishes,1);assert.equal(service.status().pendingTimers,0);finishCancel({});await until(()=>service.status().pendingNative===0);assert.equal(service.status().state,'failed');
});

test('quorum worker topology rejects unqualified broker advertisements and closes the acquired connection',async()=>{
 const f=fixture();const connector=async()=>{const connection=await f.connector();connection.connection.serverProperties.version='3.13.0';return connection;};await assert.rejects(createRabbitMQWorker(options(async()=> 'ack'),connector),error('START_FAILED'));assert.equal(f.connections[0].producer.topology.length,0);assert.equal(f.log.filter(e=>e[0]==='connection-close').length,1);
});
test('late channel acquisition after startup timeout is closed exactly once, never adopted by another generation',async()=>{
 const f=fixture();let finish;const connector=async()=>{const connection=await f.connector();connection.createConfirmChannel=()=>new Promise(resolve=>finish=resolve);return connection;};const settings=options();settings.timeoutMs=5;settings.drainMs=5;
 await assert.rejects(createRabbitMQWorker(settings,connector),error('START_FAILED'));assert.equal(f.log.filter(e=>e[0]==='connection-close').length,1);finish(f.connections[0].producer);await until(()=>f.log.some(e=>e[0]==='producer-close'));assert.equal(f.log.filter(e=>e[0]==='producer-close').length,1);assert.equal(f.connections.length,1);
});
test('unproven connection cleanup stops reconnection rather than overlapping a leaked generation',async()=>{
 const f=fixture(),connector=async()=>{const connection=await f.connector();connection.close=async()=>{throw Error('SECRET close failure');};return connection;};const service=await createRabbitMQWorker(options(),connector);f.connections[0].producer.emit('error',Error('broker unavailable'));
 await until(()=>service.status().state==='failed');assert.equal(f.connections.length,1);assert.equal(service.status().reconnectAttempts,0);await service.close();assert.equal(service.status().cleanupFailures,1);
});
