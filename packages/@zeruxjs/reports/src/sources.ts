import {createHash} from 'node:crypto';
import {isReportId} from './model.js';

export type ReportUnit='count'|'seconds'|'milliseconds'|'bytes'|'ratio'|`currency:${string}`;
export interface SourceField {name:string;kind:'dimension'|'metric';type:'string'|'decimal';unit?:ReportUnit}
export interface ReportSourceSchema {version:1;fields:readonly SourceField[]}
/** Supplied only by verified server identity/session middleware, never request JSON. */
export interface ReportSourceScope {tenant:string;site:string;principal:string;credentialPartition:string}
export interface ReportSourceQuery {source:string;schemaVersion:1;dimensions:string[];metrics:string[];from:string;to:string;limit:number}
export interface ReportSourceResult {version:1;source:string;schemaVersion:1;window:{from:string;to:string;inclusive:true};columns:SourceField[];rows:string[][];timeZone:string;coverage:{kind:'provider-reported'|'internal';truncated:boolean;totalRows:number|null;sampling:'unknown'|'reported';restricted:boolean};cachePrivacy:'private-no-store';cacheIdentity:string}
export interface ReportSourceAdapter {
 schema:ReportSourceSchema;
 capabilities:{readOnly:true;maxRows:number;maxDays:number};
 query(query:ReportSourceQuery,context:{scope:Readonly<ReportSourceScope>;signal:AbortSignal}):Promise<Omit<ReportSourceResult,'version'|'source'|'schemaVersion'|'cachePrivacy'|'cacheIdentity'|'window'>>;
 dispose?():void|Promise<void>;
}
export class ReportSourceError extends Error {
 constructor(readonly code:'INVALID_QUERY'|'DENIED'|'UNAVAILABLE'|'QUOTA'|'CANCELLED'|'OVERLOAD'|'CLOSED'|'INVALID_RESULT',cause?:unknown){super(`Report source ${code.toLowerCase()}`);this.name='ReportSourceError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
function fail(code:ReportSourceError['code']):never {throw new ReportSourceError(code);}
export function sourceScope(value:ReportSourceScope):ReportSourceScope {
 // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
 if(!value||Object.keys(value).some(k=>!['tenant','site','principal','credentialPartition'].includes(k))||!['tenant','site','principal','credentialPartition'].every(k=>typeof value[k as keyof ReportSourceScope]==='string'&&value[k as keyof ReportSourceScope].length>0&&value[k as keyof ReportSourceScope].length<=200&&!/[\x00-\x1f\x7f]/.test(value[k as keyof ReportSourceScope])))fail('DENIED');
 return Object.freeze({tenant:value.tenant,site:value.site,principal:value.principal,credentialPartition:value.credentialPartition});
}
export function sourceSchema(input:ReportSourceSchema):ReportSourceSchema {
 if(input?.version!==1||!Array.isArray(input.fields)||!input.fields.length||input.fields.length>100)fail('INVALID_QUERY');
 const fields=input.fields.map(f=>{if(!f||Object.keys(f).some(k=>!['name','kind','type','unit'].includes(k))||!isReportId(f.name)||!['dimension','metric'].includes(f.kind)||f.type!==(f.kind==='dimension'?'string':'decimal')||f.kind==='dimension'&&f.unit!==undefined||f.kind==='metric'&&(!f.unit||! /^(count|seconds|milliseconds|bytes|ratio|currency:[A-Z]{3})$/.test(f.unit)))fail('INVALID_QUERY');return Object.freeze({name:f.name,kind:f.kind,type:f.type,...(f.unit?{unit:f.unit}:{})});});
 if(new Set(fields.map(f=>f.name)).size!==fields.length)fail('INVALID_QUERY');return Object.freeze({version:1,fields:Object.freeze(fields)});
}
export function validateSourceQuery(input:ReportSourceQuery,schema:ReportSourceSchema,maxRows:number,maxDays:number):ReportSourceQuery {
 if(!input||Object.keys(input).some(k=>!['source','schemaVersion','dimensions','metrics','from','to','limit'].includes(k))||!isReportId(input.source)||input.schemaVersion!==schema.version||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>maxRows)fail('INVALID_QUERY');
 for(const [names,kind,max] of [[input.dimensions,'dimension',9],[input.metrics,'metric',10]] as const){if(!Array.isArray(names)||names.length>max||kind==='metric'&&!names.length||new Set(names).size!==names.length||names.some(n=>!schema.fields.some(f=>f.name===n&&f.kind===kind)))fail('INVALID_QUERY');}
 const day=(s:string)=>{if(typeof s!=='string'||!/^\d{4}-\d\d-\d\d$/.test(s))return NaN;const n=Date.parse(s+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s?n:NaN;};
 const a=day(input.from),b=day(input.to);if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||b-a>=(maxDays*86400000))fail('INVALID_QUERY');
 return {...input,dimensions:[...input.dimensions],metrics:[...input.metrics]};
}
export function createReportSourceRegistry(options:{authorize:(scope:Readonly<ReportSourceScope>,source:string)=>boolean|Promise<boolean>;maxConcurrent?:number;timeoutMs?:number;maxBytes?:number}) {
 if(typeof options?.authorize!=='function')fail('INVALID_QUERY');
 const max=options.maxConcurrent??4,timeout=options.timeoutMs??10000,bytes=options.maxBytes??1024*1024;
 if(!Number.isSafeInteger(max)||max<1||max>64||!Number.isSafeInteger(timeout)||timeout<1||timeout>60000||!Number.isSafeInteger(bytes)||bytes<256||bytes>4*1024*1024)fail('INVALID_QUERY');
 const sources=new Map<string,{adapter:ReportSourceAdapter;schema:ReportSourceSchema}>(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>(),owners=new Set<ReportSourceAdapter>();let closed=false,closing:Promise<void>|undefined;
 function lookup(query:ReportSourceQuery){const entry=sources.get(query?.source);if(!entry)fail('DENIED');return {entry,query:validateSourceQuery(query,entry.schema,entry.adapter.capabilities.maxRows,entry.adapter.capabilities.maxDays)};}
 return {
  register(name:string,adapter:ReportSourceAdapter){if(closed)fail('CLOSED');if(!isReportId(name)||sources.has(name)||sources.size>=32||typeof adapter?.query!=='function'||adapter.capabilities?.readOnly!==true||!Number.isSafeInteger(adapter.capabilities.maxRows)||adapter.capabilities.maxRows<1||adapter.capabilities.maxRows>10000||!Number.isSafeInteger(adapter.capabilities.maxDays)||adapter.capabilities.maxDays<1||adapter.capabilities.maxDays>366)fail('INVALID_QUERY');sources.set(name,{adapter:{schema:adapter.schema,capabilities:{...adapter.capabilities},query:adapter.query.bind(adapter),dispose:adapter.dispose?.bind(adapter)},schema:sourceSchema(adapter.schema)});owners.add(adapter);},
  /** Validate independently typed panels; no joins or automatic merging across source schemas. */
  validatePlan(queries:readonly ReportSourceQuery[]){if(!Array.isArray(queries)||!queries.length||queries.length>12)fail('INVALID_QUERY');return queries.map(q=>lookup(q).query);},
  async query(input:ReportSourceQuery,identity:ReportSourceScope,signal?:AbortSignal):Promise<ReportSourceResult>{
   if(closed)fail('CLOSED');if(signal!==undefined&&!(signal instanceof AbortSignal))fail('INVALID_QUERY');if(jobs.size>=max)fail('OVERLOAD');
   const scope=sourceScope(identity),{entry,query}=lookup(input),controller=new AbortController();controllers.add(controller);
   const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   let timer:ReturnType<typeof setTimeout>|undefined;let stop=()=>{};
   const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(new ReportSourceError('CANCELLED'));controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();timer=setTimeout(abort,timeout);});
   const native=Promise.resolve().then(async()=>{
    if(controller.signal.aborted)fail('CANCELLED');if(await options.authorize(scope,query.source)!==true)fail('DENIED');if(controller.signal.aborted)fail('CANCELLED');
    const raw=await entry.adapter.query(query,{scope,signal:controller.signal});if(controller.signal.aborted)fail('CANCELLED');
    const columns=[...query.dimensions,...query.metrics].map(n=>entry.schema.fields.find(f=>f.name===n)!);
    if(!raw||!Array.isArray(raw.columns)||raw.columns.length!==columns.length||raw.columns.some((f,i)=>!f||f.name!==columns[i].name||f.kind!==columns[i].kind||f.type!==columns[i].type||f.unit!==columns[i].unit)||!Array.isArray(raw.rows)||raw.rows.length>query.limit||raw.rows.some(r=>!Array.isArray(r)||r.length!==columns.length||r.some((v,i)=>typeof v!=='string'||Buffer.byteLength(v)>4096||columns[i].type==='decimal'&&!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)))||!raw.coverage||!['provider-reported','internal'].includes(raw.coverage.kind)||typeof raw.coverage.truncated!=='boolean'||typeof raw.timeZone!=='string'||!raw.timeZone||raw.timeZone.length>100||typeof raw.coverage.restricted!=='boolean'||!['unknown','reported'].includes(raw.coverage.sampling)||raw.coverage.totalRows!==null&&(!Number.isSafeInteger(raw.coverage.totalRows)||raw.coverage.totalRows<raw.rows.length))fail('INVALID_RESULT');
    let cellBytes=0;for(const row of raw.rows)for(const cell of row){cellBytes+=Buffer.byteLength(cell);if(cellBytes>bytes)fail('INVALID_RESULT');}
    if(raw.coverage.totalRows!==null&&raw.coverage.totalRows>raw.rows.length&&!raw.coverage.truncated)fail('INVALID_RESULT');
    try{new Intl.DateTimeFormat('en',{timeZone:raw.timeZone});}catch{fail('INVALID_RESULT');}
    // No provider blobs, credentials or arbitrary extra adapter fields escape normalization.
    const result:ReportSourceResult={version:1,source:query.source,schemaVersion:1,window:{from:query.from,to:query.to,inclusive:true},columns:structuredClone(columns),rows:raw.rows.map(r=>[...r]),timeZone:raw.timeZone,coverage:{kind:raw.coverage.kind,truncated:raw.coverage.truncated,totalRows:raw.coverage.totalRows,sampling:raw.coverage.sampling,restricted:raw.coverage.restricted},cachePrivacy:'private-no-store',cacheIdentity:createHash('sha256').update(JSON.stringify([scope,entry.schema,query])).digest('hex')};
    if(Buffer.byteLength(JSON.stringify(result))>bytes)fail('INVALID_RESULT');return result;
   }).catch(error=>{if(error instanceof ReportSourceError)throw error;throw new ReportSourceError(controller.signal.aborted?'CANCELLED':'UNAVAILABLE',error);}).finally(()=>{jobs.delete(native);controllers.delete(controller);});
   jobs.add(native);
   try{return await Promise.race([native,cancelled]);}finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);}
  },
  status(){return {closed,pending:jobs.size,sources:sources.size};},
  close(){if(closing)return closing;closed=true;for(const c of controllers)c.abort();return closing=(async()=>{await Promise.allSettled([...jobs]);const results=await Promise.allSettled([...owners].map(a=>Promise.resolve().then(()=>a.dispose?.())));sources.clear();owners.clear();if(results.some(r=>r.status==='rejected'))fail('UNAVAILABLE');})();},
 };
}
export type ReportSourceRegistry=ReturnType<typeof createReportSourceRegistry>;
/** Read-only POST query handler; identity resolution must authenticate the request first. */
export function createReportSourceHandler(options:{registry:ReportSourceRegistry;resolveScope:(request:Request)=>ReportSourceScope|Promise<ReportSourceScope>}) {
 if(!options?.registry||typeof options.resolveScope!=='function')fail('INVALID_QUERY');
 return async(request:Request)=>{
  const headers={'content-type':'application/json','cache-control':'private, no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff'};
  const response=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method!=='POST')return response({error:'METHOD_NOT_ALLOWED'},405);
  try{const scope=sourceScope(await options.resolveScope(request));if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return response({error:'INVALID_QUERY'},415);
   if(!request.body)fail('INVALID_QUERY');const reader=request.body.getReader();let body='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});let expired=false;const abort=()=>{void reader.cancel().catch(()=>{});};const timer=setTimeout(()=>{expired=true;abort();},10000);request.signal.addEventListener('abort',abort,{once:true});
   try{while(true){if(request.signal.aborted||expired)fail('CANCELLED');const {done,value}=await reader.read();if(request.signal.aborted||expired)fail('CANCELLED');if(done)break;size+=value.byteLength;if(size>16384)fail('INVALID_QUERY');body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
   let query:ReportSourceQuery;try{query=JSON.parse(body);}catch{fail('INVALID_QUERY');}return response(await options.registry.query(query,scope,request.signal),200);
  }catch(error){const code=error instanceof ReportSourceError?error.code:'DENIED';return response({error:code},code==='DENIED'?403:code==='INVALID_QUERY'?422:code==='CANCELLED'?408:code==='QUOTA'||code==='OVERLOAD'?429:503);}
 };
}
