import {MemcacheTextClient,validateKey,type TextConnectionOptions,type TextRequestOptions} from '@zeruxjs/cache-memcache/protocol';
import {copyData,invalid,integer,optionKeys} from './envelope.js';
export {MemcacheQError} from './envelope.js';
export interface MemcacheQOptions extends TextConnectionOptions {
 prefix?:string;
 /** Host-declared fixed-record/body ceiling; no protocol size discovery is assumed. */
 serverMaxBytes?:number;
 /** Accept old unversioned records; new writes always use V1. Default true for compatibility. */
 acceptLegacy?:boolean;
}
export interface MemcacheQMessage {name:string;data:Record<string,unknown>}
export function createMemcacheQ(options:MemcacheQOptions={}){
 optionKeys(options,['host','port','tls','timeoutMs','maxBytes','maxConcurrent','prefix','serverMaxBytes','acceptLegacy']);
 const prefix=validateKey(options.prefix??'zerux'),serverMax=integer(options.serverMaxBytes??65500,1,65500),maxBytes=integer(options.maxBytes??Math.min(32768,serverMax),1,serverMax),acceptLegacy=options.acceptLegacy??true;
 if(typeof acceptLegacy!=='boolean')throw invalid('MEMCACHEQ_INVALID_OPTIONS');
 const client=new MemcacheTextClient({host:options.host,port:options.port??22201,tls:options.tls,timeoutMs:options.timeoutMs,maxBytes,maxConcurrent:options.maxConcurrent});let closed=false;
 const key=(queue:string)=>{if(closed)throw invalid('MEMCACHEQ_CLOSED');return validateKey(`${prefix}:${validateKey(queue)}`);};
 const requestOptions=(settings:TextRequestOptions)=>{optionKeys(settings,['signal','deadline']);if(settings.signal!==undefined&&!(settings.signal instanceof AbortSignal)||settings.deadline!==undefined&&(!Number.isSafeInteger(settings.deadline)||settings.deadline<0))throw invalid('MEMCACHEQ_INVALID_OPTIONS');if(settings.signal?.aborted)throw invalid('MEMCACHEQ_CANCELLED');if(settings.deadline!==undefined&&settings.deadline<=Date.now())throw invalid('MEMCACHEQ_DEADLINE');return settings;};
 return {
  capabilities:Object.freeze({acknowledgement:false,delay:false,retry:false,destructiveRead:true}),
  async add(queue:string,name:string,data:Record<string,unknown>,settings:TextRequestOptions={}):Promise<void>{
   const destination=key(queue);validateKey(name);requestOptions(settings);const body=Buffer.from(JSON.stringify({version:1,name,data:copyData(data,maxBytes)}));if(body.length>maxBytes)throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
   let reply;try{reply=await client.request(Buffer.concat([Buffer.from(`set ${destination} 0 0 ${body.length}\r\n`),body,Buffer.from('\r\n')]),settings);}catch(cause){throw invalid('MEMCACHEQ_WRITE_UNKNOWN',cause);}
   if(reply.line!=='STORED')throw invalid('MEMCACHEQ_APPEND_REJECTED');
  },
  /** Destructive pop; cancellation or a malformed reply may already have lost the message. */
  async take(queue:string,settings:TextRequestOptions={}):Promise<MemcacheQMessage|undefined>{
   const destination=key(queue);requestOptions(settings);let reply;
   try{reply=await client.request(`get ${destination}\r\n`,settings);}catch(cause){throw invalid('MEMCACHEQ_POP_UNKNOWN',cause);}
   if(reply.line!=='END'||reply.values.length>1||reply.values.length===1&&reply.values[0].key!==destination)throw invalid('MEMCACHEQ_INVALID_POPPED_MESSAGE');
   if(!reply.values.length)return;
   try{if(reply.values[0].value.length>maxBytes)throw 0;const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reply.values[0].value));optionKeys(envelope,['version','name','data']);if(envelope.version!==1&&!(acceptLegacy&&!Object.hasOwn(envelope,'version')))throw 0;validateKey(envelope.name);return {name:envelope.name,data:copyData(envelope.data,maxBytes)};}
   catch(cause){throw invalid('MEMCACHEQ_INVALID_POPPED_MESSAGE',cause);}
  },
  close(){if(closed)return;closed=true;client.close();},
  whenClosed(){return client.whenClosed();},
  get activeSocketCount(){return client.activeSocketCount;}
 };
}
export type MemcacheQ=ReturnType<typeof createMemcacheQ>;
