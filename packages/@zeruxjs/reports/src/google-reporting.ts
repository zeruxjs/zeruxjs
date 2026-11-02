import {ReportSourceError,sourceScope,type ReportSourceScope} from './sources.js';
export const GA4_READONLY_SCOPE='https://www.googleapis.com/auth/analytics.readonly';
export const ADSENSE_READONLY_SCOPE='https://www.googleapis.com/auth/adsense.readonly';
export interface GoogleReportCredentials {getAccessToken(context:{scope:string;signal:AbortSignal}):Promise<{accessToken:string;expiresAt:number;scopes:readonly string[]}>}
export interface GoogleReportOptions {binding:ReportSourceScope;credentials:GoogleReportCredentials;fetch?:typeof fetch;maxAttempts?:number}
export function providerFailure(code:ReportSourceError['code'],cause?:unknown):never {throw new ReportSourceError(code,cause);}
export async function boundedJson(response:Response,signal:AbortSignal,max=1024*1024):Promise<any>{
 if(!response.body)providerFailure('INVALID_RESULT');const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)providerFailure('CANCELLED');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)providerFailure('INVALID_RESULT');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}catch(error){if(error instanceof ReportSourceError)throw error;providerFailure('INVALID_RESULT',error);}finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function sleep(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve();};const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new ReportSourceError('CANCELLED'));};const timer=setTimeout(finish,ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
/** Fixed Google reporting hosts, bounded retries, and no background credential refresh. */
export function googleReporting(options:GoogleReportOptions,scope:string){
 const binding=sourceScope(options?.binding);if(typeof options.credentials?.getAccessToken!=='function'||options.fetch!==undefined&&typeof options.fetch!=='function')providerFailure('INVALID_QUERY');
 const attempts=options.maxAttempts??2;if(!Number.isSafeInteger(attempts)||attempts<1||attempts>3)providerFailure('INVALID_QUERY');
 const fetcher=options.fetch??globalThis.fetch;let closed=false;const active=new Set<AbortController>(),jobs=new Set<Promise<unknown>>();
 return {
  request(url:string,init:RequestInit,context:{scope:Readonly<ReportSourceScope>;signal:AbortSignal}):Promise<any>{
   if(closed)providerFailure('CLOSED');if(Object.keys(binding).some(k=>binding[k as keyof ReportSourceScope]!==context.scope[k as keyof ReportSourceScope]))providerFailure('DENIED');if(active.size>=4)providerFailure('OVERLOAD');
   const controller=new AbortController(),abort=()=>controller.abort();context.signal.addEventListener('abort',abort,{once:true});if(context.signal.aborted)abort();active.add(controller);const timer=setTimeout(abort,30000);
   const job=(async()=>{try{
    if(controller.signal.aborted)providerFailure('CANCELLED');const token=await options.credentials.getAccessToken({scope,signal:controller.signal});
    if(controller.signal.aborted)providerFailure('CANCELLED');if(!token||typeof token.accessToken!=='string'||!token.accessToken.length||token.accessToken.length>8192||/[\x00-\x20\x7f]/.test(token.accessToken)||!Number.isSafeInteger(token.expiresAt)||token.expiresAt<=Date.now()||!Array.isArray(token.scopes)||!token.scopes.includes(scope))providerFailure('DENIED');
    for(let attempt=0;attempt<attempts;attempt++){
     if(controller.signal.aborted)providerFailure('CANCELLED');if(token.expiresAt<=Date.now())providerFailure('DENIED');
     let response:Response;try{response=await fetcher(url,{...init,headers:{...init.headers,authorization:`Bearer ${token.accessToken}`},redirect:'error',signal:controller.signal});}catch(error){providerFailure(controller.signal.aborted?'CANCELLED':'UNAVAILABLE',error);}
     if(controller.signal.aborted){await response.body?.cancel().catch(()=>{});providerFailure('CANCELLED');}if(response.ok)return await boundedJson(response,controller.signal);
     const status=response.status,retryAfter=response.headers.get('retry-after');let errorBody:any;try{errorBody=await boundedJson(response,controller.signal,16384);}catch(error){if(controller.signal.aborted)providerFailure('CANCELLED');}
     const quota=status===429||status===403&&(errorBody?.error?.status==='RESOURCE_EXHAUSTED'||Array.isArray(errorBody?.error?.errors)&&errorBody.error.errors.some((e:any)=>['quotaExceeded','rateLimitExceeded','dailyLimitExceeded','userRateLimitExceeded'].includes(e?.reason)));if(status===401||status===403&&!quota)providerFailure('DENIED');
     if((quota||[500,502,503,504].includes(status))&&attempt+1<attempts){let wait=100*2**attempt;if(retryAfter!==null){if(!/^\d{1,5}$/.test(retryAfter)||Number(retryAfter)>2)providerFailure(quota?'QUOTA':'UNAVAILABLE');wait=Math.max(wait,Number(retryAfter)*1000);}await sleep(wait,controller.signal);continue;}providerFailure(quota?'QUOTA':'UNAVAILABLE');
    }providerFailure('UNAVAILABLE');
   }catch(error){if(error instanceof ReportSourceError)throw error;providerFailure(controller.signal.aborted?'CANCELLED':'UNAVAILABLE',error);}})().finally(()=>{clearTimeout(timer);active.delete(controller);jobs.delete(job);context.signal.removeEventListener('abort',abort);});jobs.add(job);return job;
  },
  async dispose(){closed=true;for(const c of active)c.abort();await Promise.allSettled([...jobs]);},
 };
}
/** Official OAuth refresh exchange; host owns original consent/state/code flow and durable grant storage. */
export function createGoogleReportCredentials(input:{clientId:string;clientSecret:string;refreshToken:string;scope:typeof GA4_READONLY_SCOPE|typeof ADSENSE_READONLY_SCOPE;fetch?:typeof fetch}):GoogleReportCredentials&{dispose():Promise<void>}{
 if(!input||![GA4_READONLY_SCOPE,ADSENSE_READONLY_SCOPE].includes(input.scope)||!['clientId','clientSecret','refreshToken'].every(k=>typeof input[k as 'clientId']==='string'&&input[k as 'clientId'].length>0&&input[k as 'clientId'].length<8192&&!/[\r\n\0]/.test(input[k as 'clientId'])))providerFailure('INVALID_QUERY');
 const scope=input.scope,fetcher=input.fetch??globalThis.fetch;let secrets={clientId:input.clientId,clientSecret:input.clientSecret,refreshToken:input.refreshToken},closed=false;const active=new Set<AbortController>(),jobs=new Set<Promise<unknown>>();
 return {
  getAccessToken(context){if(closed)providerFailure('CLOSED');if(context.scope!==scope)providerFailure('DENIED');if(active.size>=4)providerFailure('OVERLOAD');
   const c=new AbortController(),abort=()=>c.abort();context.signal.addEventListener('abort',abort,{once:true});if(context.signal.aborted)abort();active.add(c);const timer=setTimeout(abort,10000);
   const job=(async()=>{try{if(c.signal.aborted)providerFailure('CANCELLED');const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:secrets.clientId,client_secret:secrets.clientSecret,refresh_token:secrets.refreshToken,grant_type:'refresh_token'}),redirect:'error',signal:c.signal});
    if(!response.ok){await response.body?.cancel().catch(()=>{});providerFailure('UNAVAILABLE');}const value=await boundedJson(response,c.signal,16384);if(c.signal.aborted)providerFailure('CANCELLED');
    if(value.token_type!=='Bearer'||typeof value.access_token!=='string'||!Number.isSafeInteger(value.expires_in)||value.expires_in<1||value.expires_in>86400||value.scope!==undefined&&(typeof value.scope!=='string'||!value.scope.split(' ').includes(scope)))providerFailure('DENIED');return {accessToken:value.access_token,expiresAt:Date.now()+value.expires_in*1000,scopes:[scope]};
   }catch(error){if(error instanceof ReportSourceError)throw error;providerFailure(c.signal.aborted?'CANCELLED':'UNAVAILABLE',error);}})().finally(()=>{clearTimeout(timer);context.signal.removeEventListener('abort',abort);active.delete(c);jobs.delete(job);});jobs.add(job);return job;
  },
  async dispose(){closed=true;for(const c of active)c.abort();await Promise.allSettled([...jobs]);secrets={clientId:'',clientSecret:'',refreshToken:''};},
 };
}
