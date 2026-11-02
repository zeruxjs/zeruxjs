/** Opt-in contract. No discovery, connections or optional driver imports on import. */
export interface QueueCapabilities {
 delay:boolean;retry:boolean;acknowledgement:boolean;scheduler:boolean;
 pull:boolean;push:boolean;publisherConfirms:boolean;destructiveRead:boolean;
}
export type QueueCapability=keyof QueueCapabilities;
export type QueueDisposition='ack'|'discard'|'requeue';
export interface QueueDelivery {
 id?:string;name:string;data:Record<string,unknown>;redelivered?:boolean;
 disposition:'manual'|'consumed';
 settle?(disposition:QueueDisposition):void|Promise<void>;
}
export interface QueuePublishOptions {delay?:number;attempts?:number}
export interface QueueBackendHandle<Extension=unknown> {
 publish(queue:string,name:string,data:Record<string,unknown>,options:QueuePublishOptions):Promise<{id?:string}>;
 take?(queue:string):Promise<QueueDelivery|undefined>;
 extension?:Extension;
}
export interface QueueStartupOwnership {
 /** Register immediately after acquisition. Rollback/close execute LIFO, exactly once. */
 onCleanup(cleanup:()=>void|Promise<void>):void;
}
export interface QueueBackendFactory<Options=unknown,Extension=unknown> {
 readonly name:string;readonly queues:readonly string[];readonly capabilities:Readonly<QueueCapabilities>;
 /** Pure synchronous validation: no connections, imports, logging or mutation. */
 validate(options:unknown):Options;
 open(options:Options,ownership:QueueStartupOwnership):Promise<QueueBackendHandle<Extension>>|QueueBackendHandle<Extension>;
}
export interface QueueSelection {
 factory:QueueBackendFactory<any,any>;options:unknown;
 requireCapabilities?:readonly QueueCapability[];maxBytes?:number;maxPending?:number;
}
export class QueueBackendError extends Error {
 constructor(readonly code:string,cause?:unknown){super(`Queue backend error (${code})`);this.name='QueueBackendError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
const names=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const capabilities=['delay','retry','acknowledgement','scheduler','pull','push','publisherConfirms','destructiveRead'] as const;
export function queueName(name:unknown):asserts name is string {if(typeof name!=='string'||!names.test(name))throw new QueueBackendError('INVALID_NAME');}
export function queueOptionKeys(value:unknown,allowed:readonly string[]):asserts value is Record<string,any> {
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!allowed.includes(key))||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!('value'in d)))throw new QueueBackendError('INVALID_OPTIONS');
}
export function queueInteger(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new QueueBackendError('INVALID_OPTIONS');return value;}
export function selectQueueBackend<O,E>(factory:QueueBackendFactory<O,E>,options:NoInfer<O>,settings:Omit<QueueSelection,'factory'|'options'>={}):QueueSelection&{factory:QueueBackendFactory<O,E>}{
 const selection={...settings,factory,options};validateQueueSelection(selection);return selection;
}
/** Called by framework configuration validation before database/cache factories. */
export function validateQueueSelection(selection:QueueSelection):void{
 try{
  queueOptionKeys(selection,['factory','options','requireCapabilities','maxBytes','maxPending']);const factory=selection.factory;
  queueName(factory?.name);if(typeof factory.validate!=='function'||typeof factory.open!=='function'||!Array.isArray(factory.queues)||!factory.queues.length||factory.queues.length>100||new Set(factory.queues).size!==factory.queues.length)throw new QueueBackendError('INVALID_FACTORY');factory.queues.forEach(queueName);
  if(factory.capabilities?.acknowledgement&&factory.capabilities.destructiveRead)throw new QueueBackendError('INVALID_CAPABILITIES');
  if(!factory.capabilities||capabilities.some(key=>typeof factory.capabilities[key]!=='boolean')||Object.keys(factory.capabilities).some(key=>!capabilities.includes(key as QueueCapability)))throw new QueueBackendError('INVALID_CAPABILITIES');
  const required=selection.requireCapabilities??[];if(!Array.isArray(required)||required.length>8||required.some(key=>!capabilities.includes(key)||!factory.capabilities[key as QueueCapability]))throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
  queueInteger(selection.maxBytes??65536,1,1024*1024);queueInteger(selection.maxPending??32,1,1000);
  factory.validate(selection.options);
 }catch(error){if(error instanceof QueueBackendError)throw error;throw new QueueBackendError('INVALID_OPTIONS',error);}
}
function payload(value:unknown,max:number):Record<string,unknown>{
 let nodes=0,characters=0;const seen=new Set<object>();
 function visit(v:unknown,depth:number):unknown{
  if(++nodes>8192||depth>16)throw new QueueBackendError('PAYLOAD_LIMIT');
  if(typeof v==='string'){characters+=v.length;if(characters>max)throw new QueueBackendError('PAYLOAD_LIMIT');return v;}
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||typeof v!=='object'||seen.has(v)||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(v)))throw new QueueBackendError('INVALID_PAYLOAD');
  if(Object.keys(v).length>8192||Array.isArray(v)&&(v.length>8192||Object.keys(v).length!==v.length))throw new QueueBackendError('PAYLOAD_LIMIT');
  seen.add(v);const result:any=Array.isArray(v)?[]:Object.create(null);
  for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(Array.isArray(v)&&key==='length')continue;if(['__proto__','constructor','prototype'].includes(key)||!('value'in d))throw new QueueBackendError('INVALID_PAYLOAD');characters+=key.length;if(characters>max)throw new QueueBackendError('PAYLOAD_LIMIT');result[key]=visit(d.value,depth+1);}seen.delete(v);return result;
 }
 if(!value||typeof value!=='object'||Array.isArray(value))throw new QueueBackendError('INVALID_PAYLOAD');const result=visit(value,0) as Record<string,unknown>;
 if(new TextEncoder().encode(JSON.stringify(result)).byteLength>max)throw new QueueBackendError('PAYLOAD_LIMIT');return result;
}
export async function createQueueBackend<E=unknown>(selection:QueueSelection&{factory:QueueBackendFactory<any,E>}){
 validateQueueSelection(selection);
 const factory=selection.factory,caps=Object.freeze({...factory.capabilities}),queues=new Set(factory.queues),maxBytes=selection.maxBytes??65536,maxPending=selection.maxPending??32;
 const cleanups:(()=>void|Promise<void>)[]=[],pending=new Set<Promise<unknown>>();let closed=false,closing:Promise<void>|undefined,registering=true;
 const release=async()=>{const errors:unknown[]=[];for(const cleanup of cleanups.reverse().splice(0))try{await cleanup();}catch(e){errors.push(e);}if(errors.length)throw new QueueBackendError('CLOSE_FAILED',new AggregateError(errors));};
 let handle:QueueBackendHandle<E>;
 try{handle=await factory.open(factory.validate(selection.options),{onCleanup(cleanup){if(!registering||typeof cleanup!=='function'||cleanups.length>=64)throw new QueueBackendError('INVALID_CLEANUP');cleanups.push(cleanup);}});registering=false;if(!handle||typeof handle.publish!=='function'||caps.pull&&typeof handle.take!=='function')throw new QueueBackendError('INVALID_HANDLE');}
 catch(error){registering=false;let cause=error;try{await release();}catch(cleanupError){cause=new AggregateError([error,cleanupError],'Queue startup and rollback failed');}throw new QueueBackendError('START_FAILED',cause);}
 function ensure(queue:string){if(closed)throw new QueueBackendError('CLOSED');queueName(queue);if(!queues.has(queue))throw new QueueBackendError('QUEUE_NOT_REGISTERED');}
 async function run<T>(work:()=>Promise<T>):Promise<T>{if(pending.size>=maxPending)throw new QueueBackendError('PENDING_LIMIT');const job=Promise.resolve().then(work);pending.add(job);try{return await job;}catch(error){if(error instanceof QueueBackendError)throw error;throw new QueueBackendError('OPERATION_FAILED',error);}finally{pending.delete(job);}}
 return {name:factory.name,capabilities:caps,
  require(capability:QueueCapability){if(!capabilities.includes(capability)||!caps[capability])throw new QueueBackendError('UNSUPPORTED_CAPABILITY');},
  /** Trusted backend-specific extension; unavailable unless exact factory identity matches. */
  extension<O,T>(expected:QueueBackendFactory<O,T>):T{if(closed)throw new QueueBackendError('CLOSED');if(expected!==factory||handle.extension===undefined)throw new QueueBackendError('UNSUPPORTED_EXTENSION');return handle.extension as unknown as T;},
  async publish(queue:string,name:string,data:Record<string,unknown>,options:QueuePublishOptions={}){
   ensure(queue);queueName(name);queueOptionKeys(options,['delay','attempts']);
   if(options.delay!==undefined){queueInteger(options.delay,0,366*86400000);if(!caps.delay)throw new QueueBackendError('UNSUPPORTED_CAPABILITY');}
   if(options.attempts!==undefined){queueInteger(options.attempts,1,50);if(!caps.retry)throw new QueueBackendError('UNSUPPORTED_CAPABILITY');}
   const copy=payload(data,maxBytes);const settings={...options};return run(()=>handle.publish(queue,name,copy,settings));
  },
  async take(queue:string):Promise<QueueDelivery|undefined>{
   ensure(queue);if(!caps.pull)throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
   return run(async()=>{const delivery=await handle.take!(queue);if(!delivery)return;
    let data:Record<string,unknown>;try{queueName(delivery.name);data=payload(delivery.data,maxBytes);}catch(error){if(caps.acknowledgement&&typeof delivery.settle==='function')try{await delivery.settle('discard');}catch{/* Preserve the validation failure privately. */}throw error;}
    if(delivery.disposition!==(caps.acknowledgement?'manual':'consumed')||caps.acknowledgement&&typeof delivery.settle!=='function')throw new QueueBackendError('INVALID_DELIVERY');
    let settled=false;return {id:delivery.id,name:delivery.name,data,redelivered:delivery.redelivered,disposition:delivery.disposition,...(caps.acknowledgement?{async settle(disposition:QueueDisposition){ensure(queue);if(!['ack','discard','requeue'].includes(disposition)||settled)throw new QueueBackendError('INVALID_DISPOSITION');await run(async()=>{if(settled)throw new QueueBackendError('INVALID_DISPOSITION');settled=true;await delivery.settle!(disposition);});}}:{})};
   });
  },
  close(){if(closing)return closing;closed=true;closing=(async()=>{await Promise.allSettled([...pending]);await release();})();return closing;}
 };
}
