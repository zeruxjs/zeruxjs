import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {fail,fields,number,type WebhookTransport,type WebhookResponse} from './contracts.js';
const denied=new BlockList();for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)denied.addSubnet(ip,prefix,'ipv4');
/** Deliberately IPv4-only. IPv6/mapped/transition addresses fail closed. */
export function isWebhookAddressAllowed(address:string):boolean{return isIP(address)===4&&!denied.check(address,'ipv4');}
export function webhookURL(value:string,origins:readonly string[]):URL{
 if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f]/.test(value))throw fail('DESTINATION_DENIED');let target:URL;try{target=new URL(value);}catch{throw fail('DESTINATION_DENIED');}
 if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||!origins.includes(target.origin)||target.hostname.includes(':')||isIP(target.hostname)&&!isWebhookAddressAllowed(target.hostname))throw fail('DESTINATION_DENIED');return target;
}
export interface WebhookHttpsOptions {allowedOrigins:readonly string[];maxPending?:number;maxResponseBytes?:number;
 /** Trusted resolver hook for tests/deployment DNS. Every returned address is still validated. */
 resolve?:(host:string)=>Promise<readonly string[]>;
 /** Required host egress approval, in addition to built-in special-address denial. */
 approveAddress:(host:string,address:string)=>boolean;
 request?:typeof request;
}
export function createWebhookHttpsTransport(options:WebhookHttpsOptions){
 fields(options,['allowedOrigins','maxPending','maxResponseBytes','resolve','approveAddress','request']);if(!Array.isArray(options.allowedOrigins)||!options.allowedOrigins.length||options.allowedOrigins.length>32||typeof options.approveAddress!=='function'||options.resolve!==undefined&&typeof options.resolve!=='function')throw fail('INVALID_TRANSPORT');
 const origins=options.allowedOrigins.map(origin=>{let parsed:URL;try{parsed=new URL(origin);}catch{throw fail('INVALID_TRANSPORT');}if(parsed.origin!==origin||parsed.protocol!=='https:')throw fail('INVALID_TRANSPORT');return origin;}),approve=options.approveAddress,resolve=options.resolve??(async(host:string)=>(await lookup(host,{all:true,family:4,verbatim:true})).map(item=>item.address));
 if(options.request!==undefined&&typeof options.request!=='function')throw fail('INVALID_TRANSPORT');const nativeRequest=options.request??request;
 const max=number(options.maxPending??16,1,128),responseLimit=number(options.maxResponseBytes??8192,0,65536);let closed=false;
 const active=new Set<Promise<unknown>>(),controllers=new Set<AbortController>();
 const transport:WebhookTransport&{close():Promise<void>;status():{pending:number;closed:boolean}}={contract:'webhook-https-v1',validate(url){webhookURL(url,origins);},
  async send(input){fields(input,['url','body','headers','signal','timeoutMs']);fields(input.headers,['x-zerux-webhook-id','x-zerux-webhook-timestamp','x-zerux-webhook-signature','x-zerux-webhook-schema']);if(Object.values(input.headers).some(value=>typeof value!=='string'||value.length>256||/[\x00-\x1f\x7f]/.test(value)))throw fail('NOT_SENT');if(closed||active.size>=max)throw fail(closed?'TRANSPORT_CLOSED':'TRANSPORT_OVERLOAD');const target=webhookURL(input.url,origins);number(input.timeoutMs,1,30000);if(!(input.signal instanceof AbortSignal)||typeof input.body!=='string'||Buffer.byteLength(input.body)>65536||input.signal.aborted)throw fail('NOT_SENT');
   if(isIP(target.hostname)&&approve(target.hostname,target.hostname)!==true)throw fail('ADDRESS_DENIED');
   const controller=new AbortController(),abort=()=>controller.abort();controllers.add(controller);input.signal.addEventListener('abort',abort,{once:true});
   const nativeLookups:Promise<unknown>[]=[];
   const job=new Promise<WebhookResponse>((resolveResponse,reject)=>{
    let secured=false,ended=false,answer:WebhookResponse|undefined,error:Error|undefined;const timer=setTimeout(()=>controller.abort(),input.timeoutMs);
    let req:ReturnType<typeof request>;try{req=nativeRequest(target,{method:'POST',agent:false,rejectUnauthorized:true,family:4,signal:controller.signal,headers:{...input.headers,'content-type':'application/json','content-length':Buffer.byteLength(input.body)},maxHeaderSize:8192,
     lookup:((host:string,_settings:unknown,callback:(error:Error|null,address?:string,family?:number)=>void)=>{const pending=Promise.resolve().then(()=>resolve(host)).then(addresses=>{if(!Array.isArray(addresses)||!addresses.length||addresses.length>32)throw fail('ADDRESS_DENIED');const approved=[...addresses];if(approved.some(address=>!isWebhookAddressAllowed(address)||approve(host,address)!==true))throw fail('ADDRESS_DENIED');if(controller.signal.aborted)throw fail('NOT_SENT');callback(null,approved[0],4);},cause=>{throw fail('DNS_FAILED',cause);}).catch(cause=>callback(cause));nativeLookups.push(pending);}) as any},response=>{
      let bytes=0;answer={status:response.statusCode??0,...(typeof response.headers['retry-after']==='string'?{retryAfter:response.headers['retry-after'].slice(0,128)}:{})};
      if(answer.status>=300&&answer.status<400){response.destroy();return;}
      response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>responseLimit){error=fail('OUTCOME_UNKNOWN');response.destroy();req.destroy();}});response.on('aborted',()=>{if(!error)error=fail('OUTCOME_UNKNOWN');});response.on('error',()=>{error=fail('OUTCOME_UNKNOWN');});response.on('end',()=>{ended=true;});
     });}catch(cause){clearTimeout(timer);reject(fail('NOT_SENT',cause));return;}
    req.on('socket',socket=>{socket.once('secureConnect',()=>{secured=true;});});
    req.on('error',cause=>{error=cause instanceof Error&&'code' in cause&&cause.code==='ADDRESS_DENIED'?cause:fail(secured?'OUTCOME_UNKNOWN':'NOT_SENT',cause);});
    req.on('close',()=>{clearTimeout(timer);if(answer&&answer.status>=300&&answer.status<400)resolveResponse(answer);else if(error)reject(error);else if(answer&&ended&&answer.status>=100&&answer.status<=599)resolveResponse(answer);else reject(fail(secured?'OUTCOME_UNKNOWN':'NOT_SENT'));});try{req.end(input.body);}catch(cause){error=fail(secured?'OUTCOME_UNKNOWN':'NOT_SENT',cause);req.destroy();}
   }).finally(async()=>{await Promise.allSettled(nativeLookups);controllers.delete(controller);input.signal.removeEventListener('abort',abort);});
   active.add(job);try{return await job;}finally{active.delete(job);}
  },async close(){closed=true;for(const controller of controllers)controller.abort();await Promise.allSettled([...active]);},status(){return {pending:active.size,closed};}
 };return transport;
}
