import type { CacheHelper, CacheHelperFactory, CacheSetOptions, CacheValue } from '@zeruxjs/cache';
import { MemcacheTextClient, validateKey, type TextConnectionOptions, type TextRequestOptions } from './protocol.js';
import {encodeJson,decodeJson} from './json.js';
import {memcacheError} from './errors.js';
export {MemcacheError} from './errors.js';
export type {TextRequestOptions} from './protocol.js';
export interface MemcacheOptions extends TextConnectionOptions { allowFlushAll?: boolean;maxDepth?:number }
export interface MemcacheSetOptions extends CacheSetOptions,TextRequestOptions {}
export interface MemcacheHelper extends CacheHelper {
  get(key:string,options?:TextRequestOptions):Promise<CacheValue|undefined>;
  set(key:string,value:CacheValue,options?:MemcacheSetOptions):Promise<void>;
  close():Promise<void>;
  native():MemcacheTextClient;
}
const expiration = (seconds?: number): number => {
  if (seconds === undefined) return 0;
  if (typeof seconds!=='number'||!Number.isFinite(seconds) || seconds <= 0 || seconds > 365 * 86400) throw memcacheError('MEMCACHE_INVALID_TTL');
  const rounded = Math.ceil(seconds);
  return rounded > 30 * 86400 ? Math.floor(Date.now() / 1000) + rounded : rounded;
};
const setOptions=(opts:MemcacheSetOptions={})=>{
  if(!opts||typeof opts!=='object'||Array.isArray(opts))throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  for(const flag of ['ifAbsent','ifPresent'] as const)if(opts[flag]!==undefined&&typeof opts[flag]!=='boolean')throw memcacheError('MEMCACHE_INVALID_CONDITION');
  if(opts.ifAbsent&&opts.ifPresent)throw memcacheError('MEMCACHE_CONDITION_CONFLICT');
  return expiration(opts.ttlSeconds);
};
/** Lazy owned sockets, validated JSON boundaries and native add/replace. No pooling/retries/sharding. */
export function createMemcacheHelper(input:MemcacheOptions={}):MemcacheHelper{
  if(!input||typeof input!=='object'||Array.isArray(input))throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  if('servers'in input||'options'in input)throw memcacheError('MEMCACHE_LEGACY_CONFIG_UNSUPPORTED');
  const allowed=['host','port','tls','timeoutMs','maxBytes','maxConcurrent','allowFlushAll','maxDepth'];
  if(Object.keys(input).some(key=>!allowed.includes(key))||input.allowFlushAll!==undefined&&typeof input.allowFlushAll!=='boolean')throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  const options={...input},maxBytes=options.maxBytes??1048576,maxDepth=options.maxDepth??32;
  if(options.maxDepth===null||!Number.isSafeInteger(maxDepth)||maxDepth<1||maxDepth>64)throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  const client=new MemcacheTextClient(options);let closed=false,closing:Promise<void>|undefined;
  const open=()=>{if(closed)throw memcacheError('MEMCACHE_CLOSED');};
  const request=(command:string|Buffer,opts?:TextRequestOptions)=>{open();return client.request(command,opts);};
  const get=async(key:string,opts?:TextRequestOptions):Promise<CacheValue|undefined>=>{
    const reply=await request(`get ${validateKey(key)}\r\n`,opts);
    if(reply.line!=='END'||reply.values.length>1||reply.values.length===1&&reply.values[0].key!==key)throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
    return reply.values.length?decodeJson(reply.values[0].value,maxBytes,maxDepth):undefined;
  };
  const store=async(key:string,body:Buffer,opts:MemcacheSetOptions,ttl:number)=>{
    const reply=await request(Buffer.concat([Buffer.from(`${opts.ifAbsent?'add':opts.ifPresent?'replace':'set'} ${key} 0 ${ttl} ${body.length}\r\n`),body,Buffer.from('\r\n')]),opts);
    if(!['STORED','NOT_STORED','EXISTS','NOT_FOUND'].includes(reply.line))throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
  };
  const set=async(key:string,value:CacheValue,opts:MemcacheSetOptions={})=>{open();validateKey(key);const ttl=setOptions(opts),body=encodeJson(value,maxBytes,maxDepth);await store(key,body,opts,ttl);};
  const remove=async(key:string)=>{const {line}=await request(`delete ${validateKey(key)}\r\n`);if(!['DELETED','NOT_FOUND'].includes(line))throw memcacheError('MEMCACHE_PROTOCOL_ERROR');return line==='DELETED';};
  const counter=async(key:string,amount:number,command:string)=>{
    if(!Number.isSafeInteger(amount)||amount<0)throw memcacheError('MEMCACHE_INVALID_AMOUNT');
    const {line}=await request(`${command} ${validateKey(key)} ${amount}\r\n`);
    if(line==='NOT_FOUND')throw memcacheError('MEMCACHE_COUNTER_MISSING');
    const result=Number(line);if(!/^\d+$/.test(line)||!Number.isSafeInteger(result))throw memcacheError('MEMCACHE_COUNTER_RANGE');return result;
  };
  const keys=(value:unknown):string[]=>{open();if(!Array.isArray(value)||value.length>1000)throw memcacheError('MEMCACHE_BULK_LIMIT');return value.map(validateKey);};
  return {
    capabilities:Object.freeze({conditionalWrites:'supported',counters:'supported',namespaceClear:'unsupported',bulkAtomicity:'unsupported',ownership:'owned'}),
    get,set,delete:remove,has:async key=>(await get(key))!==undefined,
    async clear(){open();if(options.allowFlushAll!==true)throw memcacheError('MEMCACHE_GLOBAL_CLEAR_DISABLED');if((await request('flush_all\r\n')).line!=='OK')throw memcacheError('MEMCACHE_PROTOCOL_ERROR');},
    clearPrefix(){open();throw memcacheError('MEMCACHE_NAMESPACE_CLEAR_UNSUPPORTED');},
    async getMany(input){const all=keys(input),result:Record<string,CacheValue|undefined>=Object.create(null);let bytes=0;for(const key of all){const value=await get(key);if(value!==undefined)bytes+=encodeJson(value,maxBytes,maxDepth).length;if(bytes>maxBytes)throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');result[key]=value;}return result;},
    async setMany(values,opts={}){open();if(!values||typeof values!=='object'||Array.isArray(values))throw memcacheError('MEMCACHE_INVALID_JSON');const all=keys(Object.keys(values)),ttl=setOptions(opts);let bytes=0;const prepared=all.map(key=>{const property=Object.getOwnPropertyDescriptor(values,key)!;if(!('value'in property))throw memcacheError('MEMCACHE_INVALID_JSON');const body=encodeJson(property.value,maxBytes,maxDepth);bytes+=body.length;if(bytes>maxBytes)throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');return {key,body};});for(const {key,body} of prepared)await store(key,body,opts,ttl);},
    async deleteMany(input){const all=keys(input);let count=0;for(const key of all)count+=Number(await remove(key));return count;},
    increment:(key,amount=1)=>counter(key,amount,'incr'),decrement:(key,amount=1)=>counter(key,amount,'decr'),
    async touch(key,ttl){if(ttl===undefined)throw memcacheError('MEMCACHE_INVALID_TTL');const {line}=await request(`touch ${validateKey(key)} ${expiration(ttl)}\r\n`);if(!['TOUCHED','NOT_FOUND'].includes(line))throw memcacheError('MEMCACHE_PROTOCOL_ERROR');return line==='TOUCHED';},
    close(){closed=true;client.close();return closing??=client.whenClosed();},native(){open();return client;}
  };
}
/** Dynamic cache factory. Legacy multi-server configuration is deliberately rejected. */
export const createCacheHelper:CacheHelperFactory=options=>createMemcacheHelper(options as MemcacheOptions);
export default createCacheHelper;
