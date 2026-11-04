import {redisError} from "./policy.js";
import type { CacheValue } from "@zeruxjs/cache";

const validateJson=(value:unknown)=>{let nodes=0,bytes=0;const seen=new WeakSet<object>();const walk=(input:unknown,depth:number)=>{if(depth>32||++nodes>100000)throw redisError('REDIS_JSON_LIMIT');if(input===null||typeof input==='boolean'||typeof input==='number'&&Number.isFinite(input)){bytes+=JSON.stringify(input).length;if(bytes>1048576)throw redisError('REDIS_JSON_LIMIT');return;}if(typeof input==='string'){bytes+=Buffer.byteLength(input)+2;if(bytes>1048576)throw redisError('REDIS_JSON_LIMIT');return;}if(!input||typeof input!=='object'||seen.has(input)||!Array.isArray(input)&&![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.hasOwn(input,'toJSON'))throw redisError('REDIS_INVALID_JSON');seen.add(input);bytes+=2;if(Array.isArray(input)&&input.length>100000)throw redisError('REDIS_JSON_LIMIT');const keys=Array.isArray(input)?Array.from({length:input.length},(_,i)=>String(i)):Object.keys(input);for(const key of keys){if(!Array.isArray(input))bytes+=Buffer.byteLength(key)+3;if(bytes>1048576)throw redisError('REDIS_JSON_LIMIT');const property=Object.getOwnPropertyDescriptor(input,key);if(!property||!('value'in property))throw redisError('REDIS_INVALID_JSON');walk(property.value,depth+1);}seen.delete(input);};walk(value,0);};
export const serialize=(value:CacheValue):string=>{if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value))throw redisError('REDIS_COUNTER_RANGE');validateJson(value);const result=JSON.stringify(value);if(Buffer.byteLength(result)>1048576)throw redisError('REDIS_JSON_LIMIT');return result;};
export const deserialize=(encoded:string):CacheValue=>{
 if(typeof encoded!=='string'||Buffer.byteLength(encoded)>1048576)throw redisError('REDIS_JSON_LIMIT');
 let parsed:CacheValue;try{parsed=JSON.parse(encoded) as CacheValue;}catch(cause){throw redisError('REDIS_INVALID_JSON',cause);}validateJson(parsed);
 // Native counters and plain numeric cache values share the same representation.
 if(typeof parsed==='number'&&Number.isInteger(parsed)&&!Number.isSafeInteger(parsed))throw redisError('REDIS_COUNTER_RANGE');
 return parsed;
};
export const expiration = (seconds?: number): number | undefined => {
    if (seconds === undefined) return undefined;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError("Cache TTL must be positive and finite");
    const result = Math.ceil(seconds);
    if (!Number.isSafeInteger(result) || result > 2147483647) throw new RangeError("Cache TTL exceeds Redis EX range");
    return result;
};
export const counterAmount = (amount: number): number => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Counter amount must be a non-negative safe integer");
    return amount;
};
/** Escape Redis glob wildcards for SCAN MATCH; also filter results by literal prefix. */
export const prefixGlob = (prefix: string): string => prefix.replace(/[\\*?[\]]/g, "\\$&") + ":*";
