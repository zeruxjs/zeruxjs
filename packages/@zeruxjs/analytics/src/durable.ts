import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseFacade,TransactionDatabase,TransactionOptions} from '@zeruxjs/db';
import type {AnalyticsEventInput,AnalyticsRow} from './types.js';
import {isEventSchemaRegistry,type AnalyticsEventSchemaRegistry} from './schemas.js';
import {validateRegisteredEvent} from './validation.js';
import {numericFactId} from './reconciliation.js';

export type DurableAnalyticsStatus='pending'|'processing'|'persisted'|'dead'|'purged';
export interface DurableAnalyticsReference {site:string;id:string}
export interface DurableAnalyticsFact {id:string;event_id:string;property_name:string;numeric_value:number;event_name:string;source:string;site:string;pathname:string;occurred_at:number}
export interface DurableAnalyticsRecord extends DurableAnalyticsReference {
 version:1;schemaVersion:number;revision:number;status:DurableAnalyticsStatus;eventId:string;payloadHash:string;
 row:AnalyticsRow|null;facts:DurableAnalyticsFact[];occurredAt:number;createdAt:number;dedupUntil:number;
 attempts:number;nextAt:number;lease:null|{token:string;until:number};code:null|'TRANSIENT'|'PERMANENT'|'EXHAUSTED';
}
/** Host-owned shared durable primary. CAS includes site/id and exact revision, never cache get/set. */
export interface DurableAnalyticsStore {
 readonly contract:'analytics-durable-v1';
 insert(record:DurableAnalyticsRecord):Promise<boolean>;
 get(reference:DurableAnalyticsReference):Promise<DurableAnalyticsRecord|null>;
 cas(expectedRevision:number,next:DurableAnalyticsRecord):Promise<boolean>;
 page(site:string,query:{cursor?:string;limit:number;before?:number}):Promise<DurableAnalyticsRecord[]>;
}
export interface DurableAnalyticsAcknowledgement extends DurableAnalyticsReference {
 state:'accepted'|'persisted'|'dead'|'purged'|'uncertain';eventId:string;duplicate:boolean;dedupUntil:number;
}
export interface DurableAnalyticsPlan {record:DurableAnalyticsRecord;next:DurableAnalyticsRecord}
export interface DurableAnalyticsJournal {
 /** Insert only on this pin. Return true only for the unique durable insertion. */
 append(pin:TransactionDatabase,record:DurableAnalyticsRecord):boolean|Promise<boolean>;
 /** Fence exact lease+revision, insert event/facts and CAS next state on this SAME pin. Throw on any failed result. */
 materialize(pin:TransactionDatabase,plan:DurableAnalyticsPlan):boolean|Promise<boolean>;
 /** Fence each revision, delete facts before events, then keep payload-free dedup tombstones on this pin. */
 purge(pin:TransactionDatabase,plans:readonly DurableAnalyticsPlan[]):boolean|Promise<boolean>;
}
export interface DurableAnalyticsPurgePreview {site:string;before:number;items:Array<{id:string;revision:number;status:DurableAnalyticsStatus;numericFacts:number;hasPayload:boolean}>;unprocessed:number;eventCandidates:number;numericFactCandidates:number;nextCursor:string|null;hash:string}
export interface DurableAnalyticsOptions {
 store:DurableAnalyticsStore;schemaRegistry:AnalyticsEventSchemaRegistry;numericFields?:readonly string[];
 authorize:(action:'accept'|'process'|'dispatch'|'inspect'|'preview'|'purge',reference:Readonly<DurableAnalyticsReference>,principal:unknown)=>boolean|Promise<boolean>;
 maxAttempts?:number;maxAgeMs?:number;dedupMs?:number;leaseMs?:number;baseDelayMs?:number;maxDelayMs?:number;maxPending?:number;now?:()=>number;
}
export class DurableAnalyticsError extends Error {constructor(readonly code:string,cause?:unknown){super(`Durable analytics failed (${code})`);this.name='DurableAnalyticsError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}}
const fail=(code:string,cause?:unknown)=>new DurableAnalyticsError(code,cause);
const DAY=86400000;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(value);
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function integer(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw fail('INVALID_LIMIT');return value;}
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
function ref(value:DurableAnalyticsReference){if(!value||typeof value.site!=='string'||!value.site||value.site.length>200||/[\x00-\x1f\x7f]/.test(value.site)||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id))throw fail('INVALID_REFERENCE');return {site:value.site,id:value.id};}
const payloadHash=(row:AnalyticsRow,facts:DurableAnalyticsFact[])=>{const props=JSON.parse(row.properties_json);if(props.zAnalyticsSchema)delete props.zAnalyticsSchema.catalogId;return hash(canonical({row:{...row,properties_json:canonical(props)},facts}));};
const ack=(r:DurableAnalyticsRecord,duplicate=false,state?:DurableAnalyticsAcknowledgement['state']):DurableAnalyticsAcknowledgement=>({...ref(r),state:state??(r.status==='pending'||r.status==='processing'?'accepted':r.status),eventId:r.eventId,duplicate,dedupUntil:r.dedupUntil});
type PinDatabase=Pick<DatabaseFacade,'transaction'|'transactionCapabilities'>;
function transaction(db:PinDatabase){const caps=db?.transactionCapabilities?.();if(typeof db?.transaction!=='function'||!caps||caps.savepoints!==false||!Array.isArray(caps.isolationLevels)||!caps.isolationLevels.length)throw fail('PINNED_TRANSACTION_REQUIRED');return db.transaction.bind(db);}
function settingsFor(db:PinDatabase,settings:TransactionOptions,signal:AbortSignal,maxTimeout=60000):TransactionOptions {
 if(!settings||typeof settings!=='object'||Object.keys(settings).some(k=>!['isolation','signal','timeoutMs','deadline'].includes(k)))throw fail('INVALID_TRANSACTION_OPTIONS');
 const caps=db.transactionCapabilities?.();if(!caps||caps.timeout!=='cooperative'||settings.isolation!==undefined&&!caps.isolationLevels.includes(settings.isolation))throw fail('UNSUPPORTED_TRANSACTION_POLICY');
 if(settings.signal!==undefined&&!(settings.signal instanceof AbortSignal))throw fail('INVALID_TRANSACTION_OPTIONS');if(settings.deadline!==undefined)integer(settings.deadline,0,Date.now()+maxTimeout);
 return {...settings,timeoutMs:integer(settings.timeoutMs??Math.min(30000,maxTimeout),1,maxTimeout),signal:settings.signal?AbortSignal.any([signal,settings.signal]):signal};
}
function pageSettings(query:{cursor?:string;limit?:number}){if(!query||typeof query!=='object'||Object.keys(query).some(k=>!['cursor','limit'].includes(k))||query.cursor!==undefined&&(typeof query.cursor!=='string'||!/^[a-f0-9]{32}$/.test(query.cursor)))throw fail('INVALID_PAGE');return {cursor:query.cursor,limit:integer(query.limit??20,1,50)};}
/** No database, queue, scheduler or background retry starts on construction. */
export function createDurableAnalytics(options:DurableAnalyticsOptions){
 if(!options||typeof options!=='object'||Object.keys(options).some(k=>!['store','schemaRegistry','numericFields','authorize','maxAttempts','maxAgeMs','dedupMs','leaseMs','baseDelayMs','maxDelayMs','maxPending','now'].includes(k))||options.now!==undefined&&typeof options.now!=='function'||options.numericFields!==undefined&&!Array.isArray(options.numericFields))throw fail('INVALID_CONFIGURATION');
 const store=options?.store;if(store?.contract!=='analytics-durable-v1'||['insert','get','cas','page'].some(k=>typeof (store as any)[k]!=='function')||!isEventSchemaRegistry(options.schemaRegistry)||typeof options.authorize!=='function')throw fail('INVALID_CONFIGURATION');
 const registry=options.schemaRegistry,authorize=options.authorize,numericFields=[...(options.numericFields??[])];if(numericFields.length>8||new Set(numericFields).size!==numericFields.length)throw fail('INVALID_CONFIGURATION');numericFields.forEach(field=>registry.metric(field));
 const maxAttempts=integer(options.maxAttempts??5,1,20),maxAge=integer(options.maxAgeMs??7*DAY,1000,30*DAY),dedupMs=integer(options.dedupMs??30*DAY,maxAge,90*DAY),leaseMs=integer(options.leaseMs??60000,1000,300000),base=integer(options.baseDelayMs??1000,1,DAY),delayMax=integer(options.maxDelayMs??60000,base,DAY),maxPending=integer(options.maxPending??16,1,128),now=options.now??Date.now;
 let closed=false;const pending=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 const clock=()=>integer(now(),0,253402300799999),delay=(attempt:number)=>Math.min(delayMax,base*2**Math.min(attempt-1,20));
 async function allowed(action:Parameters<typeof authorize>[0],reference:DurableAnalyticsReference,principal:unknown){if(await authorize(action,Object.freeze(ref(reference)),principal)!==true)throw fail('DENIED');}
 function run<T>(work:(signal:AbortSignal)=>Promise<T>):Promise<T>{if(closed)return Promise.reject(fail('CLOSED'));if(pending.size>=maxPending)return Promise.reject(fail('OVERLOAD'));const controller=new AbortController();controllers.add(controller);const promise=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return work(controller.signal);}).catch(cause=>{throw cause instanceof DurableAnalyticsError?cause:fail('STORE_UNAVAILABLE',cause);}).finally(()=>{pending.delete(promise);controllers.delete(controller);});pending.add(promise);return promise;}
 function checked(raw:DurableAnalyticsRecord|null,reference:DurableAnalyticsReference):DurableAnalyticsRecord|null{
  if(!raw)return null;const r=structuredClone(raw);ref(r);
  if(r.site!==reference.site||r.id!==reference.id||r.version!==1||!['pending','processing','persisted','dead','purged'].includes(r.status)||r.eventId!==r.id||!Number.isSafeInteger(r.revision)||r.revision<1||!Number.isSafeInteger(r.attempts)||r.attempts<0||r.attempts>20||!/^[a-f0-9]{64}$/.test(r.payloadHash)||!Array.isArray(r.facts)||r.facts.length>8)throw fail('CORRUPT_RECORD');
  for(const value of [r.occurredAt,r.createdAt,r.dedupUntil,r.nextAt])integer(value,0,253402300799999);
  if(r.status==='purged'){if(r.row!==null||r.facts.length)throw fail('CORRUPT_RECORD');}
  else if(!r.row||r.row.id!==r.eventId||r.row.site!==r.site||r.row.occurred_at!==r.occurredAt||typeof r.row.properties_json!=='string'||Buffer.byteLength(r.row.properties_json)>8192||payloadHash(r.row,r.facts)!==r.payloadHash)throw fail('CORRUPT_RECORD');
  integer(r.schemaVersion,1,10000);
  if(r.lease&&(!/^[A-Za-z0-9-]{36}$/.test(r.lease.token)||!Number.isSafeInteger(r.lease.until)))throw fail('CORRUPT_RECORD');if((r.status==='processing')!==!!r.lease)throw fail('CORRUPT_RECORD');return r;
 }
 async function get(reference:DurableAnalyticsReference){return checked(await store.get(ref(reference)),reference);}
 async function prepare(input:AnalyticsEventInput&{occurredAt:number},key:string,principal:unknown){
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(key)||!input||!Number.isSafeInteger(input.occurredAt)||input.consent!=='granted'||!input.site)throw fail('INVALID_OR_UNCONSENTED_EVENT');
  registry.prepare(input);input=structuredClone(input);
  const id=hash(JSON.stringify([input.site,key])).slice(0,32),reference=ref({site:input.site!,id});await allowed('accept',reference,principal);
  const old=await get(reference);if(old&&clock()>=old.dedupUntil)throw fail('DEDUPE_KEY_EXPIRED');
  const selected={...input,...(old&&input.schemaVersion===undefined?{schemaVersion:old.schemaVersion}:{})};
  const row=validateRegisteredEvent(old?{...selected,occurredAt:Date.now()}:selected,registry);row.occurred_at=input.occurredAt;row.id=id;const props=JSON.parse(row.properties_json),facts=numericFields.flatMap(field=>typeof props[field]==='number'?[{id:numericFactId(id,field),event_id:id,property_name:field,numeric_value:props[field],event_name:row.event_name,source:row.source,site:row.site,pathname:row.pathname,occurred_at:row.occurred_at}]:[]),at=clock();
  const result:DurableAnalyticsRecord={...reference,version:1,schemaVersion:JSON.parse(row.properties_json).zAnalyticsSchema.schemaVersion,revision:1,status:'pending',eventId:id,payloadHash:payloadHash(row,facts),row,facts,occurredAt:row.occurred_at,createdAt:at,dedupUntil:at+dedupMs,attempts:0,nextAt:at,lease:null,code:null};return freeze(result);
 }
 async function existing(record:DurableAnalyticsRecord){const old=await get(record);if(!old)throw fail('ACCEPTANCE_UNCERTAIN');if(clock()>=old.dedupUntil)throw fail('DEDUPE_KEY_EXPIRED');if(old.payloadHash!==record.payloadHash)throw fail('DEDUPE_CONFLICT');return ack(old,true);}
 async function claim(reference:DurableAnalyticsReference,principal:unknown){
  reference=ref(reference);await allowed('process',reference,principal);const current=await get(reference);if(!current)throw fail('NOT_FOUND');if(current.status==='persisted'||current.status==='purged'||current.status==='dead')return {acknowledgement:ack(current,true)};
  const at=clock();if(current.status==='processing'&&at<current.lease!.until+delay(current.attempts)||current.status==='pending'&&at<current.nextAt)return {acknowledgement:ack(current,true)};
  if(at-current.createdAt>=maxAge||current.attempts>=maxAttempts){const next={...current,revision:current.revision+1,status:'dead' as const,lease:null,code:'EXHAUSTED' as const};if(!await store.cas(current.revision,next))throw fail('CONFLICT');return {acknowledgement:ack(next)};}
  const leased:DurableAnalyticsRecord={...current,revision:current.revision+1,status:'processing',attempts:current.attempts+1,lease:{token:randomUUID(),until:at+leaseMs}};if(!await store.cas(current.revision,leased))throw fail('CONFLICT');
  const next:DurableAnalyticsRecord={...leased,revision:leased.revision+1,status:'persisted',lease:null,code:null};return {plan:freeze({record:leased,next})};
 }
 function previewHash(value:Omit<DurableAnalyticsPurgePreview,'hash'>){return hash(canonical(value));}
 async function purgePlans(preview:DurableAnalyticsPurgePreview,conflicts:'reject-unprocessed'|'cancel-unprocessed',principal:unknown){
  const {hash:digest,...body}=structuredClone(preview);if(previewHash(body)!==digest||!Array.isArray(body.items)||body.items.length>50||!['reject-unprocessed','cancel-unprocessed'].includes(conflicts))throw fail('INVALID_PREVIEW');integer(body.before,0,clock()-DAY);await allowed('purge',{site:body.site,id:'0'.repeat(32)},principal);const plans:DurableAnalyticsPlan[]=[];
  for(const item of body.items){const r=await get({site:body.site,id:item.id});if(!r||r.revision!==item.revision||r.status!==item.status||r.occurredAt>=body.before)throw fail('STALE_PREVIEW');if(!['persisted','purged'].includes(r.status)&&conflicts==='reject-unprocessed')throw fail('UNPROCESSED_CONFLICT');plans.push({record:r,next:{...r,revision:r.revision+1,status:'purged',row:null,facts:[],lease:null}});}
  return freeze(plans);
 }
 return Object.freeze({
  prepare(input:AnalyticsEventInput&{occurredAt:number},key:string,principal:unknown){return run(()=>prepare(input,key,principal));},
  accept(input:AnalyticsEventInput&{occurredAt:number},key:string,principal:unknown){return run(async()=>{const record=await prepare(input,key,principal);try{if(await store.insert(record))return ack(record);}catch(cause){throw fail('ACCEPTANCE_UNCERTAIN',cause);}return existing(record);});},
  /** Optional business mutation and ledger append commit together on an existing negotiated pin. */
  commit<T>(db:PinDatabase,journal:Pick<DurableAnalyticsJournal,'append'>,input:AnalyticsEventInput&{occurredAt:number},key:string,principal:unknown,business:(pin:TransactionDatabase)=>T|Promise<T>,settings:TransactionOptions={}){
   return run(async signal=>{const tx=transaction(db),policy=settingsFor(db,settings,signal);if(typeof journal?.append!=='function'||typeof business!=='function')throw fail('INVALID_CONFIGURATION');const record=await prepare(input,key,principal);const old=await get(record);if(old)return existing(record);
    try{await tx(async pin=>{if(await journal.append(pin,record)!==true)throw fail('CONFLICT');await business(pin);},policy);return ack(record);}catch(cause){throw fail('COMMIT_UNCERTAIN',cause);}
   });
  },
  /** Async preparation OUTSIDE a native SQLite transactionSync interval. */
  prepareMaterialization(reference:DurableAnalyticsReference,principal:unknown){return run(()=>claim(reference,principal));},
  persist(db:PinDatabase,journal:Pick<DurableAnalyticsJournal,'materialize'>,reference:DurableAnalyticsReference,principal:unknown,settings:TransactionOptions={}){
   return run(async signal=>{const tx=transaction(db),policy=settingsFor(db,settings,signal,leaseMs-1);if(typeof journal?.materialize!=='function')throw fail('INVALID_CONFIGURATION');const result=await claim(reference,principal);if(!result.plan)return result.acknowledgement!;
    try{await tx(async pin=>{if(await journal.materialize(pin,result.plan!)!==true)throw fail('FENCE_LOST');},policy);return ack(result.plan.next);}
    catch(cause){return ack(result.plan.record,false,'uncertain');}
   });
  },
  inspect(reference:DurableAnalyticsReference,principal:unknown){return run(async()=>{await allowed('inspect',reference,principal);const r=await get(reference);if(!r)throw fail('NOT_FOUND');return {...ack(r,true),attempts:r.attempts,status:r.status,code:r.code,createdAt:r.createdAt,nextAt:r.nextAt,leaseUntil:r.lease?.until??null};});},
  confirm(reference:DurableAnalyticsReference,principal:unknown){return run(async()=>{await allowed('inspect',reference,principal);const current=await get(reference);if(!current)throw fail('NOT_FOUND');return ack(current,true,current.status==='processing'?'uncertain':undefined);});},
  settleFailure(reference:DurableAnalyticsReference,token:string,classification:'transient'|'permanent',principal:unknown){return run(async()=>{await allowed('process',reference,principal);if(!['transient','permanent'].includes(classification))throw fail('INVALID_FAILURE');const current=await get(reference);if(!current||current.status!=='processing'||current.lease?.token!==token||clock()>=current.lease.until)throw fail('FENCE_LOST');const dead=classification==='permanent'||current.attempts>=maxAttempts||clock()-current.createdAt>=maxAge;const next:DurableAnalyticsRecord={...current,revision:current.revision+1,status:dead?'dead':'pending',lease:null,code:classification==='permanent'?'PERMANENT':dead?'EXHAUSTED':'TRANSIENT',nextAt:clock()+delay(current.attempts)};if(!await store.cas(current.revision,next))throw fail('CONFLICT');return ack(next);});},
  dispatch(site:string,principal:unknown,publisher:{acknowledgement:true;destructiveRead:false;publish(reference:DurableAnalyticsReference):Promise<unknown>},query:{cursor?:string;limit?:number}={}){
   return run(async signal=>{if(publisher?.acknowledgement!==true||publisher.destructiveRead!==false||typeof publisher.publish!=='function')throw fail('ACKNOWLEDGED_PUBLISHER_REQUIRED');const {limit,cursor}=pageSettings(query);await allowed('dispatch',{site,id:'0'.repeat(32)},principal);const rows=await store.page(site,{cursor,limit});if(!Array.isArray(rows)||rows.length>limit)throw fail('INVALID_PAGE');let previous=cursor;let published=0;for(const raw of rows){signal.throwIfAborted();const r=checked(raw,{site,id:raw.id})!;if(previous&&r.id<=previous)throw fail('INVALID_PAGE');previous=r.id;if(r.status==='pending'&&r.nextAt<=clock()||r.status==='processing'&&r.lease!.until+delay(r.attempts)<=clock()){await allowed('process',r,principal);await publisher.publish(ref(r));published++;}}return {published,nextCursor:rows.length===limit?previous??null:null,coverage:'bounded-ledger-page' as const};});
  },
  previewPurge(site:string,before:number,principal:unknown,query:{cursor?:string;limit?:number}={}){return run(async()=>{ref({site,id:'0'.repeat(32)});integer(before,0,clock()-DAY);await allowed('preview',{site,id:'0'.repeat(32)},principal);const {limit,cursor}=pageSettings(query),rows=await store.page(site,{before,cursor,limit});if(!Array.isArray(rows)||rows.length>limit)throw fail('INVALID_PAGE');let previous=cursor;const items=rows.map(raw=>{const r=checked(raw,{site,id:raw.id})!;if(r.occurredAt>=before||previous&&r.id<=previous)throw fail('INVALID_PAGE');previous=r.id;return {id:r.id,revision:r.revision,status:r.status,numericFacts:r.facts.length,hasPayload:r.row!==null};});const result={site,before,items,unprocessed:items.filter(r=>!['persisted','purged'].includes(r.status)).length,eventCandidates:items.filter(r=>r.status==='persisted').length,numericFactCandidates:items.filter(r=>r.status==='persisted').reduce((n,r)=>n+r.numericFacts,0),nextCursor:rows.length===limit?previous??null:null};return {...result,hash:previewHash(result)};});},
  preparePurge(preview:DurableAnalyticsPurgePreview,conflicts:'reject-unprocessed'|'cancel-unprocessed',principal:unknown){return run(()=>purgePlans(preview,conflicts,principal));},
  purge(db:PinDatabase,journal:Pick<DurableAnalyticsJournal,'purge'>,preview:DurableAnalyticsPurgePreview,conflicts:'reject-unprocessed'|'cancel-unprocessed',principal:unknown,settings:TransactionOptions={}){
   return run(async signal=>{const tx=transaction(db),policy=settingsFor(db,settings,signal);if(typeof journal?.purge!=='function')throw fail('INVALID_CONFIGURATION');const plans=await purgePlans(preview,conflicts,principal);
    await tx(async pin=>{if(await journal.purge(pin,freeze(plans))!==true)throw fail('FENCE_LOST');},policy);return {deleted:plans.length,coverage:'approved-ledger-page' as const};
   });
  },
  diagnostics(){return {closed,pending:pending.size};},
  async close(){closed=true;for(const c of controllers)c.abort();await Promise.allSettled([...pending]);}
 });
}
export type DurableAnalytics=ReturnType<typeof createDurableAnalytics>;
