import {timingSafeEqual} from 'node:crypto';
import type {AnalyticsManager} from './manager.js';
import type {AnalyticsEventInput} from './types.js';
import {validateEvent} from './validation.js';
import {createRequestId, requestUtcDay, validRequestId} from './request-id.js';
import type {RequestIdStore} from './request-id.js';
export interface CollectorOptions {
  analytics:AnalyticsManager;
  /** Atomic per-day reservation store; supply a shared durable implementation on replicas. */
  requestIdStore?:RequestIdStore;
  /** Reject requests with no client-generated correlation ID. */
  requireRequestId?:boolean;
  /** Allow CORS-simple text/plain JSON for sendBeacon; only enable on origin-checked tag collectors. */
  allowTextPlainBeacon?:boolean;
  /** Optional tag-manager pipeline. Replaces direct analytics.track in this collector. */
  dispatch?:(input:AnalyticsEventInput,context:{requestId:string;utcDay:string;origin?:string})=>Promise<unknown>;
  prefix?:string;
  /** Exact origins; '*' is deliberately unsupported when browser collection is enabled. */
  allowedOrigins?:readonly string[];
  /** Server-to-server bearer token; required for requests without an allowed Origin. */
  serverToken?:string;
  maxBodyBytes?:number;
  /** Maximum wall-clock time allowed to receive and decode a request body. */
  bodyTimeoutMs?:number;
  /** Maximum concurrently parsed bodies per collector instance. */
  maxConcurrentReads?:number;
  maxEventsPerMinute?:number;
  /** Respond promptly even if the database operation is stalled. */
  storageTimeoutMs?:number;
  /** Prevent indefinitely pending database operations accumulating unboundedly. */
  maxPendingEvents?:number;
  /** Hard tenant binding for public origins; supplied browser site may not override mapping. */
  siteByOrigin?:Record<string,string>;
  /** When true, unknown-consent browser events are ignored without writing. */
  requireBrowserConsent?:boolean;
  /** Optional conservative known crawler, prefetch and link preview filtering for browser events. */
  botPolicy?:'allow'|'drop-known';
}
const json=(status:number,error:string,cors:Record<string,string>={})=>new Response(JSON.stringify({error}),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});
function sameSecret(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
async function boundedJson(request:Request,max:number,timeoutMs:number,allowTextPlain=false):Promise<unknown>{
  const contentType=request.headers.get('content-type')?.toLowerCase()??'';
  if(!contentType.startsWith('application/json')&&!(allowTextPlain&&contentType.startsWith('text/plain')))throw Object.assign(new Error('Unsupported type'),{status:415});
  const indicated=request.headers.get('content-length');
  if(indicated!==null&&/^\d+$/.test(indicated)&&Number(indicated)>max)throw Object.assign(new Error('Request exceeds limit'),{status:413});
  if(!request.body)throw Object.assign(new Error('Missing body'),{status:400});
  const reader=request.body.getReader();let n=0;const parts:Uint8Array[]=[];
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Request body timeout'),{status:408})),timeoutMs);});
  try{
    while(true){
      // One absolute deadline bounds a slow-drip stream as well as an idle one.
      const {done,value}=await Promise.race([reader.read(),deadline]);
      if(done)break;
      n+=value.byteLength;
      if(n>max)throw Object.assign(new Error('Request exceeds limit'),{status:413});
      parts.push(value);
    }
  }catch(error){
    // Cancellation is best effort; waiting for an uncooperative stream's
    // cancellation would defeat the response deadline.
    void reader.cancel().catch(()=>{});
    throw error;
  }finally{
    if(timer)clearTimeout(timer);
    try{reader.releaseLock();}catch{/* A hostile stream may still be canceling. */}
  }
  try{return JSON.parse(Buffer.concat(parts.map(p=>Buffer.from(p))).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
}
export function createAnalyticsCollector(options:CollectorOptions){
  const prefix=(options.prefix??'/_analytics').replace(/\/$/,'');
  if(options.requireRequestId&&!options.requestIdStore)throw new TypeError('Request ID reservation store required');
  if(!prefix.startsWith('/')||prefix==='/'||prefix.includes('..'))throw new TypeError('Invalid analytics prefix');
  const max=options.maxBodyBytes??16_384,rate=options.maxEventsPerMinute??120;
  const bodyTimeout=options.bodyTimeoutMs??3000,maxReads=options.maxConcurrentReads??64;
  const timeoutMs=options.storageTimeoutMs??350,maxPending=options.maxPendingEvents??64;
  if(!Number.isSafeInteger(max)||max<256||max>65536||!Number.isSafeInteger(rate)||rate<1||rate>10000||
    !Number.isSafeInteger(bodyTimeout)||bodyTimeout<10||bodyTimeout>60_000||
    !Number.isSafeInteger(maxReads)||maxReads<1||maxReads>1000||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>10_000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>1000)throw new RangeError('Invalid collection limits');
  const origins=new Set((options.allowedOrigins??[]).map(value=>{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)return 'invalid';return url.origin;}));
  if(origins.has('invalid'))throw new TypeError('Invalid allowed origin');
  const siteByOrigin=new Map<string,string>();
  for(const [origin,site] of Object.entries(options.siteByOrigin??{})){
    if(!origins.has(origin)||typeof site!=='string'||!site||site.length>200||/[\x00-\x1f]/.test(site))throw new TypeError('Invalid analytics origin-to-site mapping');
    siteByOrigin.set(origin,site);
  }
  if(options.botPolicy!==undefined&&!['allow','drop-known'].includes(options.botPolicy))throw new TypeError('Invalid bot policy');
  const windows=new Map<string,{minute:number,count:number}>();
  let pending=0,activeReads=0;
  async function track(input:AnalyticsEventInput,context:{requestId:string;utcDay:string;origin?:string}):Promise<void>{
    if(pending>=maxPending)return;
    pending++;
    const operation=Promise.resolve().then(()=>options.dispatch?options.dispatch(input,context):options.analytics.track(input)).then(()=>{},()=>{}).finally(()=>{pending--;});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([operation,new Promise<void>(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  const handler=async (request:Request):Promise<Response>=>{
    const origin=request.headers.get('origin');
    const allowed=!!origin&&origins.has(origin);
    const cors:Record<string,string>={};if(allowed){cors['access-control-allow-origin']=origin!;cors.vary='Origin';}
    if(request.method==='OPTIONS'){if(!allowed)return json(403,'Origin not allowed',cors);return new Response(null,{status:204,headers:{...cors,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type','access-control-max-age':'600'}});}
    if(request.method!=='POST')return json(405,'Method not allowed',cors);
    const token=request.headers.get('authorization')?.replace(/^Bearer /i,'');
    if(!allowed&&(!options.serverToken||!token||!sameSecret(token,options.serverToken)))return json(403,'Collector authorization required',cors);
    // Browser origins enable collection, not user identity or administrative access.
    if(allowed&&options.botPolicy==='drop-known'){
      const agent=request.headers.get('user-agent')??'';
      const purpose=(request.headers.get('sec-purpose')??request.headers.get('purpose')??'').toLowerCase();
      if(/(?:bot|crawler|spider|headless|bingpreview|google-other)/i.test(agent)||/(?:prefetch|prerender)/.test(purpose))return new Response(null,{status:204,headers:{...cors,'cache-control':'no-store'}});
    }
    const key=allowed?`origin:${origin}`:'server';const minute=Math.floor(Date.now()/60_000);
    if(windows.size>1024)for(const [k,v] of windows)if(v.minute!==minute)windows.delete(k);
    const window=windows.get(key);if(window&&window.minute===minute&&window.count>=rate)return json(429,'Collector rate exceeded',cors);
    if(activeReads>=maxReads)return json(429,'Collector request concurrency exceeded',cors);
    windows.set(key,{minute,count:window?.minute===minute?window.count+1:1});
    try{
      activeReads++;
      let data:unknown;
      try{data=await boundedJson(request,max,bodyTimeout,options.allowTextPlainBeacon===true);}
      finally{activeReads--;}

      if(!data||typeof data!=='object'||Array.isArray(data))return json(400,'Invalid event',cors);
      const input=data as AnalyticsEventInput;
      // Public web endpoint cannot impersonate email or server-side event sources.
      if(allowed&&input.source&&input.source!=='web')return json(403,'Invalid client event source',cors);
      const boundSite=allowed?siteByOrigin.get(origin!):undefined;
      if(boundSite!==undefined&&input.site!==undefined&&input.site!==boundSite)return json(403,'Site does not match origin',cors);
      if(input.consent==='denied'||(allowed&&options.requireBrowserConsent&&input.consent!=='granted'))return new Response(null,{status:204,headers:{...cors,'cache-control':'no-store'}});
      let id=input.requestId;
      if(id!==undefined&&!validRequestId(id))return json(422,'Invalid request ID',cors);
      if(options.requireRequestId&&!id)return json(422,'Request ID required',cors);
      const day=requestUtcDay();
      try{validateEvent({...input,source:allowed?'web':input.source??'server',...(boundSite?{site:boundSite}:{}),...(id?{requestId:id,requestUtcDay:day}:{})});}
      catch{return json(422,'Invalid event data',cors);}
      try{
        if(options.requestIdStore){
          if(id){if(!await options.requestIdStore.reserve(day,id))return json(409,'Duplicate request ID',cors);}
          else {let success=false;for(let i=0;i<5;i++){const next=createRequestId();if(await options.requestIdStore.reserve(day,next)){id=next;success=true;break;}}if(!success)return json(503,'Request ID allocation failed',cors);}
        }
      }catch{return json(503,'Request ID reservation unavailable',cors);}
      if(id&&!options.requestIdStore)return json(503,'Request ID reservation not configured',cors);
      // Storage is best-effort. Delivery of the identifier never claims storage durability.
      const context={requestId:id??'',utcDay:day,origin:origin??undefined};
      await track({...input,source:allowed?'web':input.source??'server',...(boundSite?{site:boundSite}:{}),...(id?{requestId:id,requestUtcDay:day}:{})},context);
      const headers:Record<string,string>={...cors,'cache-control':'no-store',...(id?{'x-zerux-request-id':id,'x-zerux-request-day':day}:{})};
      if(allowed)headers['access-control-expose-headers']='x-zerux-request-id, x-zerux-request-day';
      return new Response(null,{status:204,headers});
    }catch(error){const code=(error as {status?:number}).status;if(code)return json(code,(error as Error).message,cors);if(error instanceof TypeError||error instanceof RangeError)return json(422,'Invalid event data',cors);return new Response(null,{status:204,headers:{...cors,'cache-control':'no-store'}});}
  };
  return {path:`${prefix}/collect`,handler,routes(){return [{pattern:`${prefix}/collect`,handler}];}};
}
