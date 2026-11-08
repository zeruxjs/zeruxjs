/** Server-only, application-owned route data caching. Never caches response headers/cookies. */
import { createHash, randomBytes } from 'node:crypto';
import type { CacheManager, CacheValue } from '@zeruxjs/cache';
import { cached, type CachedResult } from './response.js';
export interface RouteDataScope { tenant:string; /** Required for authenticated/personalized data. */ principal?:string }
export interface RouteDataKey { route:string; path:string; params?:Record<string,string>; locale:string; scope:RouteDataScope }
export interface RouteDataPolicy { freshMs:number; staleMs:number; tags?:string[]; /** Explicit opt-in for anonymous public data only. */ public?:boolean }
export interface RouteDataContext { signal:AbortSignal; deadline:number }
export interface RouteDataResult { value:CacheValue; state:'fresh'|'stale'|'loaded'; /** Keeps existing content-derived conditional ETag behavior. */ response():CachedResult }
export interface RouteDataCacheOptions { application:string; cache:CacheManager; coordination?:'process'|'distributed'; maxEntries?:number; maxPending?:number; timeoutMs?:number; maxBytes?:number; development?:boolean; now?:()=>number }
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
function text(value:unknown,max=256):asserts value is string {if(typeof value!=='string'||!value.length||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new TypeError('Invalid route cache identifier');}
function integer(value:number,max:number){if(!Number.isSafeInteger(value)||value<1||value>max)throw new TypeError('Invalid route cache budget');return value;}
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
/** Host supplies verified scope, never request-supplied tenant/principal fields. */
export function routeDataCacheKey(application:string,input:RouteDataKey):string {
 text(application);text(input.route);text(input.path,2048);text(input.locale,64);text(input.scope?.tenant);if(input.scope.principal!==undefined)text(input.scope.principal);
 if(!input.path.startsWith('/')||input.path.includes('?')||input.path.includes('#')||input.path.includes('\\')||input.path.split('/').some(x=>x==='.'||x==='..'))throw new TypeError('Invalid route cache path');
 const params=input.params??{};if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).length>32)throw new TypeError('Invalid route cache parameters');
 const pairs=Object.keys(params).sort().map(k=>{text(k,128);text(params[k],2048);return [k,params[k]];});
 return digest([application,input.scope.tenant,input.scope.principal??null,input.route,input.path,input.locale,pairs]);
}
export function createRouteDataCache(options:RouteDataCacheOptions){
 text(options.application);if(options.coordination!==undefined&&options.coordination!=='process')throw new TypeError('Distributed invalidation requires an atomic fencing contract; unavailable');
 if(!options.cache||typeof options.cache.get!=='function'||typeof options.cache.set!=='function')throw new TypeError('Invalid cache manager');
 const maxEntries=integer(options.maxEntries??1024,100000),maxPending=integer(options.maxPending??16,1024),timeout=integer(options.timeoutMs??5000,60000),maxBytes=integer(options.maxBytes??1048576,16777216);
 const now=options.now??Date.now, namespace=`rd:${digest(options.application)}:${randomBytes(16).toString('hex')}:`, shutdown=new AbortController();
 type Entry={token:object;storage:string;tenant:string;path:string;tags:string[];policy:string};
 const entries=new Map<string,Entry>(),pending=new Map<object,Promise<RouteDataResult>>(),work=new Set<Promise<unknown>>();let closed=false;
 function copy(value:unknown):CacheValue {const seen=new Set<object>();function check(v:unknown,depth:number):void{if(depth>32)throw new TypeError('Route data nesting exceeded');if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return;if(!v||typeof v!=='object'||seen.has(v))throw new TypeError('Route data must be public JSON');if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw new TypeError('Route data must be plain JSON');seen.add(v);for(const key of Object.keys(v)){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!('value'in d))throw new TypeError('Route data accessor denied');check(d.value,depth+1);}seen.delete(v);}check(value,0);const json=JSON.stringify(value);if(Buffer.byteLength(json)>maxBytes)throw new RangeError('Route data budget exceeded');return JSON.parse(json);}
 function result(value:CacheValue,state:RouteDataResult['state'],isPublic:boolean,fresh:number):RouteDataResult {const snapshot=copy(value);return {get value(){return copy(snapshot);},state,response:()=>cached(copy(snapshot),isPublic?{visibility:'public',maxAge:Math.floor(fresh/1000),etag:true}:{visibility:'no-store',etag:true})};}
 function wait<T>(job:Promise<T>,signal?:AbortSignal):Promise<T>{if(!signal)return job;if(signal.aborted)return Promise.reject(new Error('Route data cancelled'));return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Route data cancelled'));signal.addEventListener('abort',abort,{once:true});job.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
 return {
  coordination:'process' as const,
  capabilities:options.cache.capabilities,
  async load(input:RouteDataKey,policy:RouteDataPolicy,producer:(context:RouteDataContext)=>CacheValue|Promise<CacheValue>,signal?:AbortSignal):Promise<RouteDataResult>{
   if(closed)throw new Error('Route cache closed');signal?.throwIfAborted();const key=routeDataCacheKey(options.application,input);
   const fresh=integer(policy.freshMs,86400000);if(!Number.isSafeInteger(policy.staleMs)||policy.staleMs<0||policy.staleMs>86400000)throw new TypeError('Invalid stale window');
   if(policy.public!==undefined&&typeof policy.public!=='boolean'||policy.public&&input.scope.principal!==undefined)throw new TypeError('Personalized data cannot be public');
   const tags=[...new Set(policy.tags??[])];if(!Array.isArray(policy.tags??[])||tags.length>32)throw new TypeError('Invalid cache tags');for(const tag of tags)text(tag,128);
   const stale=policy.staleMs,isPublic=policy.public===true;const fingerprint=digest([fresh,stale,tags.slice().sort(),isPublic]);let entry=entries.get(key);
   if(entry&&entry.policy!==fingerprint){entries.delete(key);entry=undefined;}
   if(!entry){if(entries.size>=maxEntries)entries.delete(entries.keys().next().value!);entry={token:{},storage:namespace+randomBytes(16).toString('hex'),tenant:digest(input.scope.tenant),path:input.path,tags,policy:fingerprint};entries.set(key,entry);}
   const captured=entry;
   const refresh=()=>{let job=pending.get(captured.token);if(job)return job;if(work.size>=maxPending)throw new Error('Route cache refresh capacity exceeded');
    const controller=new AbortController(),deadline=now()+timeout;const abort=()=>controller.abort();shutdown.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeout);
    job=(async()=>{const value=copy(await producer({signal:controller.signal,deadline}));controller.signal.throwIfAborted();if(entries.get(key)!==captured)throw new Error('Route data invalidated during refresh');const at=now();await options.cache.set(captured.storage,{version:1,at,value},{ttlSeconds:Math.ceil((fresh+stale)/1000)});controller.signal.throwIfAborted();if(entries.get(key)!==captured)throw new Error('Route data invalidated during refresh');return result(value,'loaded',isPublic,fresh);})();
    pending.set(captured.token,job);work.add(job);void job.finally(()=>{clearTimeout(timer);shutdown.signal.removeEventListener('abort',abort);pending.delete(captured.token);work.delete(job!);}).catch(()=>{});return job;
   };
   // A cache outage is explicit. Never call a producer as a silent outage fallback.
   if(work.size>=maxPending)throw new Error('Route cache capacity exceeded');const read=Promise.resolve().then(()=>options.development?undefined:options.cache.get(captured.storage));work.add(read);void read.finally(()=>work.delete(read)).catch(()=>{});const raw=await wait(read,signal);signal?.throwIfAborted();if(closed)throw new Error('Route cache closed');
   if(entries.get(key)!==captured)throw new Error('Route data invalidated during read');
   if(raw!==undefined){if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||typeof raw.at!=='number'||!Number.isFinite(raw.at)||!('value'in raw))throw new Error('Invalid route cache record');const age=now()-raw.at;if(age>=0&&age<fresh)return result(raw.value,'fresh',isPublic,fresh-age);if(age>=fresh&&age<fresh+stale){try{void refresh().catch(()=>{});}catch{ /* Refresh admission can fail; serving the already-valid stale value remains allowed. */ }return result(raw.value,'stale',false,0);}}
   return wait(refresh(),signal);
  },
  /** Server-only. HTTP callers must authorize tenant/action before invoking. */
  invalidate(input:{tenant:string;tag?:string;path?:string}){if(closed)throw new Error('Route cache closed');text(input.tenant);if((input.tag===undefined)===(input.path===undefined))throw new TypeError('Select one tag or path');if(input.tag!==undefined)text(input.tag,128);if(input.path!==undefined)text(input.path,2048);let count=0;for(const [key,e]of entries)if(e.tenant===digest(input.tenant)&&(input.tag!==undefined?e.tags.includes(input.tag):e.path===input.path)){entries.delete(key);count++;}return count;},
  status(){return {entries:entries.size,pending:work.size};},
  async close(){closed=true;shutdown.abort();entries.clear();await Promise.allSettled([...work]);}
 };
}
