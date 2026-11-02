import {randomBytes} from 'node:crypto';
import {createMessageAuthenticator} from '@zeruxjs/security/crypto';
import {createHttpInputAdapter,HttpValidationError,type ClientIssue} from '@zeruxjs/validator/http';
import {unknown,type GenericSchema,type GenericSchemaAsync,type InferOutput} from '@zeruxjs/validator/schemas';
import {isSameOriginRequest,type CsrfTokenManager} from '@zeruxjs/security';
import {escapeHtmlText,escapeHtmlAttribute} from '@zeruxjs/security/encoding';
import {normalizeApiError,ApplicationError,acceptsApiError} from './exceptions/api-error.js';
import {createFetchRoute} from './fetch-route.js';
import type {ZeruxPluginApi,ZeruxRequestContext} from './bootstrap/types.js';
import type {ActionStore,ActionClaim} from './action-stores.js';
export type {ActionStore,ActionClaim} from './action-stores.js';
export interface ActionPrincipal {readonly tenant:string;readonly subject:string;readonly sessionId:string}
export interface ActionContext {readonly principal:Readonly<ActionPrincipal>;readonly signal:AbortSignal;readonly deadline:number}
export interface ActionReference<I=unknown> {readonly url:string;readonly ref:string;readonly inputType?:I}
export interface ActionForm {readonly action:string;readonly method:'post';readonly fields:Readonly<{_action_key:string;_action_csrf:string}>}
export interface ActionDefinition<S extends GenericSchema|GenericSchemaAsync,T> {
 schema:S;
 authorize(input:InferOutput<S>,context:ActionContext):boolean|Promise<boolean>;
 /** Database-only writes on this pin; no email/payment/network side effects. */
 write(tx:T,input:InferOutput<S>,context:ActionContext):void|Promise<void>;
 successRedirect:string;
 /** Runs after a confirmed commit, including committed replays. Must be idempotent. */
 invalidate?(context:ActionContext):void|Promise<void>;
}
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value);
function principal(value:ActionPrincipal):Readonly<ActionPrincipal>{if(!value||!text(value.tenant)||!text(value.subject)||!text(value.sessionId))throw new ApplicationError(401);return Object.freeze({tenant:value.tenant,subject:value.subject,sessionId:value.sessionId});}
function local(value:string){if(typeof value!=='string'||value.length>2048||!/^\/(?!\/)/.test(value)||/[\\\x00-\x20\x7f]/.test(value))throw new TypeError('Invalid action redirect');return value;}
/** Fingerprint only inert validated JSON, without invoking getters/toJSON. */
function canonical(input:unknown):string {
 let entries=0;const ancestors=new Set<object>();
 const visit=(value:any,depth:number):any=>{if(++entries>2000||depth>24)throw new ApplicationError(413);if(typeof value==='string'&&value.length>131072)throw new ApplicationError(413);if(value===null||typeof value==='string'||typeof value==='boolean')return value;if(typeof value==='number'&&Number.isFinite(value))return value;if(!value||typeof value!=='object'||ancestors.has(value)||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new ApplicationError(422);ancestors.add(value);const result:any=Array.isArray(value)?[]:Object.create(null);if(Reflect.ownKeys(value).length>1000)throw new ApplicationError(413);for(const key of Object.keys(value).sort()){const property=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in property)||['__proto__','constructor','prototype'].includes(key))throw new ApplicationError(422);result[key]=visit(property.value,depth+1);}ancestors.delete(value);return result;};
 const json=JSON.stringify(visit(input,0));if(Buffer.byteLength(json)>131072)throw new ApplicationError(413);return json;
}
export function renderActionFields(form:ActionForm):string{return Object.entries(form.fields).map(([name,value])=>`<input type="hidden" name="${escapeHtmlAttribute(name)}" value="${escapeHtmlAttribute(value)}">`).join('');}
/** Explicit app-owned server registry. Construction opens no resources. */
export function createActionRegistry<T>(options:{origin:string;key:Uint8Array;csrf:CsrfTokenManager;store:ActionStore<T>;authenticate:(request:Request,context?:ZeruxRequestContext)=>Promise<ActionPrincipal|null>;maxBytes?:number;maxFields?:number;timeoutMs?:number;maxActive?:number;ttlMs?:number;clockSkewMs?:number;path?:string}){
 if(!options||!(options.key instanceof Uint8Array)||options.key.length!==32||typeof options.authenticate!=='function'||typeof options.csrf?.verify!=='function'||typeof options.csrf.issue!=='function'||options.store?.capability!=='action-atomic-v1'||options.store.durable!==true||typeof options.store.synchronous!=='boolean'||typeof options.store.claim!=='function'||typeof options.store.commit!=='function'||typeof options.origin!=='string'||options.origin.length>2048||!isSameOriginRequest(options.origin,options.origin))throw new TypeError('Invalid action registry');
 const key=Buffer.from(options.key),origin=options.origin,store=options.store,authenticate=options.authenticate,csrf={issue:options.csrf.issue.bind(options.csrf),verify:options.csrf.verify.bind(options.csrf)};
 const maxBytes=options.maxBytes??32768,maxFields=options.maxFields??64,timeout=options.timeoutMs??10000,maxActive=options.maxActive??32,ttl=options.ttlMs??900000,skew=options.clockSkewMs??5000,prefix=options.path??'/_zerux/actions';
 if(!Number.isSafeInteger(maxBytes)||maxBytes<128||maxBytes>131072||!Number.isSafeInteger(maxFields)||maxFields<2||maxFields>200||!Number.isSafeInteger(timeout)||timeout<10||timeout>60000||!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>1024||!Number.isSafeInteger(ttl)||ttl<1000||ttl>86400000||!Number.isSafeInteger(skew)||skew<0||skew>60000||prefix.length>512||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(prefix))throw new TypeError('Invalid action limits');
 const authenticator=createMessageAuthenticator({current:{id:'actions-v1',key},maxBytes:524288}),purpose='zeruxjs.actions.v1';
 const message=(...parts:unknown[])=>JSON.stringify([origin,prefix,...parts]);
 const sign=(...parts:unknown[])=>authenticator.sign(message(...parts),purpose).tag;
 const entries=new Map<string,{token:ActionReference<any>;definition:ActionDefinition<any,T>}>(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let sealed=false,closed=false,closing:Promise<void>|undefined;
 const match=(reference:ActionReference<any>)=>{const entry=entries.get(reference?.ref);if(closed||entry?.token!==reference)throw new TypeError('Unknown action reference');return entry;};
 const issue=(reference:ActionReference<any>,identity:ActionPrincipal):ActionForm=>{match(reference);const who=principal(identity),expires=Date.now()+ttl,nonce=randomBytes(24).toString('base64url'),csrfToken=csrf.issue(who.sessionId),payload=`${expires}.${nonce}`,signature=sign('key',reference.ref,who.tenant,who.subject,payload);if(typeof csrfToken!=='string'||!csrfToken||csrfToken.length>512||/[\x00-\x1f\x7f]/.test(csrfToken))throw new TypeError('Invalid CSRF provider result');return Object.freeze({action:reference.url,method:'post',fields:Object.freeze({_action_key:`${payload}.${signature}`,_action_csrf:csrfToken})});};
 const verify=(token:unknown,ref:string,who:ActionPrincipal)=>{if(typeof token!=='string'||token.length>128)throw new ApplicationError(400);const [time,nonce,signature,...extra]=token.split('.'),expires=Number(time);if(extra.length||!/^\d{13,16}$/.test(time)||!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+ttl+skew||!/^[A-Za-z0-9_-]{32}$/.test(nonce)||!/^[A-Za-z0-9_-]{43}$/.test(signature))throw new ApplicationError(409);if(!authenticator.verify(message('key',ref,who.tenant,who.subject,`${time}.${nonce}`),{v:1,alg:'HS256',kid:'actions-v1',tag:signature},purpose))throw new ApplicationError(403);return {expires,key:sign('record',ref,who.tenant,who.subject,nonce)};};
 const response=(status:number,request:Request,issues:readonly ClientIssue[]=[],outcome?:'committed'|'uncertain')=>{
  const normalized=normalizeApiError(new ApplicationError(status));const safe=issues.slice(0,20).map(issue=>({path:issue.path.slice(0,300),code:issue.code,message:'Invalid input'}));
  const data={ok:false,error:normalized.body.error,issues:safe,...(outcome?{outcome}:{})};
  if(acceptsApiError(request.headers.get('accept')))return Response.json(data,{status,headers:{'cache-control':'no-store',vary:'Accept',...(status===405?{allow:'POST'}:{})}});
  return new Response(`<!doctype html><html><head><title>Form not submitted</title></head><body><main><h1>Form not submitted</h1><p>${escapeHtmlText(normalized.body.error.message)}</p><ul>${safe.map(issue=>`<li>${escapeHtmlText(issue.path)}: Invalid input</li>`).join('')}</ul></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',vary:'Accept',...(status===405?{allow:'POST'}:{}),'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'x-content-type-options':'nosniff'}});
 };
 const handle=(reference:ActionReference<any>,request:Request,requestContext?:ZeruxRequestContext):Promise<Response>=>{
  if(!(request instanceof Request))throw new TypeError('Expected action request');
  const entry=match(reference);sealed=true;if(jobs.size>=maxActive)return Promise.resolve(response(429,request));
  const controller=new AbortController(),sources=[request.signal,...(requestContext?.requestLifecycle?[requestContext.requestLifecycle.signal]:[])],abort=()=>controller.abort();for(const source of sources){source.addEventListener('abort',abort,{once:true});if(source.aborted)abort();}controllers.add(controller);const deadline=Date.now()+timeout,timer=setTimeout(abort,timeout);
  const check=()=>{if(Date.now()>=deadline)controller.abort();controller.signal.throwIfAborted();};
  const adapter=createHttpInputAdapter({maxBytes,maxFields,maxFieldBytes:maxBytes,bodyTimeoutMs:Math.max(10,Math.min(timeout,60000)),maxConcurrentReads:1,duplicates:'reject',files:'reject',signal:controller.signal});
  const job=(async()=>{let claimed=false,committed=false,parsing=false;try{
   if(request.headers.has('content-length')&&(!/^\d+$/.test(request.headers.get('content-length')!)||Number(request.headers.get('content-length'))>maxBytes))return response(413,request);
   if(request.method!=='POST')return response(405,request);
   if(!isSameOriginRequest(request.headers.get('origin')??undefined,origin))return response(403,request);
   const content=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();if(content!=='application/x-www-form-urlencoded')return response(415,request);
   check();const rawIdentity=await authenticate(request,requestContext);if(!rawIdentity)return response(401,request);const who=principal(rawIdentity);check();
   parsing=true;const raw=await adapter.parseFormRequest(unknown(),request);parsing=false;
   if(!raw||typeof raw!=='object'||Array.isArray(raw))return response(400,request);
   const fields=Object.assign(Object.create(null),raw) as Record<string,unknown>,csrfValue=fields._action_csrf,keyValue=fields._action_key;delete fields._action_csrf;delete fields._action_key;
   if(Object.keys(fields).length>maxFields-2)return response(413,request);
   if(typeof csrfValue!=='string'||csrf.verify(csrfValue,who.sessionId)!==true)return response(403,request);
   const verified=verify(keyValue,reference.ref,who);parsing=true;const input=await adapter.parseJsonRequest(entry.definition.schema,new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(fields),signal:controller.signal}));parsing=false;
   const frozen=JSON.parse(canonical(input));const freeze=(value:any)=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};freeze(frozen);
   const context:ActionContext=Object.freeze({principal:who,signal:controller.signal,deadline});
   if(await entry.definition.authorize(frozen,context)!==true)return response(403,request);check();
   const claim:ActionClaim=Object.freeze({key:verified.key,digest:sign('input',reference.ref,who.tenant,who.subject,canonical(frozen)),owner:randomBytes(24).toString('base64url'),expiresAt:verified.expires+skew});
   if(verified.expires<=Date.now())return response(409,request);
   const persistenceDeadline=Math.min(deadline,verified.expires);
   const result=await store.claim(claim,controller.signal,persistenceDeadline);if(result==='conflict'||result==='pending')return response(409,request);if(result!=='claimed'&&result!=='committed')throw new ApplicationError(503);
   claimed=result==='claimed';if(claimed){await store.commit(claim,tx=>entry.definition.write(tx,frozen,context),controller.signal,persistenceDeadline);}committed=true;
   // Confirmation survives caller cancellation. Invalidation is idempotent and may
   // be repeated by a committed replay after an outage; never replay the mutation.
   if(entry.definition.invalidate){const after=new AbortController(),afterDeadline=Date.now()+Math.min(timeout,5000),afterTimer=setTimeout(()=>after.abort(),Math.min(timeout,5000));controllers.add(after);try{await entry.definition.invalidate(Object.freeze({...context,signal:after.signal,deadline:afterDeadline}));}finally{clearTimeout(afterTimer);after.abort();controllers.delete(after);}}
   return acceptsApiError(request.headers.get('accept'))?Response.json({ok:true,redirect:entry.definition.successRedirect},{headers:{'cache-control':'no-store',vary:'Accept'}}):new Response(null,{status:303,headers:{location:entry.definition.successRedirect,'cache-control':'no-store',vary:'Accept'}});
  }catch(error){if(claimed||committed)return response(503,request,[],committed?'committed':'uncertain');if(parsing&&error instanceof HttpValidationError)return response(error.status,request,error.issues);return response(controller.signal.aborted||Date.now()>=deadline?408:error instanceof ApplicationError?error.status:503,request);}
  finally{clearTimeout(timer);controller.abort();await adapter.close();controllers.delete(controller);for(const source of sources)source.removeEventListener('abort',abort);}})();jobs.add(job);void job.finally(()=>jobs.delete(job)).catch(()=>{});return job;
 };
 const close=()=>closing??=(async()=>{closed=true;for(const controller of controllers)controller.abort();await Promise.allSettled([...jobs]);entries.clear();authenticator.destroy();key.fill(0);})();
 return {
  register<S extends GenericSchema|GenericSchemaAsync>(name:string,definition:ActionDefinition<S,T>):ActionReference<InferOutput<S>>{if(closed||sealed||typeof name!=='string'||!/^[_a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)||!definition?.schema||typeof definition.schema['~run']!=='function'||typeof definition.authorize!=='function'||typeof definition.write!=='function'||definition.invalidate!==undefined&&typeof definition.invalidate!=='function'||entries.size>=128||store.synchronous&&definition.write.constructor.name==='AsyncFunction')throw new TypeError('Invalid action registration');const ref=sign('ref',name);if(entries.has(ref))throw new TypeError('Duplicate action');const token=Object.freeze({ref,url:`${prefix}/${ref}`});entries.set(ref,{token,definition:Object.freeze({...definition,successRedirect:local(definition.successRedirect)})});return token;},
  form:issue,handle,
  attach(api:ZeruxPluginApi){
   if(sealed||closed)throw new TypeError('Action registry is sealed');
   const methods=['ALL','GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','CONNECT','TRACE'];
   for(const {token}of entries.values())if(methods.some(method=>api.hasRoute(token.url,method)))throw new TypeError('Action route conflict');
   const added:string[]=[];
   try{for(const {token}of entries.values()){api.addRoute({pattern:token.url,method:'ALL',handler:createFetchRoute((request,context)=>handle(token,request,context)),meta:{streamBody:true}});added.push(token.url);}api.onDispose(close);sealed=true;}
   catch(error){const errors=[error];for(const url of added.reverse())try{api.removeRoute(url,'ALL');}catch(cleanup){errors.push(cleanup);}void close().catch(()=>{});if(errors.length>1)throw new AggregateError(errors,'Action registration rollback failed');throw error;}
  },
  close,get pending(){return jobs.size;}
 };
}
