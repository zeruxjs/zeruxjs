import {randomUUID} from 'node:crypto';
import {hashData} from '@zeruxjs/security/crypto';
import type {DatabaseFacade,TransactionDatabase,TransactionOptions} from '@zeruxjs/db';
import {bodyJSON,fail,fields,id,number,WebhookError,type WebhookAttempt,type WebhookDestination,type WebhookInput,type WebhookPolicy,type WebhookQueuePublisher,type WebhookRecord,type WebhookReference,type WebhookState,type WebhookStore,type WebhookTransport} from './contracts.js';
import {signWebhook} from './signing.js';
export interface WebhookWorkflowOptions {
 store:WebhookStore;transport:WebhookTransport;
 authorize:(action:'enqueue'|'deliver'|'dispatch'|'inspect'|'redrive',reference:WebhookReference,principal:unknown)=>boolean|Promise<boolean>;
 destination:(tenant:string,reference:string)=>WebhookDestination|Promise<WebhookDestination>;
 policy:WebhookPolicy;timeoutMs?:number;leaseMs?:number;maxPending?:number;now?:()=>number;random?:()=>number;
}
export function createWebhookWorkflow(options:WebhookWorkflowOptions){
 fields(options,['store','transport','authorize','destination','policy','timeoutMs','leaseMs','maxPending','now','random']);if(options.store?.contract!=='webhook-cas-v1'||['get','cas','due'].some(key=>typeof (options.store as any)[key]!=='function')||options.transport?.contract!=='webhook-https-v1'||typeof options.transport.send!=='function'||typeof options.transport.validate!=='function'||typeof options.authorize!=='function'||typeof options.destination!=='function'||options.now!==undefined&&typeof options.now!=='function'||options.random!==undefined&&typeof options.random!=='function')throw fail('INVALID_WORKFLOW');
 fields(options.policy,['maxAttempts','maxAgeMs','baseDelayMs','maxDelayMs','retryAfterMaxMs','transientStatuses','retryNotSent']);const raw=options.policy;if(!Array.isArray(raw.transientStatuses))throw fail('INVALID_POLICY');
 const policy:WebhookPolicy={maxAttempts:number(raw.maxAttempts,1,20),maxAgeMs:number(raw.maxAgeMs,1000,30*86400000),baseDelayMs:number(raw.baseDelayMs,1,86400000),maxDelayMs:number(raw.maxDelayMs,1,86400000),retryAfterMaxMs:number(raw.retryAfterMaxMs,0,86400000),transientStatuses:[...raw.transientStatuses],retryNotSent:raw.retryNotSent};
 if(policy.baseDelayMs>policy.maxDelayMs||typeof policy.retryNotSent!=='boolean'||!Array.isArray(raw.transientStatuses)||raw.transientStatuses.length>16||raw.transientStatuses.some(code=>!Number.isSafeInteger(code)||![408,425,429].includes(code)&&(code<500||code>599)))throw fail('INVALID_POLICY');
 const timeout=number(options.timeoutMs??10000,1,30000),leaseMs=number(options.leaseMs??60000,timeout+1000,300000),max=number(options.maxPending??16,1,128),store=options.store,transport=options.transport,authorize=options.authorize,resolve=options.destination,random=options.random??Math.random,now=()=>number((options.now??Date.now)(),0,8640000000000000);
 let closed=false;const pending=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 function reference(input:WebhookReference){fields(input,['tenant','deliveryId']);id(input.tenant);id(input.deliveryId);return {tenant:input.tenant,deliveryId:input.deliveryId};}
 async function allowed(action:Parameters<typeof authorize>[0],ref:WebhookReference,principal:unknown){if(await authorize(action,ref,principal)!==true)throw fail('FORBIDDEN');}
 async function destination(record:Pick<WebhookRecord,'tenant'|'destination'>){const value=await resolve(record.tenant,record.destination);if(!value||value.tenant!==record.tenant||value.ref!==record.destination||value.enabled!==true||value.consumerIdempotency!==true||!value.keys)throw fail('DESTINATION_DENIED');transport.validate(value.url);return value;}
 function validate(value:WebhookRecord,ref:WebhookReference):WebhookRecord{
  if(!value||value.contract!==1||value.tenant!==ref.tenant||value.deliveryId!==ref.deliveryId)throw fail('INVALID_STORED_RECORD');id(value.eventId);id(value.destination);number(value.schemaVersion,1,1000000);number(value.revision,1,Number.MAX_SAFE_INTEGER);number(value.attempts,0,20);for(const time of [value.createdAt,value.updatedAt,value.nextAt])number(time,0,8640000000000000);
  if(typeof value.body!=='string'||Buffer.byteLength(value.body)>65536||hashData(value.body)!==value.bodyHash||!['pending','sending','delivered','uncertain','dead'].includes(value.state)||!Array.isArray(value.history)||value.history.length>20||(value.state==='sending')!==(value.lease!==null))throw fail('INVALID_STORED_RECORD');
  for(const attempt of value.history){fields(attempt,['at','durationMs','outcome','code','httpStatus']);number(attempt.at,0,8640000000000000);number(attempt.durationMs,0,8640000000000000);if(!['pending','sending','delivered','uncertain','dead'].includes(attempt.outcome)||typeof attempt.code!=='string'||! /^[A-Z_]{1,48}$/.test(attempt.code))throw fail('INVALID_STORED_RECORD');if(attempt.httpStatus!==undefined)number(attempt.httpStatus,100,599);}
  if(value.lease){if(typeof value.lease.token!=='string'||! /^[a-f0-9-]{36}$/.test(value.lease.token))throw fail('INVALID_STORED_RECORD');number(value.lease.until,0,8640000000000000);}return structuredClone(value);
 }
 async function read(ref:WebhookReference){const value=await store.get(ref);return value===null?null:validate(value,ref);}
 function newRecord(input:WebhookInput):WebhookRecord{
  fields(input,['tenant','deliveryId','eventId','destination','schemaVersion','payload']);for(const value of [input.tenant,input.deliveryId,input.eventId,input.destination])id(value);number(input.schemaVersion,1,1000000);const body=bodyJSON({eventId:input.eventId,schemaVersion:input.schemaVersion,data:input.payload}),time=now();return {contract:1,tenant:input.tenant,deliveryId:input.deliveryId,eventId:input.eventId,destination:input.destination,schemaVersion:input.schemaVersion,body,bodyHash:hashData(body),revision:1,state:'pending',attempts:0,createdAt:time,updatedAt:time,nextAt:time,lease:null,history:[]};
 }
 async function change(old:WebhookRecord,patch:Partial<WebhookRecord>){const next={...old,...patch,revision:old.revision+1,updatedAt:now()};if(await store.cas({tenant:old.tenant,deliveryId:old.deliveryId},old.revision,next)!==true)throw fail('REVISION_CONFLICT');return next;}
 function summary(value:WebhookRecord){return {tenant:value.tenant,deliveryId:value.deliveryId,eventId:value.eventId,destination:value.destination,schemaVersion:value.schemaVersion,state:value.state,attempts:value.attempts,createdAt:value.createdAt,updatedAt:value.updatedAt,nextAt:value.nextAt,history:structuredClone(value.history)};}
 function retryDelay(attempt:number,retryAfter?:string){const value=random();if(!Number.isFinite(value)||value<0||value>1)throw fail('INVALID_RANDOM');const base=Math.min(policy.maxDelayMs,policy.baseDelayMs*2**Math.min(attempt-1,20));let delay=Math.floor(base*(0.5+value*0.5));if(retryAfter&&retryAfter.length<=128){const suggested=/^\d{1,9}$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-now();if(Number.isFinite(suggested)&&suggested>=0)delay=Math.max(delay,Math.min(suggested,policy.retryAfterMaxMs));}return Math.min(Math.max(delay,1),Math.max(policy.maxDelayMs,policy.retryAfterMaxMs));}
 async function process(ref:WebhookReference,principal:unknown){
  await allowed('deliver',ref,principal);let value=await read(ref);if(!value)throw fail('NOT_FOUND');const time=now();if(time<value.createdAt)throw fail('INVALID_CLOCK');
  if(value.state==='sending'){if(value.lease!.until>time)throw fail('BUSY');return summary(await change(value,{state:'uncertain',lease:null}));}
  if(value.state!=='pending'||value.nextAt>time)return summary(value);
  if(value.attempts>=policy.maxAttempts||time-value.createdAt>=policy.maxAgeMs)return summary(await change(value,{state:'dead'}));
  const target=await destination(value);
  // Signing configuration is checked before claim; each attempt resolves the active ring again.
  const headers=signWebhook({tenant:value.tenant,destination:value.destination,deliveryId:value.deliveryId,timestamp:Math.floor(time/1000),body:value.body},target.keys);
  if(closed)throw fail('CLOSED');value=await change(value,{state:'sending',attempts:value.attempts+1,lease:{token:randomUUID(),until:time+leaseMs}});
  const controller=new AbortController();controllers.add(controller);if(closed)controller.abort();const timer=setTimeout(()=>controller.abort(),timeout);let state:WebhookState,code='OUTCOME_UNKNOWN',status:number|undefined,delay=0;
  try{
   if(controller.signal.aborted)throw fail('NOT_SENT');const response=await transport.send({url:target.url,body:value.body,headers:{...headers,'x-zerux-webhook-schema':String(value.schemaVersion)},signal:controller.signal,timeoutMs:timeout});status=number(response.status,100,599);
   if(controller.signal.aborted){state='uncertain';}
   else if(status>=200&&status<300){state='delivered';code='HTTP_SUCCESS';}
   else if(status>=300&&status<400){state='dead';code='REDIRECT_DENIED';}
   else if(policy.transientStatuses.includes(status)){state='pending';code='HTTP_TRANSIENT';delay=retryDelay(value.attempts,response.retryAfter);}
   else{state='dead';code='HTTP_PERMANENT';}
  }catch(error){state='uncertain';code='OUTCOME_UNKNOWN';if(error instanceof WebhookError&&['NOT_SENT','TRANSPORT_OVERLOAD','TRANSPORT_CLOSED'].includes(error.code)){state=policy.retryNotSent?'pending':'dead';code='NOT_SENT';if(state==='pending')delay=retryDelay(value.attempts);}else if(error instanceof WebhookError&&['DESTINATION_DENIED','ADDRESS_DENIED'].includes(error.code)){state='dead';code='DESTINATION_DENIED';}}
  finally{clearTimeout(timer);controllers.delete(controller);}
  const ended=now();if(ended<time)throw fail('INVALID_CLOCK');if(state==='pending'&&(value.attempts>=policy.maxAttempts||ended+delay-value.createdAt>=policy.maxAgeMs)){state='dead';code='RETRY_LIMIT';}
  const attempt:WebhookAttempt={at:time,durationMs:Math.max(0,ended-time),outcome:state,code,...(status!==undefined?{httpStatus:status}:{})};
  return summary(await change(value,{state,lease:null,nextAt:ended+delay,history:[...value.history,attempt]}));
 }
 function run<T>(work:()=>Promise<T>):Promise<T>{if(closed)return Promise.reject(fail('CLOSED'));if(pending.size>=max)return Promise.reject(fail('OVERLOAD'));const job=Promise.resolve().then(()=>{if(closed)throw fail('CLOSED');return work();}).catch(error=>{if(error instanceof WebhookError)throw error;throw fail('DEPENDENCY_FAILED',error);});pending.add(job);void job.finally(()=>pending.delete(job)).catch(()=>{});return job;}
 return {
  /** Atomic only through the supplied negotiated pin and a writer that uses that exact pin. */
  commit<T>(database:Pick<DatabaseFacade,'transaction'|'transactionCapabilities'>,writer:{insert(pin:TransactionDatabase,record:WebhookRecord):Promise<void>|void},input:WebhookInput,business:(pin:TransactionDatabase)=>T|Promise<T>,principal:unknown,settings:TransactionOptions={}){
   const record=newRecord(input),ref={tenant:record.tenant,deliveryId:record.deliveryId};const caps=database?.transactionCapabilities?.();if(typeof database?.transaction!=='function'||!caps||!Array.isArray(caps.isolationLevels)||!caps.isolationLevels.length||caps.isolationLevels.length>5||caps.savepoints!==false||!['cooperative','unsupported'].includes(caps.timeout)||typeof caps.transactionalDdl!=='boolean'||typeof writer?.insert!=='function'||typeof business!=='function')return Promise.reject(fail('PINNED_TRANSACTION_REQUIRED'));
   return run(async()=>{await allowed('enqueue',ref,principal);const target=await destination(record);signWebhook({tenant:record.tenant,destination:record.destination,deliveryId:record.deliveryId,timestamp:Math.floor(now()/1000),body:record.body},target.keys);return database.transaction!(async pin=>{const result=await business(pin);await writer.insert(pin,structuredClone(record));return result;},settings);});
  },
  /** Use only inside an already-owned synchronous transaction, e.g. SQLite transactionSync. No awaits. */
  prepare(input:WebhookInput,principal:unknown){const record=newRecord(input);return run(async()=>{await allowed('enqueue',{tenant:record.tenant,deliveryId:record.deliveryId},principal);const target=await destination(record);signWebhook({tenant:record.tenant,destination:record.destination,deliveryId:record.deliveryId,timestamp:Math.floor(now()/1000),body:record.body},target.keys);return record;});},
  deliver(input:WebhookReference,principal:unknown){const ref=reference(input);return run(()=>process(ref,principal));},
  inspect(input:WebhookReference,principal:unknown){const ref=reference(input);return run(async()=>{await allowed('inspect',ref,principal);const value=await read(ref);if(value){const target=await destination(value);signWebhook({tenant:value.tenant,destination:value.destination,deliveryId:value.deliveryId,timestamp:Math.floor(now()/1000),body:value.body},target.keys);}return value?summary(value):null;});},
  redrive(input:WebhookReference,principal:unknown,settings:{confirmedUncertain?:boolean}={}){const ref=reference(input);fields(settings,['confirmedUncertain']);if(settings.confirmedUncertain!==undefined&&typeof settings.confirmedUncertain!=='boolean')throw fail('INVALID_INPUT');return run(async()=>{await allowed('redrive',ref,principal);const value=await read(ref);if(!value||!['dead','uncertain'].includes(value.state)||value.state==='uncertain'&&settings.confirmedUncertain!==true)throw fail('REDRIVE_DENIED');if(value.attempts>=policy.maxAttempts||now()-value.createdAt>=policy.maxAgeMs)throw fail('RETRY_LIMIT');const target=await destination(value);signWebhook({tenant:value.tenant,destination:value.destination,deliveryId:value.deliveryId,timestamp:Math.floor(now()/1000),body:value.body},target.keys);return summary(await change(value,{state:'pending',lease:null,nextAt:now()}));});},
  dispatch(tenant:string,principal:unknown,queue:WebhookQueuePublisher,settings:{cursor?:string|null;limit?:number}={}){id(tenant);fields(settings,['cursor','limit']);if(queue?.acknowledged!==true||queue.destructiveRead!==false||typeof queue.publish!=='function')return Promise.reject(fail('ACKNOWLEDGED_QUEUE_REQUIRED'));const limit=number(settings.limit??20,1,50),cursor=settings.cursor??null;if(cursor!==null)id(cursor);
   return run(async()=>{await allowed('dispatch',{tenant,deliveryId:cursor??'page'},principal);const page=await store.due(tenant,now(),cursor,limit);if(!page||!Array.isArray(page.ids)||page.ids.length>limit||page.next!==null&&typeof page.next!=='string')throw fail('INVALID_PAGE');let previous=cursor;for(const deliveryId of page.ids){id(deliveryId);if(previous!==null&&deliveryId<=previous)throw fail('INVALID_PAGE');previous=deliveryId;}if(page.next!==null&&(page.next!==previous||!page.ids.length))throw fail('INVALID_PAGE');for(const deliveryId of page.ids){const ref={tenant,deliveryId};await allowed('deliver',ref,principal);const record=await read(ref);if(!record)throw fail('INVALID_PAGE');await destination(record);await queue.publish(ref);}return {published:page.ids.length,next:page.next};});
  },
  async close(){closed=true;for(const controller of controllers)controller.abort();await Promise.allSettled([...pending]);},
  status(){return {closed,pending:pending.size};}
 };
}
