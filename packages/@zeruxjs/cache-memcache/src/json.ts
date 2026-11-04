import type {CacheValue} from '@zeruxjs/cache';
import {memcacheError} from './errors.js';
/** Encode only JSON data, measuring exact UTF-8 output bytes before opening a socket. */
export function encodeJson(value:CacheValue,maxBytes:number,maxDepth:number):Buffer{
  const parts:string[]=[],seen=new WeakSet<object>();let size=0,nodes=0;
  const append=(part:string)=>{size+=Buffer.byteLength(part);if(size>maxBytes)throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');parts.push(part);};
  const text=(value:string)=>{if(Buffer.byteLength(value)>maxBytes)throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');return JSON.stringify(value);};
  const visit=(input:unknown,depth:number)=>{
    if(depth>maxDepth||++nodes>100000)throw memcacheError('MEMCACHE_DEPTH_LIMIT');
    if(input===null||typeof input==='boolean'){append(String(input));return;}
    if(typeof input==='string'){append(text(input));return;}
    if(typeof input==='number'&&Number.isFinite(input)){append(JSON.stringify(input));return;}
    if(!input||typeof input!=='object'||seen.has(input)||!Array.isArray(input)&&![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw memcacheError('MEMCACHE_INVALID_JSON');
    seen.add(input);const array=Array.isArray(input);if(Object.hasOwn(input,'toJSON'))throw memcacheError('MEMCACHE_INVALID_JSON');
    if(array&&input.length>100000)throw memcacheError('MEMCACHE_DEPTH_LIMIT');
    append(array?'[':'{');const keys=array?Array.from({length:input.length},(_,index)=>String(index)):Object.keys(input);if(keys.length>100000)throw memcacheError('MEMCACHE_DEPTH_LIMIT');
    let first=true;for(const key of keys){const property=Object.getOwnPropertyDescriptor(input,key);if(!property||!('value'in property))throw memcacheError('MEMCACHE_INVALID_JSON');if(!first)append(',');first=false;if(!array){append(text(key));append(':');}visit(property.value,depth+1);}
    append(array?']':'}');seen.delete(input);
  };
  visit(value,0);return Buffer.from(parts.join(''));
}
export function decodeJson(value:Buffer,maxBytes:number,maxDepth:number):CacheValue{
  if(value.length>maxBytes)throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
  let parsed:CacheValue;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value)) as CacheValue;}catch(cause){throw memcacheError('MEMCACHE_INVALID_JSON',cause);}
  encodeJson(parsed,maxBytes,maxDepth);return parsed;
}
