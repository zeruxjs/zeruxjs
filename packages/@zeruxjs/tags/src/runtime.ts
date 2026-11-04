import {adminOrigin,adminPath,adminAsset,type TagAdminAuditEvent} from './admin-policy.js';
import {importTagDefinition,exportTagDefinition} from './transfer.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {validateTagProviders,inertTagJson} from './providers.js';
import {createAnalyticsCollector,requestUtcDay,reserveNewRequestId,validRequestId} from '@zeruxjs/analytics';
import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type {TagContainer,TagEvent,TagRuntimeOptions,Scalar,Values,Variable,Condition,TagDefinition,TagContainerStore} from './types.js';
import {createMemoryTagStore,emptyTagContainer,validateContainer} from './container.js';
import {browserScript} from './browser.js';
import {publishedContainer,releaseSummary,saveTagDraft,publishTagDraft,rollbackTagRelease} from './governance.js';
import {dashboard} from './dashboard.js';

const nameRe=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
const safeName=(name:unknown)=>typeof name==='string'&&nameRe.test(name);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff'}});
const pathOk=(s:string)=>/^\/[A-Za-z0-9/_-]*$/.test(s)&&s!=='/'&&!s.includes('//')&&!s.endsWith('/');
const scalar=(v:unknown):v is Scalar=>v===null||typeof v==='string'&&v.length<=1024||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean';
const cleanValues=(values:unknown):Values=>{
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>40)throw new TypeError('Invalid tag values');
  const result:Values=Object.create(null) as Values;
  for(const [k,v] of Object.entries(values)){
    if(!safeName(k)||['__proto__','constructor','prototype','zRequestId','zRequestUtcDay'].includes(k)||!scalar(v))throw new TypeError('Invalid tag values');result[k]=v;
  }
  return result;
};
function resolveVariable(variable:Variable,ev:TagEvent):Scalar|undefined{
  if(variable.type==='constant')return variable.value;
  if(!variable.key)return undefined;
  if(variable.type==='event')return ev.properties[variable.key];
  if(variable.type==='dataLayer')return ev.data?.[variable.key];
  if(variable.type==='context'){
    const context:Record<string,string|undefined>={requestId:ev.requestId,requestUtcDay:ev.requestUtcDay,source:ev.source,site:ev.site,pathname:ev.pathname,sessionId:ev.sessionId,name:ev.name};
    return Object.hasOwn(context,variable.key)?context[variable.key]:undefined;
  }
}
/** Template parameters reference only registered variables, with no eval or dynamic code. */
function tagParameters(tag:TagDefinition,event:TagEvent,container:TagContainer):Values {
  const params:Values=Object.create(null) as Values;
  for(const [key,value] of Object.entries(tag.parameters??{})){
    if(typeof value==='string'){
      const match=/^\{\{([A-Za-z][A-Za-z0-9_.:-]{0,95})\}\}$/.exec(value);
      if(match){const variable=container.variables.find(v=>v.id===match[1]);
        const resolved=variable?resolveVariable(variable,event):undefined;
        if(resolved!==undefined)params[key]=resolved;continue;
      }
    }
    params[key]=value;
  }
  return params;
}
function matchesCondition(condition:Condition,ev:TagEvent,container:TagContainer){
  const v=container.variables.find(x=>x.id===condition.field);
  const actual=v?resolveVariable(v,ev):ev.properties[condition.field]??ev.data?.[condition.field];
  const expected=condition.value;
  switch(condition.operator){case 'exists':return actual!==undefined&&actual!==null;
    case 'eq':return actual===expected;case 'neq':return actual!==expected;
    case 'contains':return typeof actual==='string'&&typeof expected==='string'&&actual.includes(expected);
    case 'gte':return typeof actual==='number'&&typeof expected==='number'&&actual>=expected;
    case 'lte':return typeof actual==='number'&&typeof expected==='number'&&actual<=expected;
  }
}
export function createTagManager(options:TagRuntimeOptions){
  if(typeof options?.analytics?.track!=='function'||typeof options?.requestIds?.reserve!=='function')throw new TypeError('Analytics and request ID store are required');
  if(options.site!==undefined&&(typeof options.site!=='string'||!options.site||options.site.length>200||/[\x00-\x1f]/.test(options.site)))throw new TypeError('Invalid fixed tag site');
  if(options.providers&&['validate','dispatch','allowsDestination','configured','close'].some(k=>typeof (options.providers as unknown as Record<string,unknown>)[k]!=='function'))throw new TypeError('Invalid explicit provider registry');
  const prefix=options.prefix??'/_tags';if(!pathOk(prefix))throw new TypeError('Invalid tag endpoint path');
  if(options.dashboardHost&&!/^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(options.dashboardHost))throw new TypeError('Invalid tag dashboard host');
  if(options.publicOrigin){const url=new URL(options.publicOrigin);
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new TypeError('Invalid public tagging origin');
  }
  if(options.defaultConsent!==undefined&&!['granted','denied'].includes(options.defaultConsent)||options.requireBrowserConsent!==undefined&&typeof options.requireBrowserConsent!=='boolean'||options.maxBodyBytes!==undefined&&(!Number.isSafeInteger(options.maxBodyBytes)||options.maxBodyBytes<256||options.maxBodyBytes>262144))throw new TypeError('Invalid consent/body policy');
  const maxPending=options.maxConcurrentDispatches??8,dispatchTimeout=options.dispatchTimeoutMs??2000;
  if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>64||!Number.isSafeInteger(dispatchTimeout)||dispatchTimeout<1||dispatchTimeout>30000||options.ownProviders!==undefined&&typeof options.ownProviders!=='boolean'||options.allowDispatch!==undefined&&typeof options.allowDispatch!=='function')throw new TypeError('Invalid dispatch policy');
  const dispatchContext=new AsyncLocalStorage<boolean>(),jobs=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();let closed=false,closing:Promise<void>|undefined;
  const mount=options.administration??{};const adminMax=mount.maxConcurrent??8;if(!Number.isSafeInteger(adminMax)||adminMax<1||adminMax>64)throw new RangeError('Invalid admin concurrency');const adminBase=adminPath(mount.basePath??prefix+'/admin'),uiPath=adminPath(mount.uiPath??adminBase),publicAdminOrigin=mount.publicOrigin!==undefined?adminOrigin(mount.publicOrigin):undefined;
  if(mount.serveUi!==undefined&&typeof mount.serveUi!=='boolean'||mount.allowedOrigins!==undefined&&(!Array.isArray(mount.allowedOrigins)||mount.allowedOrigins.length>16)||mount.verifyCsrf!==undefined&&typeof mount.verifyCsrf!=='function'||mount.issueCsrfToken!==undefined&&typeof mount.issueCsrfToken!=='function'||Boolean(mount.audit)!==Boolean(mount.auditContext)||mount.audit!==undefined&&typeof mount.audit!=='function'||mount.auditContext!==undefined&&typeof mount.auditContext!=='function')throw new TypeError('Invalid admin mount policy');
  if(mount.issueCsrfToken&&!mount.verifyCsrf)throw new TypeError('CSRF token issuance requires a verifier');
  const adminOrigins=new Set((mount.allowedOrigins??[]).map(adminOrigin));if(adminOrigins.size&&!mount.verifyCsrf)throw new TypeError('Cross-origin admin requires a host CSRF verifier');
  const styleHref=mount.styleHref!==undefined?adminAsset(mount.styleHref):undefined,scriptSrc=mount.scriptSrc!==undefined?adminAsset(mount.scriptSrc):undefined;
  const mountPaths=[...(mount.serveUi===false?[]:[uiPath]),...['api','validate','preview','import','export','status','publish','rollback'].map(name=>adminBase+'/'+name),prefix+'/collect',prefix+'/ttag.js'];if(new Set(mountPaths).size!==mountPaths.length)throw new TypeError('Conflicting admin mount paths');
  const apiUrl=(publicAdminOrigin??'')+adminBase;const adminJobs=new Set<Promise<Response>>();
  const store:TagContainerStore=options.store??createMemoryTagStore(options.container??emptyTagContainer());
  const http=options.fetch??fetch;
  const warn=(message:string)=>{try{(options.onWarning??console.warn)(`[zerux tags] ${message}`);}catch{/* telemetry warnings cannot block traffic */}};
  const siteByOrigin=structuredClone(options.siteByOrigin??{});
  const configuredDestinations:NonNullable<TagRuntimeOptions['destinations']>=Object.assign(Object.create(null),structuredClone(options.destinations??{})),credentials:NonNullable<TagRuntimeOptions['credentials']>=Object.assign(Object.create(null),structuredClone(options.credentials??{}));
  for(const destination of Object.values(configuredDestinations)){
    const url=new URL(destination.url);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname||isIP(url.hostname)!==0||url.hostname.startsWith('[')||/^(localhost|.+\.(?:localhost|local|internal))\.?$/i.test(url.hostname))throw new TypeError('Webhook destinations must be public HTTPS DNS endpoints');
  }
  const triggerMatches=(type:string,name:string,eventName?:string)=>type==='all'||
    type==='event'&&eventName===name||type==='pageview'&&['page_view','page.view'].includes(name)||
    type==='click'&&name==='click'||type==='form'&&name==='form_submit'||type==='history'&&name==='history_change';
  function matchedTriggers(container:TagContainer,event:TagEvent){
    const cache=new Map<string,boolean>();let work=0;
    const match=(id:string,depth=0):boolean=>{if(++work>5000||depth>8)throw new RangeError('Trigger evaluation limit');if(cache.has(id))return cache.get(id)!;const t=container.triggers.find(t=>t.id===id);if(!t||t.enabled===false)return false;let matched=false;if(t.type==='group'){const values=t.composition!.triggerIds.map(id=>match(id,depth+1));matched=t.composition!.mode==='all'?values.every(Boolean):t.composition!.mode==='any'?values.some(Boolean):!values[0];}else matched=triggerMatches(t.type,event.name,t.event);matched=matched&&(t.conditions??[]).every(c=>matchesCondition(c,event,container));cache.set(id,matched);return matched;};
    return container.triggers.filter(t=>match(t.id));
  }
  async function runEvaluation(event:TagEvent,consented:()=>boolean,signal:AbortSignal){
    let container:TagContainer;
    try{container=publishedContainer(await store.load());validateTagProviders(container,options.providers);}catch{warn('Published container unavailable');return {requestId:event.requestId,requestUtcDay:event.requestUtcDay,matchedTriggers:[],firedTags:[],failures:['container_unavailable']};}
    const matched=matchedTriggers(container,event);
    const ids=new Set(matched.map(t=>t.id)),firedTags:string[]=[],failures:string[]=[];
    for(const tag of container.tags){
      if(tag.enabled===false||!tag.triggerIds.some(id=>ids.has(id)))continue;
      try{
        if(signal.aborted||!consented())break;
        if(options.allowDispatch&&await options.allowDispatch(Object.freeze(structuredClone(event)))!==true)continue;
        if(signal.aborted||!consented())break;
        const params=tagParameters(tag,event,container);
        if(tag.type==='analytics'){
          await options.analytics.track({name:tag.eventName??event.name,source:event.source,site:event.site,pathname:event.pathname,sessionId:event.sessionId,requestId:event.requestId,requestUtcDay:event.requestUtcDay,properties:{...event.properties,...params}});
        }else if(tag.type==='ga4'){
          const secret=credentials[tag.credentialRef??'']?.secret;
          if(!secret)throw new Error('Missing GA4 credential');
          const variable=container.variables.find(v=>v.id===tag.clientIdVariable);
          const clientId=variable?resolveVariable(variable,event):event.sessionId;
          if(typeof clientId!=='string'||!clientId||clientId.length>128)throw new Error('GA4 client_id must be supplied explicitly');
          const url=new URL('https://www.google-analytics.com/mp/collect');url.searchParams.set('measurement_id',tag.measurementId!);url.searchParams.set('api_secret',secret);
          const response=await http(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:clientId,events:[{name:tag.eventName??event.name,params:{...event.properties,...params,zerux_request_id:event.requestId}}]}),signal:AbortSignal.any([signal,AbortSignal.timeout(1000)]),redirect:'error'});
          try{if(!response.ok)throw new Error('GA4 endpoint rejected request');}finally{await response.body?.cancel().catch(()=>{});}
        }else if(tag.type==='provider'){
          let sends=0;const sendJobs:Promise<void>[]=[];let providerDone=false;
          const send=(ref:string,payload:Values)=>{if(providerDone)throw new Error('Provider scope closed');if(++sends>4||!options.providers!.allowsDestination(tag,ref))throw new Error('Provider destination budget denied');const task=(async()=>{if(signal.aborted||!consented()||options.allowDispatch&&await options.allowDispatch(Object.freeze(structuredClone(event)))!==true)throw new Error('Dispatch denied');if(signal.aborted||!consented())throw new Error('Dispatch denied');const values=cleanValues(payload),destination=configuredDestinations[ref];if(!destination)throw new Error('Unapproved destination');const body=JSON.stringify(values);if(Buffer.byteLength(body)>16384)throw new RangeError('Provider event size');const response=await http(destination.url,{method:'POST',headers:{...destination.headers,'content-type':'application/json'},body,signal,redirect:'error'});try{if(!response.ok)throw new Error('Destination rejected');}finally{await response.body?.cancel().catch(()=>{});}})();sendJobs.push(task);void task.catch(()=>{});return task;};
          try{await options.providers!.dispatch(tag,{event:Object.freeze({...event,properties:Object.freeze({...event.properties}),data:Object.freeze({...event.data})}),config:Object.freeze({...tag.publicConfig}),parameters:Object.freeze({...params}),signal,send});}finally{providerDone=true;await Promise.allSettled(sendJobs);}await Promise.all(sendJobs);
        }else{
          const destination=configuredDestinations[tag.destinationRef??''];if(!destination)throw new Error('Missing allowlisted destination');
          const response=await http(destination.url,{method:'POST',headers:{...destination.headers,'content-type':'application/json'},body:JSON.stringify({event:tag.eventName??event.name,requestId:event.requestId,utcDay:event.requestUtcDay,site:event.site,properties:event.properties,parameters:params}),signal:AbortSignal.any([signal,AbortSignal.timeout(1000)]),redirect:'error'});
          try{if(!response.ok)throw new Error('Destination rejected request');}finally{await response.body?.cancel().catch(()=>{});}
        }
        firedTags.push(tag.id);
      }catch{failures.push(tag.id);warn(`Destination failed for tag ${tag.id}`);} // Tags are isolated, never block other tags.
    }
    const result={requestId:event.requestId,requestUtcDay:event.requestUtcDay,matchedTriggers:[...ids],firedTags,failures};
    if(options.debug)try{options.onDebug?.({requestId:event.requestId,event:event.name,matchedTriggers:result.matchedTriggers,firedTags,failures});}catch{ /* This optional failure is intentionally ignored. */ }
    return result;
  }
  async function evaluate(event:TagEvent,consented:()=>boolean=()=>options.defaultConsent!=='denied'){
    const failed=(reason:string)=>({requestId:event?.requestId??'',requestUtcDay:event?.requestUtcDay??'',matchedTriggers:[] as string[],firedTags:[] as string[],failures:[reason]});
    if(closed)return failed('closed');if(dispatchContext.getStore())return failed('recursive_dispatch');if(jobs.size>=maxPending)return failed('dispatch_overload');
    inertTagJson(event,options.maxBodyBytes??16384);if(!event||Object.keys(event).some(k=>!['name','properties','site','pathname','sessionId','requestId','requestUtcDay','source','data'].includes(k))||!safeName(event.name)||!validRequestId(event.requestId)||!/^\d{4}-\d\d-\d\d$/.test(event.requestUtcDay)||!['web','server'].includes(event.source)||options.site!==undefined&&event.site!==undefined&&event.site!==options.site&&!(event.source==='web'&&Object.values(siteByOrigin).includes(event.site)))throw new TypeError('Invalid event scope');
    if(event.site!==undefined&&(typeof event.site!=='string'||!event.site||event.site.length>200||/[\x00-\x1f]/.test(event.site))||event.pathname!==undefined&&(typeof event.pathname!=='string'||event.pathname.length>2000)||event.sessionId!==undefined&&(typeof event.sessionId!=='string'||event.sessionId.length>200))throw new TypeError('Invalid event context');
    event={...event,pathname:event.pathname?.split(/[?#]/)[0],site:event.site??options.site,properties:cleanValues(event.properties),data:cleanValues(event.data??{})};if(!consented())return failed('consent_denied');
    const controller=new AbortController();controllers.add(controller);let timer:ReturnType<typeof setTimeout>|undefined;let stop=()=>{};
    const cancelled=new Promise<ReturnType<typeof failed>>(resolve=>{stop=()=>resolve(failed('dispatch_cancelled'));controller.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>controller.abort(),dispatchTimeout);});
    const native=dispatchContext.run(true,()=>runEvaluation(event,consented,controller.signal)).catch(()=>failed('dispatch_unavailable')).finally(()=>{jobs.delete(native);controllers.delete(controller);});jobs.add(native);
    try{return await Promise.race([native,cancelled]);}finally{if(timer)clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
  }
  /** Server-side event entry point; request IDs may be shared within a single caller request scope. */
  function createAstag(context:{requestId?:string;requestUtcDay?:string;site?:string;pathname?:string;sessionId?:string}={}){
    if(closed)throw new Error('Tag manager closed');
    if(options.site!==undefined&&context.site!==undefined&&context.site!==options.site)throw new TypeError('Fixed tag site mismatch');
    const layer:Values=Object.create(null) as Values;
    const conf:{site?:string;pathname?:string;sessionId?:string;debug?:boolean}={site:context.site??options.site,pathname:context.pathname,sessionId:context.sessionId};
    let consent:'granted'|'denied'=options.defaultConsent??'granted';
    const reservedDay=context.requestUtcDay??requestUtcDay();
    let allocated:Promise<string>|undefined;
    async function ensureId(){
      if(!allocated){const day=reservedDay;allocated=(async()=>{
        if(context.requestId){if(!validRequestId(context.requestId))throw new TypeError('Invalid request ID');
          if(!await options.requestIds.reserve(day,context.requestId))throw new Error('Duplicate request ID');return context.requestId;
        }
        return reserveNewRequestId(options.requestIds,day);
      })();}return allocated;
    }
    return async function astag(command:'event'|'config'|'set'|'get'|'consent',arg?:string|Record<string,unknown>,value?:unknown):Promise<unknown>{
      if(command==='set'){
        if(typeof arg!=='string'||!safeName(arg)||['__proto__','constructor','prototype','zRequestId','zRequestUtcDay'].includes(arg)||!scalar(value)||!Object.hasOwn(layer,arg)&&Object.keys(layer).length>=40)throw new TypeError('Invalid data-layer value');layer[arg]=value;return true;
      }
      if(command==='get')return typeof arg==='string'?layer[arg]??(Object.hasOwn(conf,arg)?(conf as Record<string,unknown>)[arg]:undefined):undefined;
      if(command==='config'){
        if(typeof arg!=='object'||arg===null)throw new TypeError('Config must be an object');
        if(options.site!==undefined&&arg.site!==undefined&&arg.site!==options.site)throw new TypeError('Fixed tag site mismatch');
        for(const [key,item] of Object.entries(arg))if(['site','pathname','sessionId'].includes(key)&&typeof item==='string'&&item.length<=200)(conf as Record<string,unknown>)[key]=item;
        return true;
      }
      if(command==='consent'){
        if(arg!=='granted'&&arg!=='denied')throw new TypeError('Invalid telemetry consent state');consent=arg;return true;
      }
      if(command!=='event'||typeof arg!=='string'||!safeName(arg))throw new TypeError('Invalid tag operation');
      if(consent==='denied')return undefined;
      const properties=cleanValues(value??{});let id:string;
      try{id=await ensureId();}catch{allocated=undefined;warn('Request ID reservation unavailable');
        return {requestId:'',requestUtcDay:reservedDay,matchedTriggers:[],firedTags:[],failures:['request_id_unavailable']};}
      return evaluate({name:arg,properties,source:'server',requestId:id,requestUtcDay:reservedDay,site:conf.site,pathname:conf.pathname,sessionId:conf.sessionId,data:{...layer}},()=>consent==='granted');
    };
  }
  const collector=createAnalyticsCollector({analytics:options.analytics,prefix,allowedOrigins:options.allowedOrigins,serverToken:options.serverToken,requestIdStore:options.requestIds,requireRequestId:true,
    siteByOrigin,requireBrowserConsent:options.requireBrowserConsent??options.defaultConsent==='denied',botPolicy:options.botPolicy,
    maxBodyBytes:options.maxBodyBytes??16_384,maxEventsPerMinute:options.maxEventsPerMinute??120,allowTextPlainBeacon:true,
    dispatch:async(input,ctx)=>{if(!safeName(input.name))return;const props=cleanValues(input.properties??{}),data=cleanValues(input.data??{});
      await evaluate({name:input.name,properties:props,data,site:input.site??options.site,pathname:input.pathname,sessionId:input.sessionId,source:'web',requestId:ctx.requestId,requestUtcDay:ctx.utcDay},()=>true);}
  });
  const endpoint=options.publicOrigin?new URL(prefix+'/collect',options.publicOrigin).href:prefix+'/collect';
  const scriptHandler=async(_request:Request)=>{
    if(closed)return json({error:'Closed'},503);
    let activeTypes:string[]=[];
    try{const container=publishedContainer(await store.load());activeTypes=[...new Set(container.triggers.filter(t=>t.enabled!==false).map(t=>t.type))];}catch{ /* This optional failure is intentionally ignored. */ }
    const js=browserScript({endpoint,site:options.site??'',debug:options.debug===true,autoEvents:activeTypes,defaultConsent:options.defaultConsent??'granted'});
    return new Response(js,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'cross-origin'}});
  };
  const authorized=async(request:Request)=>{
    if(closed)return false;
    if(options.dashboardHost&&new URL(request.url).host!==options.dashboardHost)return false;
    if(!options.authorizeAdmin)return false;
    try{return await options.authorizeAdmin(request)===true;}catch{return false;}
  };
  const canPublish=async(request:Request)=>{if(!await authorized(request)||!options.authorizePublish)return false;
    try{return await options.authorizePublish(request)===true;}catch{return false;}};
  const sameOrigin=async(request:Request)=>{const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin&&!adminOrigins.has(origin))return false;if(mount.verifyCsrf){if(!request.headers.get('x-zerux-csrf')||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return false;try{return await mount.verifyCsrf(request)===true;}catch{return false;}}return origin===new URL(request.url).origin;};
  const readBody=async(request:Request,limit=8192)=>{if(!request.body)throw new TypeError('Body required');const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,body='',expired=false;const abort=()=>{void reader.cancel().catch(()=>{});};const timer=setTimeout(()=>{expired=true;abort();},5000);request.signal.addEventListener('abort',abort,{once:true});try{while(true){if(expired||request.signal.aborted)throw new Error('Read cancelled');const next=await reader.read();if(expired||request.signal.aborted)throw new Error('Read cancelled');if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit)throw new RangeError('Body too large');body+=decoder.decode(next.value,{stream:true});}return JSON.parse(body+decoder.decode()) as unknown;}finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}};
  const admin=async(request:Request):Promise<Response>=>{
    if(!await authorized(request))return new Response('Not found',{status:404});
    let csrfToken='';try{csrfToken=await mount.issueCsrfToken?.(request)??'';if(typeof csrfToken!=='string'||csrfToken.length>1024||/[\x00-\x1f]/.test(csrfToken))throw new TypeError('Invalid CSRF token');}catch{return json({error:'UI unavailable'},503);}
    const html=dashboard(prefix,{apiBaseUrl:apiUrl,csrfToken,styleHref,scriptSrc}),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const styleHashes=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ');
    const assetOrigin=(asset:string|undefined)=>asset?(asset.startsWith('http')?new URL(asset).origin:"'self'") :'';
    const scriptHashes=scripts.map(match=>`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ');
    return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','vary':'Cookie, Authorization','content-security-policy':`default-src 'none'; script-src ${scriptHashes} ${assetOrigin(scriptSrc)}; style-src ${styleHashes} ${assetOrigin(styleHref)}; connect-src 'self' ${publicAdminOrigin??''}; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'}});
  };
  const preview=async(request:Request):Promise<Response>=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!await sameOrigin(request))return json({error:'Origin required'},403);
    try{
      const input=await readBody(request) as {name:string;properties?:Values;data?:Values;mode?:'draft'|'published'};
      if(!input||Object.keys(input).some(k=>!['name','properties','data','mode'].includes(k)))return json({error:'Invalid preview scope'},422);
      if(input.mode!==undefined&&!['draft','published'].includes(input.mode))return json({error:'Invalid mode'},422);
      if(!safeName(input.name))return json({error:'Invalid event name'},422);
      const ev:TagEvent={name:input.name,properties:cleanValues(input.properties??{}),data:cleanValues(input.data??{}),source:'web',site:options.site,requestId:'PREVIEWONLY00000',requestUtcDay:requestUtcDay()};
      const loaded=validateContainer(await store.load());
      const container=input.mode==='published'?publishedContainer(loaded):loaded;
      validateTagProviders(container,options.providers);const consented=options.defaultConsent!=='denied'&&(options.allowDispatch?await options.allowDispatch(Object.freeze(ev))===true:true);
      const matched=consented?matchedTriggers(container,ev):[];
      const ids=new Set(matched.map(t=>t.id));
      return json({dryRun:true,mode:input.mode??'draft',event:ev.name,matchedTriggers:[...ids],candidateTags:container.tags.filter(t=>t.enabled!==false&&t.triggerIds.some(id=>ids.has(id))&&(t.type!=='webhook'||!!configuredDestinations[t.destinationRef??''])&&(t.type!=='ga4'||!!credentials[t.credentialRef??'']?.secret)&&(t.type!=='provider'||options.providers!.configured(t,Object.keys(configuredDestinations)))).map(t=>({id:t.id,type:t.type}))});
    }catch{return json({error:'Invalid preview'},422);}
  };
  const api=async(request:Request):Promise<Response>=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method==='GET'){try{return json(validateContainer(await store.load()));}catch{return json({error:'Container unavailable'},503);}}
    if(request.method!=='PUT')return json({error:'Method not allowed'},405);
    if(!await sameOrigin(request))return json({error:'Origin required'},403);
    let parsed:TagContainer;try{parsed=validateContainer(await readBody(request,128*1024));validateTagProviders(parsed,options.providers);}catch{return json({error:'Invalid container'},422);}
    try{if(!await saveTagDraft(store,parsed,parsed.version-1,options.providers))return json({error:'Version conflict'},409);return json({ok:true,version:parsed.version,mode:'draft'});}catch{return json({error:'Draft storage unavailable',committed:'unknown'},503);}
  };
  const transfer=async(request:Request,mode:'import'|'export')=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method!==(mode==='import'?'POST':'GET'))return json({error:'Method not allowed'},405);
    if(mode==='import'&&(!await sameOrigin(request)||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'))return json({error:'Origin required'},403);
    try{if(mode==='export')return new Response(exportTagDefinition(await store.load(),options.providers),{headers:{'content-type':'application/json','cache-control':'private, no-store','content-disposition':'attachment; filename="tag-definition.json"','vary':'Cookie, Authorization'}});
      const input=await readBody(request,128*1024) as {expectedVersion:number;definition:string};if(!input||Object.keys(input).some(k=>!['expectedVersion','definition'].includes(k))||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new TypeError('Invalid import revision');
      const candidate=importTagDefinition(input.definition,options.providers);
      if(candidate.tags.some(tag=>tag.enabled!==false&&(tag.type==='provider'&&!options.providers!.configured(tag,Object.keys(configuredDestinations))||tag.type==='webhook'&&!configuredDestinations[tag.destinationRef??'']||tag.type==='ga4'&&!credentials[tag.credentialRef??'']?.secret)))throw new TypeError('Unconfigured imported destination');
      const next={...candidate,version:input.expectedVersion+1};if(!await saveTagDraft(store,next,input.expectedVersion,options.providers))return json({error:'Version conflict'},409);return json({ok:true,version:next.version,mode:'draft'});
    }catch{return json({error:'Invalid or incompatible tag definition'},422);}
  };
  const validate=async(request:Request)=>{if(!await authorized(request))return json({error:'Forbidden'},403);if(request.method!=='POST')return json({error:'Method not allowed'},405);if(!await sameOrigin(request))return json({error:'Origin required'},403);try{const candidate=validateContainer(await readBody(request,128*1024));validateTagProviders(candidate,options.providers);return json({ok:true,version:candidate.version});}catch{return json({error:'Invalid or incompatible container'},422);}};
  const status=async(request:Request)=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method!=='GET')return json({error:'Method not allowed'},405);
    return json(releaseSummary(await store.load()));
  };
  const transition=async(request:Request,action:'publish'|'rollback')=>{
    if(!await canPublish(request))return json({error:'Forbidden'},403);
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!await sameOrigin(request))return json({error:'Origin required'},403);
    try{
      const payload=await readBody(request) as {expectedVersion?:number;releaseId?:number};
      if(!payload||!Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion!<1||
        action==='rollback'&&(!Number.isSafeInteger(payload.releaseId)||payload.releaseId!<1))return json({error:'Invalid transition'},422);
      if(action==='publish'){const candidate=validateContainer(await store.load());validateTagProviders(candidate,options.providers);if(candidate.tags.some(tag=>tag.type==='provider'&&!options.providers!.configured(tag,Object.keys(configuredDestinations))))throw new TypeError('Unconfigured provider destination');if(candidate.version!==payload.expectedVersion)return json({error:'Version conflict'},409);
        if(candidate.tags.some(tag=>tag.enabled!==false&&(tag.type==='ga4'&&!credentials[tag.credentialRef??'']?.secret||
          tag.type==='webhook'&&!configuredDestinations[tag.destinationRef??''])))return json({error:'Unconfigured destination'},422);}
      if(action==='rollback'){const current=validateContainer(await store.load()),target=current.governance?.history.find(r=>r.id===payload.releaseId)?.container??(!current.governance&&payload.releaseId===1?current:undefined);if(target){validateTagProviders(target,options.providers);if(target.tags.some(tag=>tag.enabled!==false&&(tag.type==='provider'&&!options.providers!.configured(tag,Object.keys(configuredDestinations))||tag.type==='webhook'&&!configuredDestinations[tag.destinationRef??'']||tag.type==='ga4'&&!credentials[tag.credentialRef??'']?.secret)))throw new TypeError('Unconfigured rollback destination');}}
      let auditEvent:TagAdminAuditEvent|undefined;if(mount.audit){try{const context=await mount.auditContext!(request);if(!context||![context.tenant,context.actor].every(v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v)))throw new Error('Invalid audit context');const current=validateContainer(await store.load());auditEvent={version:1,operationId:randomUUID(),phase:'intent',action,tenant:context.tenant,actor:context.actor,at:Date.now(),expectedVersion:payload.expectedVersion!,...(payload.releaseId!==undefined?{releaseId:payload.releaseId}:{}),definitionHash:createHash('sha256').update(JSON.stringify(action==='publish'?{...current,governance:undefined}:current.governance?.history.find(r=>r.id===payload.releaseId)?.container??publishedContainer(current))).digest('hex')};await mount.audit(Object.freeze(auditEvent));}catch{return json({error:'Audit unavailable',committed:false},503);}}
      const success=action==='publish'?await publishTagDraft(store,payload.expectedVersion!,options.providers):
        await rollbackTagRelease(store,payload.expectedVersion!,payload.releaseId!,options.providers);
      if(!success){let audit='recorded';if(auditEvent)try{await mount.audit!(Object.freeze({...auditEvent,phase:'conflict',at:Date.now()}));}catch{audit='unavailable';}return json({error:'Version conflict',audit},409);}
      if(auditEvent)try{await mount.audit!(Object.freeze({...auditEvent,phase:'committed',at:Date.now(),revision:payload.expectedVersion!+1}));}catch{return json({error:'Audit unavailable',committed:true,version:payload.expectedVersion!+1},503);}
      try{return json({ok:true,...releaseSummary(await store.load())});}catch{return json({ok:true,committed:true,version:payload.expectedVersion!+1,statusUnavailable:true});}
    }catch(error){return error instanceof RangeError||error instanceof TypeError||error instanceof SyntaxError?json({error:error instanceof RangeError?'Release unavailable':'Invalid transition'},422):json({error:'Transition unavailable',committed:'unknown'},503);}
  };
  const protectedRoute=(handler:(request:Request)=>Promise<Response>)=>(request:Request):Promise<Response>=>{
    const origin=request.headers.get('origin'),same=origin===new URL(request.url).origin,allowed=!!origin&&(same||adminOrigins.has(origin));
    const finish=(response:Response)=>{const headers=new Headers(response.headers);headers.set('cache-control','private, no-store');headers.set('vary','Origin, Cookie, Authorization');if(allowed){headers.set('access-control-allow-origin',origin!);headers.set('access-control-allow-credentials','true');}return new Response(response.body,{status:response.status,headers});};
    if(closed)return Promise.resolve(finish(json({error:'Closed'},503)));
    if(origin&&!allowed)return Promise.resolve(finish(json({error:'Origin denied'},403)));
    if(request.method==='OPTIONS'){const method=request.headers.get('access-control-request-method'),headers=(request.headers.get('access-control-request-headers')??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);if(!allowed||!['GET','POST','PUT'].includes(method??'')||headers.some(v=>!['content-type','x-zerux-csrf','authorization'].includes(v)))return Promise.resolve(finish(json({error:'Preflight denied'},403)));const response=finish(new Response(null,{status:204}));response.headers.set('access-control-allow-methods','GET, POST, PUT');response.headers.set('access-control-allow-headers','Content-Type, X-Zerux-CSRF, Authorization');return Promise.resolve(response);}
    if(adminJobs.size>=adminMax)return Promise.resolve(finish(json({error:'Admin overloaded'},503)));
    const job=Promise.resolve().then(()=>handler(request)).catch(()=>json({error:'Admin operation unavailable'},503)).then(finish).finally(()=>adminJobs.delete(job));adminJobs.add(job);return job;
  };
  return {
    createAstag,evaluate,status:()=>({closed,pending:jobs.size,adminPending:adminJobs.size}),close(){if(closing)return closing;closed=true;for(const c of controllers)c.abort();return closing=(async()=>{await Promise.allSettled([...jobs,...adminJobs]);if(options.ownProviders)await options.providers?.close();})();},container:()=>store.load(),published:async()=>publishedContainer(await store.load()),store,
    routes(){const adminRoutes=[...(mount.serveUi===false?[]:[{pattern:uiPath,handler:protectedRoute(admin)}]),{pattern:adminBase+'/api',handler:protectedRoute(api)},{pattern:adminBase+'/validate',handler:protectedRoute(validate)},{pattern:adminBase+'/preview',handler:protectedRoute(preview)},{pattern:adminBase+'/import',handler:protectedRoute(request=>transfer(request,'import'))},{pattern:adminBase+'/export',handler:protectedRoute(request=>transfer(request,'export'))},{pattern:adminBase+'/status',handler:protectedRoute(status)},{pattern:adminBase+'/publish',handler:protectedRoute(request=>transition(request,'publish'))},{pattern:adminBase+'/rollback',handler:protectedRoute(request=>transition(request,'rollback'))}];return [{pattern:collector.path,handler:(request:Request)=>closed?Promise.resolve(json({error:'Closed'},503)):collector.handler(request)},{pattern:`${prefix}/ttag.js`,handler:scriptHandler},...(options.authorizeAdmin?adminRoutes:[])];}
  };
}
