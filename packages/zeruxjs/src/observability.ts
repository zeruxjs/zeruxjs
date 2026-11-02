import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestCorrelation { readonly applicationId:string; readonly generationId:string; readonly requestId:string; readonly traceId:string; readonly spanId:string; readonly parentSpanId?:string; readonly sampled:boolean }
export interface RequestSpan extends RequestCorrelation { readonly startedAt:number; readonly durationMs:number; readonly status:number; readonly outcome:'completed'|'disconnected'|'error' }
/** Adapter owns its exporter. Callbacks must not block; async export/shutdown receive cancellation. */
export interface TracingAdapter {
  start?(context:Readonly<RequestCorrelation>):void;
  end?(span:Readonly<RequestSpan>):void;
  export(span:Readonly<RequestSpan>,signal:AbortSignal):void|Promise<void>;
  shutdown?(signal:AbortSignal):void|Promise<void>;
}
export interface ObservabilityOptions {
  applicationId?:string; generationId?:string; adapter?:TracingAdapter;
  /** Fresh generation-owned adapter for reloadable hosts. Mutually exclusive with adapter. */
  createAdapter?:()=>TracingAdapter;
  sampleRate?:number; maxQueue?:number; exportTimeoutMs?:number; shutdownTimeoutMs?:number;
  /** Explicit trust boundary; syntactically valid remote parents are otherwise ignored. */
  trustTraceParent?:boolean;
  /** Trusted private sink receives raw causes. Never serialize these into public output. */
  onError?:(error:unknown,context:Readonly<RequestCorrelation>|undefined)=>void;
}
const contextStorage=new AsyncLocalStorage<Readonly<RequestCorrelation>>();
export const getRequestCorrelation=()=>contextStorage.getStore();
const id=(bytes:number)=>randomBytes(bytes).toString('hex');
/** Strict version-00 traceparent subset; no baggage/tracestate or future versions are forwarded. */
export function parseTraceParent(value:unknown):{traceId:string;parentSpanId:string}|undefined {
  if(typeof value!=='string'||!/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(value))return;
  const [,traceId,parentSpanId]=value.split('-');if(/^0+$/.test(traceId)||/^0+$/.test(parentSpanId))return;
  return {traceId,parentSpanId};
}
export function validateObservability(options:ObservabilityOptions={}):void {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Invalid observability options');
  const allowed=['applicationId','generationId','adapter','createAdapter','sampleRate','maxQueue','exportTimeoutMs','shutdownTimeoutMs','trustTraceParent','onError'];
  if(Object.keys(options).some(key=>!allowed.includes(key)))throw new TypeError('Unknown observability option');
  for(const value of [options.applicationId,options.generationId])if(value!==undefined&&(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(value)))throw new TypeError('Invalid correlation ID');
  if(options.sampleRate!==undefined&&(typeof options.sampleRate!=='number'||!Number.isFinite(options.sampleRate)||options.sampleRate<0||options.sampleRate>1))throw new TypeError('Invalid sampling rate');
  for(const [key,max] of [['maxQueue',4096],['exportTimeoutMs',60000],['shutdownTimeoutMs',60000]] as const)if(options[key]!==undefined&&(!Number.isSafeInteger(options[key])||options[key]! < 1||options[key]! > max))throw new TypeError('Invalid telemetry budget');
  if(options.trustTraceParent!==undefined&&typeof options.trustTraceParent!=='boolean')throw new TypeError('Invalid propagation policy');
  if(options.onError!==undefined&&typeof options.onError!=='function')throw new TypeError('Invalid private error sink');
  if(options.createAdapter!==undefined&&(typeof options.createAdapter!=='function'||options.adapter!==undefined))throw new TypeError('Invalid adapter ownership');
  if(options.adapter!==undefined){if(!options.adapter||typeof options.adapter.export!=='function')throw new TypeError('Invalid tracing adapter');for(const key of ['start','end','shutdown'] as const)if(options.adapter[key]!==undefined&&typeof options.adapter[key]!=='function')throw new TypeError('Invalid tracing callback');}
}
/** Application-owned, bounded, single-exporter queue; no work occurs on module import. */
export function createRequestObserver(options:ObservabilityOptions={}) {
  validateObservability(options);
  const applicationId=options.applicationId??id(12),generationId=options.generationId??id(12);
  const adapter=options.createAdapter?options.createAdapter():options.adapter;
  if(options.createAdapter&&!adapter)throw new TypeError('Invalid tracing adapter factory result');
  if(adapter)validateObservability({adapter});
  const max=options.maxQueue??128,queue:RequestSpan[]=[];
  const controller=new AbortController();let running:Promise<void>|undefined,closed=false,closing:Promise<void>|undefined;
  let dropped=0,failures=0,exported=0,exportTimeouts=0;const active=new Set<()=>void>();
  const report=(error:unknown,context=getRequestCorrelation())=>{try{Promise.resolve(options.onError?.(error,context)).catch(()=>{failures++;});}catch{failures++;}};
  const invoke=(callback:(()=>void)|undefined)=>{try{Promise.resolve(callback?.()).catch(()=>{failures++;});}catch{failures++;}};
  const pump=()=>{
    if(running||closed||!queue.length||!adapter)return;
    running=(async()=>{while(queue.length&&!closed){const span=queue.shift()!;
      const timeout=new AbortController();
      const timer=setTimeout(()=>{exportTimeouts++;timeout.abort();},options.exportTimeoutMs??5000);
      timer.unref?.();
      const signal=AbortSignal.any([controller.signal,timeout.signal]);
      // Do not launch another exporter if this exporter ignores cancellation.
      try{await adapter.export(span,signal);exported++;}catch{failures++;}finally{clearTimeout(timer);}
    }})().finally(()=>{running=undefined;if(!closed)pump();});
  };
  return {
    applicationId,generationId,report,
    status:()=>({applicationId,generationId,active:active.size,queued:queue.length,exported,dropped,failures,exportTimeouts,closed}),
    wrap(handler:(req:IncomingMessage,res:ServerResponse)=>Promise<void>|void){return (req:IncomingMessage,res:ServerResponse)=>{
      const parent=options.trustTraceParent?parseTraceParent(req.headers.traceparent):undefined;
      const sampled=!!adapter&&!closed&&randomBytes(4).readUInt32BE()/0x100000000<(options.sampleRate??1);
      const context:Readonly<RequestCorrelation>=Object.freeze({applicationId,generationId,requestId:id(16),traceId:parent?.traceId??id(16),spanId:id(8),...(parent?{parentSpanId:parent.parentSpanId}:{}),sampled});
      if(!res.headersSent)res.setHeader('x-request-id',context.requestId);
      const startedAt=Date.now(),begin=performance.now();let ended=false,failed=false;
      // Bound span ownership too; saturation drops telemetry, never application requests.
      const tracked=sampled&&active.size<max;
      if(sampled&&!tracked)dropped++;
      const finish=()=>{
        if(ended)return;ended=true;res.off('finish',finish);res.off('close',finish);active.delete(finish);
        if(!tracked)return;
        const span:RequestSpan=Object.freeze({...context,startedAt,durationMs:Math.max(0,performance.now()-begin),status:res.writableFinished?res.statusCode:499,outcome:failed||res.statusCode>=500?'error':res.writableFinished?'completed':'disconnected'});
        invoke(()=>adapter?.end?.(span));
        if(closed||queue.length+(running?1:0)>=max)dropped++;else{queue.push(span);pump();}
      };
      if(tracked){active.add(finish);invoke(()=>adapter?.start?.(context));res.once('finish',finish);res.once('close',finish);}
      return contextStorage.run(context,async()=>{try{await handler(req,res);}catch(error){failed=true;report(error,context);finish();throw error;}});
    };},
    close(){return closing??=(async()=>{
      closed=true;for(const finish of [...active])finish();dropped+=queue.length;queue.length=0;controller.abort();
      const shutdown=new AbortController();
      let timer:ReturnType<typeof setTimeout>|undefined;
      const deadline=new Promise<void>(resolve=>{timer=setTimeout(()=>{shutdown.abort();resolve();},options.shutdownTimeoutMs??5000);});
      try {
        await Promise.race([
          (async()=>{await Promise.allSettled([running,Promise.resolve().then(()=>adapter?.shutdown?.(shutdown.signal)).catch(()=>{failures++;})]);})(),
          deadline
        ]);
      } finally {if(timer)clearTimeout(timer);}

    })();}
  };
}

export interface HealthSnapshot {live:boolean;ready:boolean}
/** Host mounts these responses explicitly. Diagnostics are denied unless its authorizer returns true. */
export function createHealthHandler(snapshot:()=>HealthSnapshot,options:{diagnostics?:()=>unknown;authorize?:(request:Request)=>boolean|Promise<boolean>}={}) {
  return async(request:Request,kind:'liveness'|'readiness'|'diagnostics'):Promise<Response>=>{
    if(!['liveness','readiness','diagnostics'].includes(kind))return new Response(null,{status:404});
    const headers={'content-type':'application/json','cache-control':'no-store'};
    if(kind==='diagnostics'){
      let allowed=false;try{allowed=await options.authorize?.(request)===true;}catch{/* deny */}
      if(!allowed)return new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'Forbidden'}}),{status:403,headers});
      return new Response(JSON.stringify(options.diagnostics?.()??{}),{headers});
    }
    const health=snapshot(),ok=kind==='liveness'?health.live:health.ready;
    return new Response(JSON.stringify({status:ok?'ok':'unavailable'}),{status:ok?200:503,headers});
  };
}
