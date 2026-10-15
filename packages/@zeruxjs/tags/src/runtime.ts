import {createAnalyticsCollector,requestUtcDay,reserveNewRequestId,validRequestId} from '@zeruxjs/analytics';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import type {TagContainer,TagEvent,TagRuntimeOptions,Scalar,Values,Variable,Condition,TagDefinition,TagContainerStore} from './types.js';
import {createMemoryTagStore,emptyTagContainer,validateContainer} from './container.js';
import {browserScript} from './browser.js';
import {publishedContainer,releaseSummary,saveTagDraft,publishTagDraft,rollbackTagRelease} from './governance.js';
import {dashboard} from './dashboard.js';

const nameRe=/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/;
const safeName=(name:unknown)=>typeof name==='string'&&nameRe.test(name);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
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
    return context[variable.key];
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
  if(!options?.analytics||!options?.requestIds)throw new TypeError('Analytics and request ID store are required');
  const prefix=options.prefix??'/_tags';if(!pathOk(prefix))throw new TypeError('Invalid tag endpoint path');
  if(options.dashboardHost&&!/^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(options.dashboardHost))throw new TypeError('Invalid tag dashboard host');
  if(options.publicOrigin){const url=new URL(options.publicOrigin);
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new TypeError('Invalid public tagging origin');
  }
  const store:TagContainerStore=options.store??createMemoryTagStore(options.container??emptyTagContainer());
  const http=options.fetch??fetch;
  const warn=(message:string)=>{try{(options.onWarning??console.warn)(`[zerux tags] ${message}`);}catch{/* telemetry warnings cannot block traffic */}};
  const configuredDestinations=options.destinations??{};
  for(const destination of Object.values(configuredDestinations)){
    const url=new URL(destination.url);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname||isIP(url.hostname)!==0||url.hostname.startsWith('[')||/^(localhost|.+\.(?:localhost|local|internal))\.?$/i.test(url.hostname))throw new TypeError('Webhook destinations must be public HTTPS DNS endpoints');
  }
  const triggerMatches=(type:string,name:string,eventName?:string)=>type==='all'||
    type==='event'&&eventName===name||type==='pageview'&&['page_view','page.view'].includes(name)||
    type==='click'&&name==='click'||type==='form'&&name==='form_submit'||type==='history'&&name==='history_change';
  async function evaluate(event:TagEvent){
    let container:TagContainer;
    try{container=publishedContainer(await store.load());}catch{warn('Published container unavailable');return {requestId:event.requestId,requestUtcDay:event.requestUtcDay,matchedTriggers:[],firedTags:[],failures:['container_unavailable']};}
    const matched=container.triggers.filter(t=>t.enabled!==false&&
      triggerMatches(t.type,event.name,t.event)&&
      (t.conditions??[]).every(condition=>matchesCondition(condition,event,container)));
    const ids=new Set(matched.map(t=>t.id)),firedTags:string[]=[],failures:string[]=[];
    for(const tag of container.tags){
      if(tag.enabled===false||!tag.triggerIds.some(id=>ids.has(id)))continue;
      try{
        const params=tagParameters(tag,event,container);
        if(tag.type==='analytics'){
          await options.analytics.track({name:tag.eventName??event.name,source:event.source,site:event.site,pathname:event.pathname,sessionId:event.sessionId,requestId:event.requestId,requestUtcDay:event.requestUtcDay,properties:{...event.properties,...params}});
        }else if(tag.type==='ga4'){
          const secret=options.credentials?.[tag.credentialRef??'']?.secret;
          if(!secret)throw new Error('Missing GA4 credential');
          const variable=container.variables.find(v=>v.id===tag.clientIdVariable);
          const clientId=variable?resolveVariable(variable,event):event.sessionId;
          if(typeof clientId!=='string'||!clientId||clientId.length>128)throw new Error('GA4 client_id must be supplied explicitly');
          const url=new URL('https://www.google-analytics.com/mp/collect');url.searchParams.set('measurement_id',tag.measurementId!);url.searchParams.set('api_secret',secret);
          const response=await http(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:clientId,events:[{name:tag.eventName??event.name,params:{...event.properties,...params,zerux_request_id:event.requestId}}]}),signal:AbortSignal.timeout(1000)});
          if(!response.ok)throw new Error('GA4 endpoint rejected request');
        }else{
          const destination=configuredDestinations[tag.destinationRef??''];if(!destination)throw new Error('Missing allowlisted destination');
          const response=await http(destination.url,{method:'POST',headers:{...destination.headers,'content-type':'application/json'},body:JSON.stringify({event:tag.eventName??event.name,requestId:event.requestId,utcDay:event.requestUtcDay,site:event.site,properties:event.properties,parameters:params}),signal:AbortSignal.timeout(1000),redirect:'error'});
          if(!response.ok)throw new Error('Destination rejected request');
        }
        firedTags.push(tag.id);
      }catch{failures.push(tag.id);warn(`Destination failed for tag ${tag.id}`);} // Tags are isolated, never block other tags.
    }
    const result={requestId:event.requestId,requestUtcDay:event.requestUtcDay,matchedTriggers:[...ids],firedTags,failures};
    if(options.debug)try{options.onDebug?.({requestId:event.requestId,event:event.name,matchedTriggers:result.matchedTriggers,firedTags,failures});}catch{}
    return result;
  }
  /** Server-side event entry point; request IDs may be shared within a single caller request scope. */
  function createAstag(context:{requestId?:string;requestUtcDay?:string;site?:string;pathname?:string;sessionId?:string}={}){
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
        if(typeof arg!=='string'||!safeName(arg)||!scalar(value))throw new TypeError('Invalid data-layer value');layer[arg]=value;return true;
      }
      if(command==='get')return typeof arg==='string'?layer[arg]??(conf as Record<string,unknown>)[arg]:undefined;
      if(command==='config'){
        if(typeof arg!=='object'||arg===null)throw new TypeError('Config must be an object');
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
      return evaluate({name:arg,properties,source:'server',requestId:id,requestUtcDay:reservedDay,site:conf.site,pathname:conf.pathname,sessionId:conf.sessionId,data:{...layer}});
    };
  }
  const collector=createAnalyticsCollector({analytics:options.analytics,prefix,allowedOrigins:options.allowedOrigins,serverToken:options.serverToken,requestIdStore:options.requestIds,requireRequestId:true,
    siteByOrigin:options.siteByOrigin,requireBrowserConsent:options.requireBrowserConsent??options.defaultConsent==='denied',botPolicy:options.botPolicy,
    maxBodyBytes:options.maxBodyBytes??16_384,maxEventsPerMinute:options.maxEventsPerMinute??120,allowTextPlainBeacon:true,
    dispatch:async(input,ctx)=>{if(!safeName(input.name))return;const props=cleanValues(input.properties??{}),data=cleanValues(input.data??{});
      await evaluate({name:input.name,properties:props,data,site:input.site??options.site,pathname:input.pathname,sessionId:input.sessionId,source:'web',requestId:ctx.requestId,requestUtcDay:ctx.utcDay});}
  });
  const endpoint=options.publicOrigin?new URL(prefix+'/collect',options.publicOrigin).href:prefix+'/collect';
  const scriptHandler=async(_request:Request)=>{
    let activeTypes:string[]=[];
    try{const container=publishedContainer(await store.load());activeTypes=[...new Set(container.triggers.filter(t=>t.enabled!==false).map(t=>t.type))];}catch{}
    const js=browserScript({endpoint,site:options.site??'',debug:options.debug===true,autoEvents:activeTypes,defaultConsent:options.defaultConsent??'granted'});
    return new Response(js,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'cross-origin'}});
  };
  const authorized=async(request:Request)=>{
    if(options.dashboardHost&&new URL(request.url).host!==options.dashboardHost)return false;
    if(!options.authorizeAdmin)return false;
    try{return await options.authorizeAdmin(request)===true;}catch{return false;}
  };
  const canPublish=async(request:Request)=>{if(!await authorized(request)||!options.authorizePublish)return false;
    try{return await options.authorizePublish(request)===true;}catch{return false;}};
  const sameOrigin=(request:Request)=>request.headers.get('origin')===new URL(request.url).origin;
  const readBody=async(request:Request,limit=8192)=>{const body=await request.text();if(Buffer.byteLength(body)>limit)throw new RangeError('Body too large');return JSON.parse(body) as unknown;};
  const admin=async(request:Request):Promise<Response>=>{
    if(!await authorized(request))return new Response('Not found',{status:404});
    const html=dashboard(prefix),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const scriptHashes=scripts.map(match=>`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ');
    return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':`default-src 'none'; script-src ${scriptHashes}; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'}});
  };
  const preview=async(request:Request):Promise<Response>=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!sameOrigin(request))return json({error:'Origin required'},403);
    try{
      const input=await readBody(request) as {name:string;properties?:Values;data?:Values;mode?:'draft'|'published'};
      if(input.mode!==undefined&&!['draft','published'].includes(input.mode))return json({error:'Invalid mode'},422);
      if(!safeName(input.name))return json({error:'Invalid event name'},422);
      const ev:TagEvent={name:input.name,properties:cleanValues(input.properties??{}),data:cleanValues(input.data??{}),source:'web',requestId:'PREVIEWONLY00000',requestUtcDay:requestUtcDay()};
      const loaded=validateContainer(await store.load());
      const container=input.mode==='published'?publishedContainer(loaded):loaded;
      const matched=container.triggers.filter(t=>t.enabled!==false&&triggerMatches(t.type,ev.name,t.event)&&(t.conditions??[]).every(c=>matchesCondition(c,ev,container)));
      const ids=new Set(matched.map(t=>t.id));
      return json({dryRun:true,mode:input.mode??'draft',event:ev.name,matchedTriggers:[...ids],candidateTags:container.tags.filter(t=>t.enabled!==false&&t.triggerIds.some(id=>ids.has(id))).map(t=>({id:t.id,type:t.type}))});
    }catch{return json({error:'Invalid preview'},422);}
  };
  const api=async(request:Request):Promise<Response>=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method==='GET')return json(await store.load());
    if(request.method!=='PUT')return json({error:'Method not allowed'},405);
    if(!sameOrigin(request))return json({error:'Origin required'},403);
    try{
      const parsed=validateContainer(await readBody(request,128*1024));const previous=parsed.version-1;
      if(!await saveTagDraft(store,parsed,previous))return json({error:'Version conflict'},409);
      return json({ok:true,version:parsed.version,mode:'draft'});
    }catch{return json({error:'Invalid container'},422);}
  };
  const status=async(request:Request)=>{
    if(!await authorized(request))return json({error:'Forbidden'},403);
    if(request.method!=='GET')return json({error:'Method not allowed'},405);
    return json(releaseSummary(await store.load()));
  };
  const transition=async(request:Request,action:'publish'|'rollback')=>{
    if(!await canPublish(request))return json({error:'Forbidden'},403);
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!sameOrigin(request))return json({error:'Origin required'},403);
    try{
      const payload=await readBody(request) as {expectedVersion?:number;releaseId?:number};
      if(!payload||!Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion!<1||
        action==='rollback'&&(!Number.isSafeInteger(payload.releaseId)||payload.releaseId!<1))return json({error:'Invalid transition'},422);
      if(action==='publish'){const candidate=validateContainer(await store.load());if(candidate.version!==payload.expectedVersion)return json({error:'Version conflict'},409);
        if(candidate.tags.some(tag=>tag.enabled!==false&&(tag.type==='ga4'&&!options.credentials?.[tag.credentialRef??'']?.secret||
          tag.type==='webhook'&&!configuredDestinations[tag.destinationRef??''])))return json({error:'Unconfigured destination'},422);}
      const success=action==='publish'?await publishTagDraft(store,payload.expectedVersion!):
        await rollbackTagRelease(store,payload.expectedVersion!,payload.releaseId!);
      if(!success)return json({error:'Version conflict'},409);
      return json({ok:true,...releaseSummary(await store.load())});
    }catch(error){return json({error:error instanceof RangeError?'Release unavailable':'Invalid transition'},422);}
  };
  return {
    createAstag,evaluate,container:()=>store.load(),published:async()=>publishedContainer(await store.load()),store,
    routes(){return [{pattern:collector.path,handler:collector.handler},{pattern:`${prefix}/ttag.js`,handler:scriptHandler},...(options.authorizeAdmin?[{pattern:`${prefix}/admin`,handler:admin},{pattern:`${prefix}/admin/api`,handler:api},{pattern:`${prefix}/admin/preview`,handler:preview},{pattern:`${prefix}/admin/status`,handler:status},{pattern:`${prefix}/admin/publish`,handler:(request:Request)=>transition(request,'publish')},{pattern:`${prefix}/admin/rollback`,handler:(request:Request)=>transition(request,'rollback')}]:[])];}
  };
}
