import type {TagContainer,Values} from './types.js';
export class TagAdminClientError extends Error {
 constructor(readonly code:'conflict'|'denied'|'invalid'|'unavailable'|'cancelled'|'closed'|'overload',readonly status:number,readonly committed=false,readonly version?:number,readonly uncertain=false){super(`Tag administration ${code}`);this.name='TagAdminClientError';}
}
export interface TagAdminClientOptions {apiBaseUrl:string;origin?:string;fetch?:typeof fetch;csrfToken?:(signal:AbortSignal)=>string|Promise<string>;timeoutMs?:number;maxConcurrent?:number}
/** Browser-safe headless client. Never caches credentials, retries mutations or publishes on save. */
export function createTagAdminClient(options:TagAdminClientOptions){
 const base=new URL(options.apiBaseUrl,options.origin??globalThis.location?.origin);if(base.username||base.password||base.search||base.hash||!/^\/[A-Za-z0-9/_-]+$/.test(base.pathname)||base.pathname.includes('//')||base.pathname.endsWith('/')||base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new TypeError('Explicit admin API base required');
 const timeout=options.timeoutMs??10000,max=options.maxConcurrent??4,fetcher=options.fetch??globalThis.fetch;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000||!Number.isSafeInteger(max)||max<1||max>16||typeof fetcher!=='function'||options.csrfToken!==undefined&&typeof options.csrfToken!=='function')throw new TypeError('Invalid admin client policy');
 const controllers=new Set<AbortController>(),jobs=new Set<Promise<unknown>>();let closed=false,closing:Promise<void>|undefined;
 async function request(path:string,method:string,body?:unknown,signal?:AbortSignal):Promise<any>{
  if(closed)throw new TagAdminClientError('closed',0);if(jobs.size>=max)throw new TagAdminClientError('overload',0);if(signal!==undefined&&!(signal instanceof AbortSignal))throw new TypeError('Invalid cancellation');
  const encoded=body===undefined?undefined:JSON.stringify(body);if(encoded!==undefined&&new TextEncoder().encode(encoded).byteLength>131072)throw new TagAdminClientError('invalid',413);
  let sent=false;const c=new AbortController(),abort=()=>c.abort();controllers.add(c);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();let stop=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(new TagAdminClientError('cancelled',0,false,undefined,sent&&method!=='GET'));c.signal.addEventListener('abort',stop,{once:true});if(c.signal.aborted)stop();});const timer=setTimeout(abort,timeout);
  const native=(async()=>{try{if(c.signal.aborted)throw new TagAdminClientError('cancelled',0);const headers:Record<string,string>={accept:'application/json'};if(encoded!==undefined){headers['content-type']='application/json';const token=await options.csrfToken?.(c.signal);if(token!==undefined){if(typeof token!=='string'||token.length>1024||/[\x00-\x1f]/.test(token))throw new TagAdminClientError('invalid',0);headers['x-zerux-csrf']=token;}}
   if(c.signal.aborted)throw new TagAdminClientError('cancelled',0);sent=true;const response=await fetcher(base.href+path,{method,body:encoded,headers,credentials:'include',cache:'no-store',redirect:'error',signal:c.signal});if(!response.body)throw new TagAdminClientError('unavailable',response.status);const reader=response.body.getReader();const cancelReader=()=>{void reader.cancel().catch(()=>{});};c.signal.addEventListener('abort',cancelReader,{once:true});const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
   try{while(true){if(c.signal.aborted)throw new TagAdminClientError('cancelled',0);const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>131072)throw new TagAdminClientError('invalid',413);text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{c.signal.removeEventListener('abort',cancelReader);await reader.cancel().catch(()=>{});reader.releaseLock();}
   if(c.signal.aborted)throw new TagAdminClientError('cancelled',0);const value=JSON.parse(text);if(!response.ok)throw new TagAdminClientError(response.status===409?'conflict':response.status===401||response.status===403?'denied':response.status===422||response.status===413?'invalid':'unavailable',response.status,value?.committed===true,Number.isSafeInteger(value?.version)?value.version:undefined,value?.committed==='unknown');return value;
  }catch(error){if(error instanceof TagAdminClientError)throw error;throw new TagAdminClientError(c.signal.aborted?'cancelled':'unavailable',0,false,undefined,sent&&method!=='GET');}})().finally(()=>{jobs.delete(native);controllers.delete(c);});jobs.add(native);
  try{return await Promise.race([native,cancelled]);}finally{clearTimeout(timer);c.signal.removeEventListener('abort',stop);signal?.removeEventListener('abort',abort);}
 }
 return {
  load:(signal?:AbortSignal):Promise<TagContainer>=>request('/api','GET',undefined,signal),
  /** Full-document CRUD. Caller submits next revision; no implicit merge or auto retry on 409. */
  save:(document:TagContainer,signal?:AbortSignal)=>request('/api','PUT',document,signal),
  validate:(document:TagContainer,signal?:AbortSignal)=>request('/validate','POST',document,signal),
  preview:(event:{name:string;properties?:Values;data?:Values;mode?:'draft'|'published'},signal?:AbortSignal)=>request('/preview','POST',event,signal),
  status:(signal?:AbortSignal)=>request('/status','GET',undefined,signal),
  publish:(expectedVersion:number,signal?:AbortSignal)=>request('/publish','POST',{expectedVersion},signal),
  rollback:(expectedVersion:number,releaseId:number,signal?:AbortSignal)=>request('/rollback','POST',{expectedVersion,releaseId},signal),
  importDefinition:(expectedVersion:number,definition:string,signal?:AbortSignal)=>request('/import','POST',{expectedVersion,definition},signal),
  exportDefinition:async(signal?:AbortSignal)=>JSON.stringify(await request('/export','GET',undefined,signal)),
  statusOfClient:()=>({closed,pending:jobs.size}),
  close(){if(closing)return closing;closed=true;for(const c of controllers)c.abort();return closing=(async()=>{await Promise.allSettled([...jobs]);})();},
 };
}
export type TagAdminClient=ReturnType<typeof createTagAdminClient>;
