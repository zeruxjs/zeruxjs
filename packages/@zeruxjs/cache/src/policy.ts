import type {CacheCapabilities,CachePolicy,CacheSetOptions,CacheValue} from './types.js';
import {createCacheError} from './utils.js';
const fail=(code:string)=>createCacheError({code,message:code==='INVALID_TTL'?'ttlSeconds must be positive and finite':code.toLowerCase().replaceAll('_',' ')});
export const capabilityNames=['conditionalWrites','counters','namespaceClear','bulkAtomicity'] as const;
export function cachePolicy(raw:CachePolicy={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['maxBulk','maxPendingProducers','maxKeyBytes','maxValueBytes','maxDepth','requireCapabilities','ownHelper'].includes(k)))throw fail('INVALID_CACHE_POLICY');
 const limit=(v:unknown,n:number,max:number)=>{const x=v===undefined?n:v;if(typeof x!=='number'||!Number.isSafeInteger(x)||x<1||x>max)throw fail('INVALID_CACHE_LIMIT');return x;};
 if(raw.ownHelper!==undefined&&typeof raw.ownHelper!=='boolean')throw fail('INVALID_CACHE_POLICY');
 if(raw.requireCapabilities!==undefined&&(!Array.isArray(raw.requireCapabilities)||raw.requireCapabilities.length>4||raw.requireCapabilities.some(k=>!capabilityNames.includes(k))))throw fail('INVALID_CACHE_CAPABILITY');
 return {maxBulk:limit(raw.maxBulk,1000,10000),maxPendingProducers:limit(raw.maxPendingProducers,64,1024),maxKeyBytes:limit(raw.maxKeyBytes,1024,65536),maxValueBytes:limit(raw.maxValueBytes,1048576,16777216),maxDepth:limit(raw.maxDepth,32,64),ownHelper:raw.ownHelper??true,requireCapabilities:raw.requireCapabilities??[]};
}
export type EffectivePolicy=ReturnType<typeof cachePolicy>;
export function cacheCapabilities(raw:CacheCapabilities|undefined):Readonly<CacheCapabilities>{
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw fail('INVALID_CACHE_CAPABILITY');
 const result:CacheCapabilities={};for(const name of capabilityNames){const value=raw?.[name]??'unknown';if(!['supported','unsupported','unknown'].includes(value))throw fail('INVALID_CACHE_CAPABILITY');result[name]=value;}
 const ownership=raw?.ownership??'unknown';if(!['owned','borrowed','unknown'].includes(ownership))throw fail('INVALID_CACHE_CAPABILITY');result.ownership=ownership;return Object.freeze(result);
}
export function cacheKey(key:unknown,policy:EffectivePolicy){if(typeof key!=='string'||!key.length||Buffer.byteLength(key)>policy.maxKeyBytes)throw fail('INVALID_KEY');return key;}
export function cacheSetOptions(options:CacheSetOptions={}){if(!options||typeof options!=='object'||Array.isArray(options))throw fail('INVALID_CACHE_OPTIONS');for(const flag of ['ifAbsent','ifPresent'] as const)if(options[flag]!==undefined&&typeof options[flag]!=='boolean')throw fail('INVALID_CACHE_CONDITION');if(options.ifAbsent&&options.ifPresent)throw fail('CONFLICTING_CACHE_CONDITIONS');if(options.ttlSeconds!==undefined&&(typeof options.ttlSeconds!=='number'||!Number.isFinite(options.ttlSeconds)||options.ttlSeconds<=0||!Number.isFinite(options.ttlSeconds*1000)))throw fail('INVALID_TTL');return options;}
/** Bound traversal before serialization; reject getters, cycles and non-JSON data without invoking toJSON. */
export function cacheValue(value:CacheValue,policy:EffectivePolicy):CacheValue{
 let bytes=0,nodes=0;const seen=new WeakSet<object>();
 function visit(input:unknown,depth:number):void{
  if(++nodes>100000||depth>policy.maxDepth)throw fail('CACHE_VALUE_DEPTH_LIMIT');
  if(input===null||typeof input==='boolean'){bytes+=5;}
  else if(typeof input==='number'){if(!Number.isFinite(input))throw fail('INVALID_CACHE_VALUE');bytes+=String(input).length;}
  else if(typeof input==='string'){bytes+=Buffer.byteLength(input);}
  else if(input&&typeof input==='object'){
   if(seen.has(input)||!Array.isArray(input)&&![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw fail('INVALID_CACHE_VALUE');if(Object.hasOwn(input,'toJSON'))throw fail('INVALID_CACHE_VALUE');seen.add(input);bytes+=2;
   for(const key of Object.keys(input)){bytes+=Buffer.byteLength(key)+4;const descriptor=Object.getOwnPropertyDescriptor(input,key)!;if(!('value'in descriptor))throw fail('INVALID_CACHE_VALUE');visit(descriptor.value,depth+1);}seen.delete(input);
  }else throw fail('INVALID_CACHE_VALUE');
  if(bytes>policy.maxValueBytes)throw fail('CACHE_VALUE_BYTE_LIMIT');
 }
 visit(value,0);const text=JSON.stringify(value);if(Buffer.byteLength(text)>policy.maxValueBytes)throw fail('CACHE_VALUE_BYTE_LIMIT');return JSON.parse(text) as CacheValue;
}
export function cacheBulk(value:unknown,policy:EffectivePolicy):void{if(!Array.isArray(value)||value.length>policy.maxBulk)throw fail('CACHE_BULK_LIMIT');}
