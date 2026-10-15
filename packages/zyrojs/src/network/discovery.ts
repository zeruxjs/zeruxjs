import { createRemoteResource, type RemoteResource } from './reactive.js';

export interface DiscoveryClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  searchPath?: string;
  feedPath?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface DiscoverySearchOptions { limit?: number; offset?: number; mode?: 'any'|'all'; prefix?: boolean; signal?: AbortSignal }
export interface DiscoveryResult<T> { document: T; score: number; matches: string[] }
export interface DiscoverySearchResponse<T> { query: string; results: DiscoveryResult<T>[]; limit: number; offset: number }
export class DiscoveryHttpError extends Error {
  constructor(message:string, readonly status:number) {super(message);this.name='DiscoveryHttpError';}
}
function safePath(value:string):string {
  if(!value.startsWith('/')||value.startsWith('//')||value.includes('#')||value.includes('?')||/\\/.test(value))throw new TypeError('Discovery paths must be origin-relative');
  return value;
}
/** Browser/SSR client for Zerux Search and Feed endpoints, without hidden global state. */
export function createDiscoveryClient(config: DiscoveryClientOptions = {}) {
 const origin=new URL(config.baseUrl??(typeof location!=='undefined'?location.origin:'http://localhost'));
 if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash)throw new TypeError('Invalid discovery origin');
 const endpoint=(pathname:string)=>new URL(safePath(pathname),origin);
 const searchPath=safePath(config.searchPath??'/search');
 const feedPath=safePath(config.feedPath??'/feed');
 const timeout=config.timeoutMs??10000;
 const maxBytes=config.maxResponseBytes??2_097_152;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>50_000_000)throw new RangeError('Invalid discovery limits');
 const transport=config.fetch??fetch;
 const controllers=new Set<AbortController>();
 let disposed=false;
 const feedCache=new Map<string,{etag:string;body:string;contentType:string}>();
 async function get(url:URL,accept:string,signal?:AbortSignal,etag?:string):Promise<{status:number;body:string;etag?:string;contentType:string}> {
  if(disposed)throw new Error('Discovery client disposed');
  const controller=new AbortController();controllers.add(controller);
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('Discovery request timed out')),timeout);
  try {
   const headers=new Headers({accept});if(etag)headers.set('if-none-match',etag);
   const response=await transport(url.toString(),{method:'GET',headers,credentials:'omit',cache:'no-store',signal:controller.signal});
   if(response.status===304)return {status:304,body:'',contentType:response.headers.get('content-type')??'',etag:response.headers.get('etag')??undefined};
   if(!response.ok)throw new DiscoveryHttpError(`Discovery request failed: ${response.status}`,response.status);
   const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>maxBytes)throw new DiscoveryHttpError('Discovery response too large',413);
   if(!response.body)throw new DiscoveryHttpError('Missing response body',502);
   const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
   try {while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maxBytes){await reader.cancel();throw new DiscoveryHttpError('Discovery response too large',413)}chunks.push(next.value);}}
   finally{reader.releaseLock()}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   return {status:response.status,body:new TextDecoder('utf-8',{fatal:true}).decode(bytes),etag:response.headers.get('etag')??undefined,contentType:response.headers.get('content-type')??''};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controllers.delete(controller);}
 }
 const integer=(value:number|undefined,name:string,max:number)=>{if(value!==undefined&&(!Number.isSafeInteger(value)||value<0||value>max))throw new RangeError(`Invalid ${name}`);return value};
 const search=async<T=unknown>(q:string,options:DiscoverySearchOptions={}):Promise<DiscoverySearchResponse<T>>=>{
  if(typeof q!=='string'||q.length>1024)throw new TypeError('Invalid search query');
  const url=endpoint(searchPath);url.searchParams.set('q',q);
  if(options.limit!==undefined)url.searchParams.set('limit',String(integer(options.limit,'limit',1000)));
  if(options.offset!==undefined)url.searchParams.set('offset',String(integer(options.offset,'offset',1_000_000)));
  if(options.mode)url.searchParams.set('mode',options.mode);
  if(options.prefix)url.searchParams.set('prefix','1');
  const result=await get(url,'application/json',options.signal);
  if(!/application\/json/i.test(result.contentType))throw new DiscoveryHttpError('Unexpected search content type',502);
  return JSON.parse(result.body) as DiscoverySearchResponse<T>;
 };
 const suggest=async(q:string,signal?:AbortSignal):Promise<string[]>=>{
  if(typeof q!=='string'||q.length>1024)throw new TypeError('Invalid suggestion query');
  const url=endpoint(searchPath);url.searchParams.set('q',q);url.searchParams.set('suggest','1');
  const result=await get(url,'application/json',signal);
  if(!/application\/json/i.test(result.contentType))throw new DiscoveryHttpError('Unexpected suggestion content type',502);
  const parsed=JSON.parse(result.body) as {suggestions?:unknown};
  if(!Array.isArray(parsed.suggestions)||parsed.suggestions.some(s=>typeof s!=='string'))throw new DiscoveryHttpError('Invalid suggestion payload',502);
  return parsed.suggestions;
 };
 const feed=async(format:'rss'|'atom'|'json'='rss',signal?:AbortSignal):Promise<string>=>{
  if(!['rss','atom','json'].includes(format))throw new TypeError('Invalid feed format');
  const accept=({rss:'application/rss+xml',atom:'application/atom+xml',json:'application/feed+json'})[format];
  const url=endpoint(feedPath);const cached=feedCache.get(format);
  const result=await get(url,accept,signal,cached?.etag);
  if(result.status===304){if(!cached)throw new DiscoveryHttpError('Uncached 304 feed response',502);return cached.body}
  if(!result.contentType.toLowerCase().includes(accept))throw new DiscoveryHttpError('Unexpected feed content type',502);
  if(result.etag)feedCache.set(format,{etag:result.etag,body:result.body,contentType:result.contentType});else feedCache.delete(format);
  return result.body;
 };
 return {
  search,suggest,feed,
  /** A Zyro reactive resource with explicit refresh/cancel/dispose. */
  searchResource<T=unknown>(q:string,options:Omit<DiscoverySearchOptions,'signal'>={}):RemoteResource<DiscoverySearchResponse<T>> {
   return createRemoteResource(signal=>search<T>(q,{...options,signal}));
  },
  clearFeedCache(){feedCache.clear()},
  dispose(){disposed=true;for(const controller of controllers)controller.abort();controllers.clear();feedCache.clear()}
 };
}
