import {connect,type ChannelModel,type Channel,type ConfirmChannel,type ConsumeMessage} from 'amqplib';
import {randomUUID} from 'node:crypto';
export type RabbitMQWorkerResult='ack'|'retry'|'dead-letter';
export interface RabbitMQWorkerJob {
 readonly id:string;readonly name:string;readonly data:Record<string,unknown>;
 readonly attempt:number;readonly redelivered:boolean;readonly signal:AbortSignal;
}
export interface RabbitMQWorkerQueue {
 name:string;type:'classic'|'quorum';
 /** Workers require quorum queues and RabbitMQ 4.x delivery-limit support. */
 handler?:(job:RabbitMQWorkerJob)=>RabbitMQWorkerResult|Promise<RabbitMQWorkerResult>;
 maxAttempts?:number;retryDelayMs?:number;maxLength?:number;
}
export interface RabbitMQWorkerOptions {
 url:string;prefix?:string;queues:readonly RabbitMQWorkerQueue[];
 concurrency?:number;maxPending?:number;maxBytes?:number;timeoutMs?:number;drainMs?:number;handlerTimeoutMs?:number;
 reconnect?:{maxAttempts:number;delayMs:number};signal?:AbortSignal;
}
export type RabbitMQWorkerConnector=(url:string,options:{timeout:number})=>Promise<ChannelModel>;
export class RabbitMQWorkerError extends Error {
 constructor(readonly code:string,cause?:unknown){super(`RabbitMQ worker error (${code})`);this.name='RabbitMQWorkerError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
const fail=(code:string,cause?:unknown)=>new RabbitMQWorkerError(code,cause);
const name=(value:unknown):string=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value))throw fail('INVALID_CONFIG');return value;};
const integer=(value:unknown,min:number,max:number)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw fail('INVALID_CONFIG');return value;};
function keys(value:unknown,allowed:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!('value'in d)))throw fail('INVALID_CONFIG');}
function json(value:unknown,max:number):Record<string,unknown>{
 let nodes=0,chars=0;const seen=new Set<object>();
 const copy=(v:unknown,depth:number):any=>{
  if(++nodes>8192||depth>16)throw fail('PAYLOAD_LIMIT');
  if(typeof v==='string'){chars+=v.length;if(chars>max)throw fail('PAYLOAD_LIMIT');return v;}
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||typeof v!=='object'||seen.has(v)||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(v)))throw fail('INVALID_PAYLOAD');
  const own=Object.keys(v);if(own.length>8192||Array.isArray(v)&&(v.length>8192||own.length!==v.length||own.some((k,i)=>k!==String(i))))throw fail('PAYLOAD_LIMIT');
  seen.add(v);const out:any=Array.isArray(v)?[]:{};for(const k of own){const d=Object.getOwnPropertyDescriptor(v,k)!;if(['constructor','__proto__','prototype'].includes(k)||!('value'in d))throw fail('INVALID_PAYLOAD');chars+=k.length;if(chars>max)throw fail('PAYLOAD_LIMIT');out[k]=copy(d.value,depth+1);}seen.delete(v);return out;
 };
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('INVALID_PAYLOAD');const result=copy(value,0);if(Buffer.byteLength(JSON.stringify(result))>max)throw fail('PAYLOAD_LIMIT');return result;
}
interface Confirmation {returned:boolean;resolve():void;reject(error:Error):void;done:Promise<void>}
interface Generation {
 id:number;valid:boolean;accepting:boolean;connectionClosed:boolean;cleanupFailed:boolean;connection?:ChannelModel;producer?:ConfirmChannel;consumer?:Channel;
 blocked:boolean;brokerBlocked:boolean;tags:string[];controllers:Set<AbortController>;tasks:Set<Promise<void>>;
 confirms:Map<string,Confirmation>;native:Set<Promise<unknown>>;releases:Map<object,Promise<unknown>>;retired?:Promise<void>;
 lost:Promise<never>;rejectLost(error:Error):void;
}
/** Separate opt-in owned worker service; legacy pull clients retain their ownership model. */
export async function createRabbitMQWorker(options:RabbitMQWorkerOptions,connector:RabbitMQWorkerConnector=connect){
 keys(options,['url','prefix','queues','concurrency','maxPending','maxBytes','timeoutMs','drainMs','handlerTimeoutMs','reconnect','signal']);
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 if(typeof options.url!=='string'||options.url.length>4096||/[\x00-\x1f\x7f]/.test(options.url))throw fail('INVALID_CONFIG');
 let target:URL;try{target=new URL(options.url);}catch{throw fail('INVALID_CONFIG');}if(!['amqp:','amqps:'].includes(target.protocol))throw fail('INVALID_CONFIG');
 if(typeof connector!=='function'||options.signal!==undefined&&(!(options.signal instanceof AbortSignal)))throw fail('INVALID_CONFIG');
 const prefix=name(options.prefix??'zerux'),url=options.url,externalSignal=options.signal;
 if(!Array.isArray(options.queues)||!options.queues.length||options.queues.length>32)throw fail('INVALID_CONFIG');
 const definitions=options.queues.map(input=>{keys(input,['name','type','handler','maxAttempts','retryDelayMs','maxLength']);const value={name:name(input.name),type:input.type,handler:input.handler,maxAttempts:integer(input.maxAttempts??3,1,20),retryDelayMs:integer(input.retryDelayMs??1000,100,86400000),maxLength:integer(input.maxLength??10000,1,1000000)};if(!['classic','quorum'].includes(value.type)||value.handler!==undefined&&(typeof value.handler!=='function'||value.type!=='quorum'))throw fail('INVALID_CONFIG');return value;});
 const names=new Set<string>();for(const definition of definitions)for(const suffix of ['', '.retry','.dead']){const physical=`${prefix}.${definition.name}${suffix}`;if(names.has(physical)||Buffer.byteLength(physical)>240)throw fail('TOPOLOGY_CONFLICT');names.add(physical);}
 const workers=definitions.filter(q=>q.handler),concurrency=integer(options.concurrency??Math.max(16,workers.length),1,128);
 if(concurrency<workers.length)throw fail('INVALID_CONFIG');
 const maxPending=integer(options.maxPending??32,1,1000),maxBytes=integer(options.maxBytes??65536,1,1048576),timeout=integer(options.timeoutMs??3000,1,120000),drain=integer(options.drainMs??30000,1,300000),handlerTimeout=integer(options.handlerTimeoutMs??30000,1,300000);
 if(options.reconnect!==undefined)keys(options.reconnect,['maxAttempts','delayMs']);
 const maxReconnect=integer(options.reconnect?.maxAttempts??0,0,20),reconnectDelay=integer(options.reconnect?.delayMs??1000,1,30000);
 let state:'starting'|'ready'|'recovering'|'failed'|'closing'|'closed'|'incomplete'='starting',closed=false,generation=0,reconnectAttempts=0,unknownPublishes=0,returnedPublishes=0,deadLetters=0,cleanupFailures=0,drainTimeouts=0,handlerDeadlines=0;
 let current:Generation|undefined,closing:Promise<void>|undefined,recovering:Promise<void>|undefined;
 const lifetime=new AbortController(),allTasks=new Set<Promise<void>>(),allNative=new Set<Promise<unknown>>();
 const timers=new Set<ReturnType<typeof setTimeout>>();
 function tracked<T>(g:Generation,promise:Promise<T>):Promise<T>{g.native.add(promise);allNative.add(promise);promise.then(()=>{g.native.delete(promise);allNative.delete(promise);},()=>{g.native.delete(promise);allNative.delete(promise);});return promise;}
 async function bounded<T>(promise:Promise<T>,ms:number,code:string,signal?:AbortSignal):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(fail(code)),ms);timers.add(timer);abort=()=>reject(fail('CANCELLED'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}
  finally{if(timer){clearTimeout(timer);timers.delete(timer);}if(abort)signal?.removeEventListener('abort',abort);}
 }
 function invalidate(g:Generation){if(!g.valid)return;g.valid=false;g.accepting=false;g.rejectLost(fail('GENERATION_LOST'));for(const controller of g.controllers)controller.abort();for(const confirmation of g.confirms.values()){if(confirmation.returned){returnedPublishes++;confirmation.reject(fail('UNROUTABLE'));}else{unknownPublishes++;confirmation.reject(fail('PUBLISH_OUTCOME_UNKNOWN'));}}g.confirms.clear();}
 async function phase<T>(g:Generation,promise:Promise<T>):Promise<T>{return bounded(Promise.race([tracked(g,promise),g.lost]),timeout,'PHASE_DEADLINE',lifetime.signal);}
 function releaseResource(g:Generation,resource:{close():Promise<unknown>}):Promise<unknown>{
  const previous=g.releases.get(resource);if(previous)return previous;
  const pending=tracked(g,Promise.resolve().then(()=>resource.close()).catch(error=>{if(g.connectionClosed)return;g.cleanupFailed=true;cleanupFailures++;throw error;}));g.releases.set(resource,pending);return pending;
 }
 function acquireChannel<T extends Channel|ConfirmChannel>(g:Generation,pending:Promise<T>):Promise<T>{
  void pending.then(resource=>{if(closed||!g.valid)void releaseResource(g,resource).catch(()=>{});},()=>{}).catch(()=>{cleanupFailures++;});
  return phase(g,pending);
 }
 async function cleanup(g:Generation){
  for(const resource of [g.consumer,g.producer,g.connection])if(resource&&!g.connectionClosed)try{await bounded(releaseResource(g,resource),timeout,'CLOSE_DEADLINE');}catch(error){if(error instanceof RabbitMQWorkerError&&error.code==='CLOSE_DEADLINE'){g.cleanupFailed=true;cleanupFailures++;}}
 }
 function retire(g:Generation,graceful=false):Promise<void>{
  if(g.retired)return g.retired;
  g.accepting=false;
  g.retired=(async()=>{
   if(graceful&&g.valid){await Promise.all(g.tags.map(async tag=>{try{await bounded(tracked(g,Promise.resolve().then(()=>g.consumer!.cancel(tag))),timeout,'CANCEL_DEADLINE');}catch{cleanupFailures++;}}));
    try{await bounded(Promise.allSettled([...g.tasks,...[...g.confirms.values()].map(c=>c.done)]),drain,'DRAIN_DEADLINE');}catch{drainTimeouts++;}}
   invalidate(g);await cleanup(g);
   // A replacement must not overlap old callbacks, native operations, or channel-bound ack work.
   while(g.tasks.size||g.native.size)await Promise.allSettled([...g.tasks,...g.native]);
  })();return g.retired;
 }
 async function recover(g:Generation){
  if(recovering||closed)return;
  state='recovering';recovering=(async()=>{
   await retire(g);if(g.cleanupFailed){if(!closed)state='failed';return;}
   while(!closed&&reconnectAttempts<maxReconnect){
    reconnectAttempts++;
    try{await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);timers.delete(timer);lifetime.signal.removeEventListener('abort',abort);reject(fail('CANCELLED'));};const timer=setTimeout(()=>{timers.delete(timer);lifetime.signal.removeEventListener('abort',abort);resolve();},reconnectDelay);timers.add(timer);lifetime.signal.addEventListener('abort',abort,{once:true});if(lifetime.signal.aborted)abort();});}catch{break;}
    if(closed)break;
    try{const next=await openGeneration();if(closed){await retire(next);break;}current=next;state='ready';return;}catch{if(current){await retire(current);if(current.cleanupFailed)break;}}
   }
   if(!closed)state='failed';
  })().finally(()=>{recovering=undefined;});
 }
 function lost(g:Generation){if(!g.valid)return;invalidate(g);if(state==='ready')void recover(g);}
 function encode(jobName:string,data:Record<string,unknown>){name(jobName);const body=Buffer.from(JSON.stringify({name:jobName,data:json(data,maxBytes)}));if(body.length>maxBytes)throw fail('PAYLOAD_LIMIT');return body;}
 async function publish(g:Generation,destination:string,body:Buffer,id:string,attempt:number):Promise<void>{
  if(!g.valid||!g.producer)throw fail('UNAVAILABLE');if(g.blocked||g.brokerBlocked||g.confirms.size>=maxPending)throw fail('PUBLISH_BACKPRESSURE');
  const key=randomUUID();let resolve!:()=>void,reject!:(error:Error)=>void;const done=new Promise<void>((ok,no)=>{resolve=ok;reject=no;});void done.catch(()=>{});const confirmation:Confirmation={returned:false,resolve,reject,done};g.confirms.set(key,confirmation);
  try{
   const writable=g.producer.sendToQueue(destination,body,{persistent:true,mandatory:true,contentType:'application/json',messageId:id,headers:{'x-zerux-attempt':attempt,'x-zerux-publication':key}},error=>{
    if(!g.confirms.has(key))return;
    if(confirmation.returned){returnedPublishes++;reject(fail('UNROUTABLE'));}else if(error){if(error.message==='message nacked')reject(fail('PUBLISH_NACK',error));else{reject(fail('PUBLISH_OUTCOME_UNKNOWN',error));lost(g);}}else resolve();
   });if(!writable)g.blocked=true;
   await bounded(done,timeout,'PUBLISH_OUTCOME_UNKNOWN');
  }catch(error){
   if(error instanceof RabbitMQWorkerError&&['UNROUTABLE','PUBLISH_NACK'].includes(error.code))throw error;
   if(g.valid)lost(g);throw fail('PUBLISH_OUTCOME_UNKNOWN',error);
  }finally{g.confirms.delete(key);}
 }
 function receive(g:Generation,definition:typeof definitions[number],message:ConsumeMessage|null){
  if(!message){lost(g);return;}if(!g.valid||!g.accepting)return;
  if(allTasks.size>=concurrency){lost(g);return;}
  const controller=new AbortController();g.controllers.add(controller);
  const work=(async()=>{
   let envelope:{name:string;data:Record<string,unknown>},attempt:number,id:string;
   try{
    if(message.content.length>maxBytes||message.properties.contentType!=='application/json')throw fail('INVALID_PAYLOAD');
    const parsed=JSON.parse(message.content.toString('utf8'));keys(parsed,['name','data']);envelope={name:name(parsed.name),data:json(parsed.data,maxBytes)};
    const headers=message.properties.headers??{};const a=Object.hasOwn(headers,'x-zerux-attempt')?headers['x-zerux-attempt']:undefined,count=Object.hasOwn(headers,'x-delivery-count')?headers['x-delivery-count']:0;
    attempt=integer(a,1,20)+integer(count,0,1000000);id=name(message.properties.messageId);
   }catch{if(g.valid){deadLetters++;g.consumer!.nack(message,false,false);}return;}
   if(attempt>definition.maxAttempts){if(g.valid){deadLetters++;g.consumer!.nack(message,false,false);}return;}
   let result:RabbitMQWorkerResult;
   const taskTimer=setTimeout(()=>{timers.delete(taskTimer);handlerDeadlines++;lost(g);},handlerTimeout);timers.add(taskTimer);
   const stopTimer=()=>{clearTimeout(taskTimer);timers.delete(taskTimer);};controller.signal.addEventListener('abort',stopTimer,{once:true});
   try{result=await definition.handler!({id,name:envelope.name,data:envelope.data,attempt,redelivered:message.fields.redelivered,signal:controller.signal});}catch{result='retry';}finally{stopTimer();controller.signal.removeEventListener('abort',stopTimer);}
   if(!g.valid||controller.signal.aborted)return;
   if(result==='ack'){g.consumer!.ack(message);return;}
   if(result==='retry'&&attempt<definition.maxAttempts){
    try{await publish(g,`${prefix}.${definition.name}.retry`,encode(envelope.name,envelope.data),id,attempt+1);if(g.valid)g.consumer!.ack(message);}catch(error){if(error instanceof RabbitMQWorkerError&&['PUBLISH_BACKPRESSURE','UNROUTABLE','PUBLISH_NACK'].includes(error.code)){if(g.valid){deadLetters++;g.consumer!.nack(message,false,false);}}else lost(g);}return;
   }
   deadLetters++;g.consumer!.nack(message,false,false);
  })().catch(()=>{lost(g);}).finally(()=>{g.controllers.delete(controller);g.tasks.delete(work);allTasks.delete(work);});
  g.tasks.add(work);allTasks.add(work);
 }
 async function openGeneration():Promise<Generation>{
  let rejectLost!:(error:Error)=>void;const lostPromise=new Promise<never>((_,reject)=>rejectLost=reject);void lostPromise.catch(()=>{});
  const g:Generation={id:++generation,valid:true,accepting:false,connectionClosed:false,cleanupFailed:false,blocked:false,brokerBlocked:false,tags:[],controllers:new Set(),tasks:new Set(),confirms:new Map(),native:new Set(),releases:new Map(),lost:lostPromise,rejectLost};current=g;
  try{
   const pending=tracked(g,connector(url,{timeout}));void pending.then(connection=>{connection.on('error',()=>{});connection.on('close',()=>{g.connectionClosed=true;g.cleanupFailed=false;lost(g);});if(closed||!g.valid){void releaseResource(g,connection).catch(()=>{});}},()=>{}).catch(()=>{cleanupFailures++;});
   g.connection=await bounded(pending,timeout,'CONNECT_DEADLINE',lifetime.signal);if(closed||!g.valid)throw fail('CANCELLED');
   if(definitions.some(d=>d.type==='quorum')){const info=g.connection.connection?.serverProperties;if(info?.product!=='RabbitMQ'||typeof info.version!=='string'||!/^4\.\d+\.\d+(?:\+[^\s]+)?$/.test(info.version))throw fail('BROKER_UNSUPPORTED');}
   g.connection.on('error',()=>lost(g));g.connection.on('blocked',()=>{g.brokerBlocked=true;});g.connection.on('unblocked',()=>{g.brokerBlocked=false;});
   g.producer=await acquireChannel(g,g.connection.createConfirmChannel());g.producer.on('error',()=>lost(g));g.producer.on('close',()=>lost(g));g.producer.on('drain',()=>{g.blocked=false;});
   g.producer.on('return',(message:ConsumeMessage)=>{const key=message.properties.headers?.['x-zerux-publication'];const confirmation=typeof key==='string'?g.confirms.get(key):undefined;if(confirmation)confirmation.returned=true;else lost(g);});
   g.consumer=await acquireChannel(g,g.connection.createChannel());g.consumer.on('error',()=>lost(g));g.consumer.on('close',()=>lost(g));
   for(const definition of definitions){
    const physical=`${prefix}.${definition.name}`,base={'x-queue-type':definition.type,'x-max-length':definition.maxLength,'x-overflow':'reject-publish'};
    await phase(g,g.producer.assertQueue(`${physical}.dead`,{durable:true,arguments:base}));
    await phase(g,g.producer.assertQueue(`${physical}.retry`,{durable:true,arguments:{'x-queue-type':'classic','x-message-ttl':definition.retryDelayMs,'x-max-length':definition.maxLength,'x-overflow':'reject-publish','x-dead-letter-exchange':'','x-dead-letter-routing-key':physical}}));
    await phase(g,g.producer.assertQueue(physical,{durable:true,arguments:{...base,'x-dead-letter-exchange':'','x-dead-letter-routing-key':`${physical}.dead`,...(definition.type==='quorum'?{'x-delivery-limit':definition.maxAttempts}:{})}}));
   }
   g.accepting=true;
   for(let i=0;i<workers.length;i++){
    const definition=workers[i],credit=Math.floor(concurrency/workers.length)+(i<concurrency%workers.length?1:0);
    await phase(g,g.consumer.prefetch(credit,false));const tag=await phase(g,g.consumer.consume(`${prefix}.${definition.name}`,message=>receive(g,definition,message),{noAck:false}));g.tags.push(tag.consumerTag);
   }
   if(!g.valid)throw fail('GENERATION_LOST');return g;
  }catch(error){invalidate(g);void retire(g).catch(()=>{});throw fail('START_FAILED',error);}
 }
 async function close():Promise<void>{
  if(closing)return closing;closed=true;state='closing';lifetime.abort();externalSignal?.removeEventListener('abort',abort);
  closing=(async()=>{const retirement=current?retire(current,true):Promise.resolve();try{await bounded(Promise.allSettled([retirement,...(recovering?[recovering]:[])]),drain+timeout*4,'CLOSE_DEADLINE');}catch{drainTimeouts++;}state=allTasks.size||allNative.size?'incomplete':cleanupFailures?'failed':'closed';})();return closing;
 }
 const abort=()=>{void close().catch(()=>{});};externalSignal?.addEventListener('abort',abort,{once:true});
 try{if(externalSignal?.aborted)throw fail('CANCELLED');await openGeneration();if(closed)throw fail('CANCELLED');state='ready';}
 catch(error){await close();throw fail('START_FAILED',error);}
 return {
  capabilities:Object.freeze({publisherConfirms:true,acknowledgement:true,push:true,brokerRetry:true,delay:false,scheduler:false}),
  async add(queue:string,jobName:string,data:Record<string,unknown>):Promise<string>{
   if(closed||state!=='ready'||!current?.valid)throw fail('UNAVAILABLE');const definition=definitions.find(d=>d.name===queue);if(!definition)throw fail('QUEUE_NOT_CONFIGURED');const body=encode(jobName,data),id=randomUUID();await publish(current,`${prefix}.${definition.name}`,body,id,1);return id;
  },
  status(){return {state:state==='incomplete'&&!allTasks.size&&!allNative.size?(cleanupFailures?'failed':'closed'):state,generation,reconnectAttempts,pendingHandlers:allTasks.size,pendingNative:allNative.size,pendingConfirms:current?.confirms.size??0,unknownPublishes,returnedPublishes,deadLetters,cleanupFailures,drainTimeouts,handlerDeadlines,pendingTimers:timers.size};},
  close
 };
}
