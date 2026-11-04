import {queueOptionKeys,queueInteger,queueName,QueueBackendError,type QueueCapabilities,type QueueBackendFactory} from './neutral.js';
import type {QueueServiceConfig,createQueueService} from '@zeruxjs/queue-bullmq';
const base:QueueCapabilities={delay:false,retry:false,acknowledgement:false,scheduler:false,pull:false,push:false,publisherConfirms:false,destructiveRead:false};
function allowedQueues(queues:readonly string[]){if(!Array.isArray(queues)||!queues.length||queues.length>100||new Set(queues).size!==queues.length)throw new QueueBackendError('INVALID_OPTIONS');queues.forEach(queueName);return Object.freeze([...queues]);}
function sameQueues(value:unknown,queues:readonly string[]){if(!Array.isArray(value)||value.length!==queues.length||value.some((q,i)=>(typeof q==='string'?q:q?.name)!==queues[i]))throw new QueueBackendError('INVALID_OPTIONS');}
function limits(options:Record<string,any>,entries:Record<string,number>){for(const [key,max] of Object.entries(entries))if(options[key]!==undefined)queueInteger(options[key],1,max);}
function prefix(options:Record<string,any>){if(options.prefix!==undefined)queueName(options.prefix);}
export interface PullBackend {
 add(queue:string,name:string,data:Record<string,unknown>):Promise<unknown>;
 take(queue:string):Promise<{id?:string;name:string;data:Record<string,unknown>;redelivered?:boolean;ack?():void;reject?(requeue?:boolean):void}|undefined>;
 close():void|Promise<void>;
 whenClosed?():Promise<void>;
}
/** Inject the actual standalone factory. Its own inferred options remain package-owned. */
export function rabbitMQBackend<O,B extends PullBackend>(create:(options:O)=>Promise<B>,queues:readonly string[]):QueueBackendFactory<O,B>{
 const names=allowedQueues(queues);
 return {name:'rabbitmq',queues:names,capabilities:Object.freeze({...base,pull:true,acknowledgement:true,publisherConfirms:true}),
  validate(value){queueOptionKeys(value,['url','prefix','timeoutMs','maxBytes','maxPending','prefetch','queues']);sameQueues(value.queues,names);prefix(value);limits(value,{timeoutMs:120000,maxBytes:1048576,maxPending:1000,prefetch:1000});
   try{const url=new URL(value.url);if(!['amqp:','amqps:'].includes(url.protocol))throw 0;}catch{throw new QueueBackendError('INVALID_OPTIONS');}return {...value,queues:[...names]} as O;},
  async open(options,ownership){const client=await create(options);ownership.onCleanup(()=>client.close());return {extension:client,async publish(queue,name,data){const id=await client.add(queue,name,data);return typeof id==='string'?{id}:{};},async take(queue){const job=await client.take(queue);if(!job)return;if(typeof job.ack!=='function'||typeof job.reject!=='function')throw new QueueBackendError('INVALID_DELIVERY');return {...job,disposition:'manual',settle(disposition){if(disposition==='ack')job.ack!();else job.reject!(disposition==='requeue');}};}};}
 };
}
export function memcacheQBackend<O,B extends PullBackend>(create:(options:O)=>B,queues:readonly string[]):QueueBackendFactory<O,B>{
 return {name:'memcacheq',queues:allowedQueues(queues),capabilities:Object.freeze({...base,pull:true,destructiveRead:true}),
  validate(value){queueOptionKeys(value,['host','port','tls','timeoutMs','maxBytes','maxConcurrent','prefix','serverMaxBytes','acceptLegacy']);prefix(value);if(value.acceptLegacy!==undefined&&typeof value.acceptLegacy!=='boolean'||value.maxBytes!==undefined&&value.serverMaxBytes!==undefined&&value.maxBytes>value.serverMaxBytes)throw new QueueBackendError('INVALID_OPTIONS');limits(value,{port:65535,timeoutMs:120000,maxBytes:65500,maxConcurrent:1000,serverMaxBytes:65500});if(value.host!==undefined&&(typeof value.host!=='string'||!value.host.length||value.host.length>253||/[\s\x00-\x1f]/.test(value.host))||value.tls!==undefined&&typeof value.tls!=='boolean')throw new QueueBackendError('INVALID_OPTIONS');return {...value} as O;},
  open(options,ownership){const client=create(options);ownership.onCleanup(async()=>{await client.close();await client.whenClosed?.();});return {extension:client,async publish(queue,name,data){await client.add(queue,name,data);return {};},async take(queue){const job=await client.take(queue);return job?{...job,disposition:'consumed'}:undefined;}};}
 };
}
type BullMQService=Awaited<ReturnType<typeof createQueueService>>;
/** Specific operations/workers stay on the typed native extension, not the neutral contract. */
export function bullMQBackend(queues:readonly string[],create?:(options:QueueServiceConfig)=>Promise<BullMQService>):QueueBackendFactory<QueueServiceConfig,BullMQService>{
 const names=allowedQueues(queues);
 return {name:'bullmq',queues:names,capabilities:Object.freeze({...base,delay:true,retry:true,scheduler:true,push:true}),
  validate(value){queueOptionKeys(value,['enabled','redis','prefix','queues','workers','readyTimeoutMs','shutdownGraceMs','onWorkerError','events','administration']);sameQueues(value.queues,names);
   for(const queue of value.queues)if(typeof queue!=='string'){queueOptionKeys(queue,['name','defaultJobOptions']);if(queue.defaultJobOptions!==undefined){const settings=queue.defaultJobOptions;queueOptionKeys(settings,['jobId','delay','priority','attempts','backoff','removeOnComplete','removeOnFail','repeat','deduplication']);if(settings.repeat!==undefined)queueOptionKeys(settings.repeat,['every','pattern','limit','immediately']);if(settings.deduplication!==undefined)queueOptionKeys(settings.deduplication,['id','ttl']);if(settings.backoff&&typeof settings.backoff==='object')queueOptionKeys(settings.backoff,['type','delay']);for(const k of ['removeOnComplete','removeOnFail'])if(settings[k]&&typeof settings[k]==='object')queueOptionKeys(settings[k],['age','count']);}}
   queueOptionKeys(value.redis,['url','host','port','username','password','db','tls','cluster']);
   if(value.redis.cluster!==undefined){queueOptionKeys(value.redis.cluster,['nodes']);if(!Array.isArray(value.redis.cluster.nodes)||!value.redis.cluster.nodes.length||value.redis.cluster.nodes.length>100)throw new QueueBackendError('INVALID_OPTIONS');for(const node of value.redis.cluster.nodes)queueOptionKeys(node,['host','port']);}
   if(value.workers!==undefined){queueOptionKeys(value.workers,names);for(const worker of Object.values(value.workers)){queueOptionKeys(worker,['processor','concurrency','autorun','lockDuration','limiter']);if(worker.limiter!==undefined)queueOptionKeys(worker.limiter,['max','duration']);if(typeof worker.processor!=='function')throw new QueueBackendError('INVALID_OPTIONS');}}
   if(value.events!==undefined)queueOptionKeys(value.events,['enabled','onEvent','onError']);if(value.administration!==undefined)queueOptionKeys(value.administration,['authorize','onAudit','maxPageSize']);
   return value as unknown as QueueServiceConfig;},
  async open(options,ownership){const open=create??(await import('@zeruxjs/queue-bullmq')).createQueueService;const service=await open(options);ownership.onCleanup(()=>service.close());return {extension:service,async publish(queue,name,data,settings){const job=await service.queue(queue).add(name,data,settings);return {id:job.id};}};}
 };
}
