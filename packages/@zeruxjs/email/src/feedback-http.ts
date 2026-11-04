import type {createSenderFeedbackService,SenderFeedbackInput} from './sender-feedback.js';
import {validateEmailAddress} from './validation.js';
import type {MarketingFeedback,createMarketingSuppressionService} from './suppression.js';
/** Provider-authenticated mail transport notification; not recipient-suppression input. */
export interface ProviderDeliveryNotification {eventId:string;kind:'delivered'|'deferred';at?:number}
export type VerifiedEmailNotification=MarketingFeedback|ProviderDeliveryNotification;
export interface MarketingFeedbackHttpOptions {
  /** Provider-specific signature verification with replay-window checks is a host responsibility. */
  verifySignature:(body:Uint8Array,headers:Headers)=>Promise<boolean>|boolean;
  parse:(body:Uint8Array,headers:Headers)=>Promise<VerifiedEmailNotification[]>|VerifiedEmailNotification[];
  suppression:ReturnType<typeof createMarketingSuppressionService>;
  reputation?:{recordFeedback(input:{account:string;email:string;eventId:string;kind:'hard-bounce'|'soft-bounce'|'complaint';at?:number}):Promise<unknown>};
  /** Account attribution MUST be derived from trusted provider metadata. */
  feedbackAccount?:(event:MarketingFeedback)=>string;
  providerOutcomes?:{record(event:{eventId:string;provider:string;campaignId:string;messageId:string;kind:'hard-bounce'|'soft-bounce'|'complaint'|'delivered'|'deferred';occurredAt:number}):Promise<boolean>};
  feedbackDelivery?:(event:VerifiedEmailNotification)=>{provider:string;campaignId:string;messageId:string;occurredAt:number};
  /** Required for correlated feedback; verifier must authenticate this timestamp with the raw body. */
  signatureTime?:(headers:Headers)=>number;maxSignatureAgeMs?:number;now?:()=>number;
  correlatedFeedback?:{service:ReturnType<typeof createSenderFeedbackService>;normalize:(event:VerifiedEmailNotification)=>SenderFeedbackInput};
  path?:string;maxBodyBytes?:number;timeoutMs?:number;
  /** Permits bounded signed event batches. Defaults to 100. */
  maxEvents?:number;
}
const responseHeaders={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const eventId=/^[A-Za-z0-9:_./-]{1,160}$/;
const trustedAccount=/^[a-z][a-z0-9_-]{0,63}$/;
const trustedRef=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const kinds=new Set(['hard-bounce','soft-bounce','complaint','delivered','deferred']);
/** Fail-closed signed provider endpoint. Invalid batches cause ZERO changes. */
export function createMarketingFeedbackEndpoint(config:MarketingFeedbackHttpOptions){
  if(!config||typeof config.verifySignature!=='function'||typeof config.parse!=='function'||typeof config.suppression?.recordFeedback!=='function'||
    (config.reputation&&typeof config.feedbackAccount!=='function')||Boolean(config.providerOutcomes)!==Boolean(config.feedbackDelivery)||
    (config.providerOutcomes&&typeof config.feedbackDelivery!=='function'))throw new TypeError('Authenticated provider feedback callbacks required');
  if(config.correlatedFeedback&&(typeof config.signatureTime!=='function'||typeof config.correlatedFeedback.normalize!=='function'||typeof config.correlatedFeedback.service?.validateFeedback!=='function'||typeof config.correlatedFeedback.service.recordFeedback!=='function'))throw new TypeError('Correlated feedback requires signed freshness and normalization');
  if(config.signatureTime!==undefined&&typeof config.signatureTime!=='function'||config.maxSignatureAgeMs!==undefined&&!config.signatureTime||config.now!==undefined&&typeof config.now!=='function')throw new TypeError('Invalid feedback clock');
  const clock=config.now??Date.now,signatureAge=config.maxSignatureAgeMs??300000;if(!Number.isSafeInteger(signatureAge)||signatureAge<1||signatureAge>600000)throw new RangeError('Invalid signature replay window');
  const path=config.path??'/_email/feedback';
  if(!/^\/[A-Za-z0-9/_-]{2,120}$/.test(path)||path.includes('//')||path.endsWith('/')||path.includes('..'))throw new TypeError('Invalid provider feedback path');
  const maxBytes=config.maxBodyBytes??65_536,timeout=config.timeoutMs??5000,maxEvents=config.maxEvents??100;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>262_144||!Number.isSafeInteger(timeout)||timeout<100||timeout>30_000||
    !Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>1000)throw new RangeError('Invalid feedback request limit');
  const response=(status:number)=>new Response(null,{status,headers:responseHeaders});
  async function handle(request:Request):Promise<Response>{
    if(request.method!=='POST')return new Response(null,{status:405,headers:{...responseHeaders,allow:'POST'}});
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))return response(413);
    if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))return response(415);
    const reader=request.body?.getReader();if(!reader)return response(400);
    let timedOut=false,oversize=false;const parts:Buffer[]=[];let bytes=0;
    const abort=()=>{void reader.cancel().catch(()=>{});};request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
    const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},timeout);timer.unref?.();
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
        if(bytes>maxBytes){oversize=true;await reader.cancel().catch(()=>{});break;}parts.push(Buffer.from(value));}
    }catch{return response(timedOut?408:400);}finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.releaseLock();}
    if(timedOut||request.signal.aborted)return response(408);if(oversize)return response(413);
    const raw=Buffer.concat(parts);
    if(config.signatureTime){try{const signedAt=config.signatureTime(request.headers),now=clock();if(!Number.isSafeInteger(now)||!Number.isSafeInteger(signedAt)||signedAt<0||signedAt>now+60000||now-signedAt>signatureAge)return response(401);}catch{return response(401);}}
    let verified=false;
    try{verified=await config.verifySignature(raw,request.headers)===true;}catch{return response(401);}
    if(!verified)return response(401);
    let events:VerifiedEmailNotification[];
    try{events=await config.parse(raw,request.headers);}catch{return response(400);}
    if(!Array.isArray(events)||events.length>maxEvents||events.some(e=>!e||typeof e!=='object'))return response(400);
    type Ready={event:VerifiedEmailNotification;kind:'hard-bounce'|'soft-bounce'|'complaint'|'delivered'|'deferred';account?:string;outcome?:{eventId:string;provider:string;campaignId:string;messageId:string;kind:'hard-bounce'|'soft-bounce'|'complaint'|'delivered'|'deferred';occurredAt:number}};
    const prepared:Ready[]=[];const correlated=new Map<Ready,SenderFeedbackInput>();
    const batchIds=new Map<string,string>();
    // Resolve/validate ALL signed provider events before any suppression or reputation writes.
    // This does not provide multi-store atomicity; retries must be idempotent across stores.
    for(const event of events){
      if(typeof event.kind!=='string'||!kinds.has(event.kind)||typeof event.eventId!=='string'||!eventId.test(event.eventId))return response(400);
      const kind=event.kind as Ready['kind'];
      let normalized:SenderFeedbackInput|undefined;
      if(config.correlatedFeedback){try{normalized=config.correlatedFeedback.normalize(event);if(normalized.eventId!==event.eventId||normalized.kind!==kind||event.at!==undefined&&normalized.at!==event.at)return response(400);config.correlatedFeedback.service.validateFeedback(normalized);normalized={...normalized,email:typeof normalized.email==='string'?normalized.email:{...normalized.email}};}catch{return response(400);}}
      // Duplicate records in a signed batch are harmless only when their identity and meaning agree.
      const identity=JSON.stringify([kind,('email' in event?event.email:null),event.at??null,normalized??null]);
      const previous=batchIds.get(event.eventId);
      if(previous!==undefined){if(previous!==identity)return response(400);continue;}
      batchIds.set(event.eventId,identity);
      if(event.at!==undefined&&(!Number.isSafeInteger(event.at)||event.at<0||event.at>clock()+300_000))return response(400);
      const delivery=kind==='delivered'||kind==='deferred';
      if(delivery&&!config.providerOutcomes)return response(503);
      if(!delivery){try{validateEmailAddress((event as MarketingFeedback).email);}catch{return response(400);}}
      let account:string|undefined;
      if(config.reputation&&!delivery){
        try{account=config.feedbackAccount!(event as MarketingFeedback);}catch{return response(503);}
        if(typeof account!=='string'||!trustedAccount.test(account))return response(400);
      }
      let outcome:Ready['outcome'];
      if(config.providerOutcomes){
        let ref:ReturnType<NonNullable<MarketingFeedbackHttpOptions['feedbackDelivery']>>;
        try{ref=config.feedbackDelivery!(event);}catch{return response(503);}
        if(!ref||typeof ref!=='object'||![ref.provider,ref.campaignId,ref.messageId].every(x=>typeof x==='string'&&trustedRef.test(x))||
          !Number.isSafeInteger(ref.occurredAt)||ref.occurredAt<0||ref.occurredAt>clock()+300_000)return response(400);
        outcome={...ref,eventId:event.eventId,kind};
      }
      const ready:Ready={event,kind,account,outcome};
      if(normalized)correlated.set(ready,normalized);
      prepared.push(ready);
    }
    for(const ready of prepared){
      try{
        if(request.signal.aborted)return response(408);
        if(correlated.has(ready))await config.correlatedFeedback!.service.recordFeedback(correlated.get(ready)!);
        if(ready.kind!=='delivered'&&ready.kind!=='deferred'){
          await config.suppression.recordFeedback(ready.event as MarketingFeedback);
          if(config.reputation)await config.reputation.recordFeedback({account:ready.account!,email:(ready.event as MarketingFeedback).email,
            eventId:ready.event.eventId,kind:ready.kind,at:ready.event.at});
        }
        if(ready.outcome)await config.providerOutcomes!.record(ready.outcome);
      }catch{return response(503);}
    }
    return response(204);
  }
  return {path,handle,routes:()=>[{pattern:path,handler:handle}]};
}
