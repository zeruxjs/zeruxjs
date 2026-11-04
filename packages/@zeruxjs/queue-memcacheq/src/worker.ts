import {setMaxListeners} from 'node:events';
import {validateKey} from '@zeruxjs/cache-memcache/protocol';
import {createMemcacheQ,type MemcacheQOptions,type MemcacheQMessage} from './client.js';
import {integer,invalid,optionKeys,MemcacheQError} from './envelope.js';
export interface MemcacheQWorkerJob extends MemcacheQMessage {readonly signal:AbortSignal}
export interface MemcacheQWorkerErrorNotice {readonly code:string;readonly phase:'poll'|'handler'|'timeout';readonly mayHaveLostMessage:boolean}
export interface MemcacheQWorkerOptions {
 connection:MemcacheQOptions&{serverMaxBytes:number};
 queues:readonly {name:string;handler:(job:MemcacheQWorkerJob)=>void|Promise<void>}[];
 concurrency?:number;processingMs?:number;drainMs?:number;
 idle?:{minMs?:number;maxMs?:number;factor?:number;jitter?:number};
 random?:()=>number;signal?:AbortSignal;onError?:(notice:MemcacheQWorkerErrorNotice)=>void|Promise<void>;
}
export interface MemcacheQWorkerStatus {
 state:'running'|'closing'|'incomplete'|'closed'|'failed';
 pendingReads:number;activeHandlers:number;activeSockets:number;pendingTimers:number;pendingErrorHooks:number;
 emptyPolls:number;completed:number;handlerFailures:number;pollFailures:number;timeouts:number;
 hookFailures:number;droppedNotices:number;lastIdleMs:number;
}
/** Every pop is destructive. Never reinserts, acknowledges or retries a failed job. */
export function createMemcacheQWorker(options:MemcacheQWorkerOptions){
 optionKeys(options,['connection','queues','concurrency','processingMs','drainMs','idle','random','signal','onError']);
 if(!options.connection||options.connection.serverMaxBytes===undefined||!Array.isArray(options.queues)||!options.queues.length||options.queues.length>32)throw invalid('MEMCACHEQ_INVALID_OPTIONS');
 const concurrency=integer(options.concurrency??4,1,64),processingMs=integer(options.processingMs??30000,1,300000),drainMs=integer(options.drainMs??30000,1,300000);
 if(options.idle!==undefined)optionKeys(options.idle,['minMs','maxMs','factor','jitter']);
 const min=integer(options.idle?.minMs??25,1,30000),max=integer(options.idle?.maxMs??1000,min,30000),factor=options.idle?.factor??2,jitter=options.idle?.jitter??0.2;
 if(typeof factor!=='number'||!Number.isFinite(factor)||factor<1||factor>8||typeof jitter!=='number'||!Number.isFinite(jitter)||jitter<0||jitter>1||options.random!==undefined&&typeof options.random!=='function'||options.onError!==undefined&&typeof options.onError!=='function'||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw invalid('MEMCACHEQ_INVALID_OPTIONS');
 const random=options.random??Math.random,onError=options.onError,externalSignal=options.signal;
 const definitions=options.queues.map(q=>{optionKeys(q,['name','handler']);validateKey(q.name);validateKey(`${options.connection.prefix??'zerux'}:${q.name}`);if(typeof q.handler!=='function')throw invalid('MEMCACHEQ_INVALID_OPTIONS');return {name:q.name,handler:q.handler};});if(new Set(definitions.map(q=>q.name)).size!==definitions.length)throw invalid('MEMCACHEQ_INVALID_OPTIONS');
 if(options.connection.maxConcurrent!==undefined&&options.connection.maxConcurrent<concurrency)throw invalid('MEMCACHEQ_INVALID_OPTIONS');
 // No sockets are opened until polling starts. Worker defaults to explicit V1 envelopes.
 const client=createMemcacheQ({...options.connection,acceptLegacy:options.connection.acceptLegacy??false,maxConcurrent:options.connection.maxConcurrent??concurrency});
 const polling=new AbortController();setMaxListeners(concurrency+4,polling.signal);
 const controllers=new Set<AbortController>(),timers=new Set<ReturnType<typeof setTimeout>>(),hooks=new Set<Promise<void>>();
 let stopping=false,settled=false,closeReturned=false,fatal=false,closing:Promise<void>|undefined,cursor=0,reads=0,active=0,emptyPolls=0,completed=0,handlerFailures=0,pollFailures=0,timeouts=0,hookFailures=0,droppedNotices=0,lastIdleMs=0;
 function report(notice:MemcacheQWorkerErrorNotice){
  if(!onError)return;if(hooks.size){droppedNotices++;return;}
  let hook:Promise<void>;try{hook=Promise.resolve(onError(Object.freeze(notice))).catch(()=>{hookFailures++;}).finally(()=>hooks.delete(hook));hooks.add(hook);}catch{hookFailures++;}
 }
 function pause(base:number):Promise<void>{
  const value=random();if(!Number.isFinite(value)||value<0||value>1)throw invalid('MEMCACHEQ_INVALID_RANDOM');
  const delay=Math.max(min,Math.min(max,Math.round(base*(1-jitter+2*jitter*value))));lastIdleMs=delay;
  if(stopping)return Promise.resolve();return new Promise(resolve=>{const done=()=>{clearTimeout(timer);timers.delete(timer);polling.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,delay);timers.add(timer);polling.signal.addEventListener('abort',done,{once:true});if(polling.signal.aborted)done();});
 }
 async function process(definition:typeof definitions[number],message:MemcacheQMessage){
  const controller=new AbortController();controllers.add(controller);active++;let timedOut=false;
  const clear=()=>{clearTimeout(timer);timers.delete(timer);};
  const timer=setTimeout(()=>{timers.delete(timer);timedOut=true;timeouts++;controller.abort();report({code:'MEMCACHEQ_PROCESSING_TIMEOUT',phase:'timeout',mayHaveLostMessage:true});},processingMs);timers.add(timer);controller.signal.addEventListener('abort',clear,{once:true});
  try{await definition.handler({...message,signal:controller.signal});if(!timedOut)completed++;}catch{if(!timedOut){handlerFailures++;report({code:'MEMCACHEQ_HANDLER_FAILED',phase:'handler',mayHaveLostMessage:true});}}
  finally{clear();controller.signal.removeEventListener('abort',clear);controllers.delete(controller);active--;}
 }
 async function lane(){let idle=min;
  try{while(!stopping){const definition=definitions[cursor++%definitions.length];let message:MemcacheQMessage|undefined,failedRead=false;reads++;
   try{message=await client.take(definition.name,{signal:polling.signal});}catch(error){if(stopping)return;failedRead=true;pollFailures++;report({code:error instanceof MemcacheQError?error.code:'MEMCACHEQ_POP_UNKNOWN',phase:'poll',mayHaveLostMessage:true});}finally{reads--;}
   if(stopping)return;
   if(message){idle=min;await process(definition,message);}
   else{if(!failedRead)emptyPolls++;await pause(idle);idle=Math.min(max,idle*factor);}
  }}catch{fatal=true;report({code:'MEMCACHEQ_WORKER_FAILED',phase:'poll',mayHaveLostMessage:false});void close();}
 }
 const lanes=Array.from({length:concurrency},()=>Promise.resolve().then(lane));
 const closed=Promise.allSettled(lanes).then(async()=>{await client.whenClosed();await Promise.allSettled([...hooks]);settled=true;});
 async function close():Promise<void>{
  if(closing)return closing;stopping=true;polling.abort();client.close();externalSignal?.removeEventListener('abort',abort);
  closing=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([closed,new Promise<void>(resolve=>{timer=setTimeout(resolve,drainMs);timers.add(timer);})]);}finally{if(timer){clearTimeout(timer);timers.delete(timer);}for(const controller of controllers)controller.abort();closeReturned=true;}})();return closing;
 }
 const abort=()=>{void close();};externalSignal?.addEventListener('abort',abort,{once:true});if(externalSignal?.aborted)void close();
 return {capabilities:Object.freeze({acknowledgement:false,retry:false,delay:false,priority:false,destructiveRead:true,push:true}),close,closed,
  status():MemcacheQWorkerStatus{return {state:!stopping?'running':settled?(fatal?'failed':'closed'):closeReturned?'incomplete':'closing',pendingReads:reads,activeHandlers:active,activeSockets:client.activeSocketCount,pendingTimers:timers.size,pendingErrorHooks:hooks.size,emptyPolls,completed,handlerFailures,pollFailures,timeouts,hookFailures,droppedNotices,lastIdleMs};}
 };
}
