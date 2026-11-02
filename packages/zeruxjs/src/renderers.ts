import {ApplicationError} from './exceptions/api-error.js';
import {stream,validateResponseHeaders,type StreamResult} from './response.js';
export type RendererFeature='staticHtml'|'streaming'|'hydration'|'clientOnly';
export interface RendererCapabilities {staticHtml:boolean;streaming:boolean;hydration:boolean;clientOnly:boolean}
export interface RendererContext {readonly requestId:string;readonly pathname:string;readonly feature:RendererFeature;readonly signal:AbortSignal;readonly locals:Map<unknown,unknown>;onDispose(cleanup:()=>void|Promise<void>):void}
export interface RendererRequest {requestId:string;pathname:string;signal:AbortSignal}
export type AdapterRenderResult={kind:'html';html:string;headers?:Record<string,string>}|{kind:'stream';source:AsyncIterable<string|Uint8Array>;headers?:Record<string,string>};
export interface RendererAdapter<V=unknown>{name:string;capabilities:RendererCapabilities;render(view:V,context:RendererContext):AdapterRenderResult|Promise<AdapterRenderResult>;dispose?():void|Promise<void>}
const htmlMarker=Symbol('zerux.renderer.html');
export interface RenderedHtml {readonly [htmlMarker]:true;readonly html:string;readonly headers?:Readonly<Record<string,string>>}
export type RendererResult=RenderedHtml|StreamResult;
export class RendererError extends ApplicationError {constructor(readonly code:string,cause?:unknown,readonly details?:Readonly<{renderer:string;feature:string}>){super(500,cause);this.name='RendererError';}}
export interface RendererRegistration<V>{readonly name:string;/** Remove only before the first dispatch. */dispose():Promise<void>;readonly viewType?:V}
export const isRenderedHtml=(value:unknown):value is RenderedHtml=>!!value&&typeof value==='object'&&htmlMarker in value;
/** Injected server renderers are static HTML only. No browser runtime is registered implicitly. */
export const rendererCapabilityMatrix=Object.freeze({
  zyro:Object.freeze({staticHtml:true,streaming:false,hydration:false,clientOnly:false}),
  react:Object.freeze({staticHtml:true,streaming:false,hydration:false,clientOnly:false}),
  vue:Object.freeze({staticHtml:true,streaming:false,hydration:false,clientOnly:false}),
  'zyro-document':Object.freeze({staticHtml:true,streaming:true,hydration:false,clientOnly:false}),
});
function staticAdapter<V>(name:keyof typeof rendererCapabilityMatrix,renderToString:(view:V)=>string|Promise<string>):RendererAdapter<V>{
  if(typeof renderToString!=='function')throw new RendererError('RENDERER_DEPENDENCY_REQUIRED');
  return {name,capabilities:{...rendererCapabilityMatrix[name]},async render(view,context){context.signal.throwIfAborted();const html=await renderToString(view);context.signal.throwIfAborted();return {kind:'html',html};}};
}
export const createZyroRenderer=<V>(renderToString:(view:V)=>string|Promise<string>)=>staticAdapter('zyro',renderToString);
export const createReactRenderer=<V>(renderToString:(view:V)=>string|Promise<string>)=>staticAdapter('react',renderToString);
export const createVueRenderer=<V>(renderToString:(view:V)=>string|Promise<string>)=>staticAdapter('vue',renderToString);
/** The sole runtime registration authority, owned by one application generation. */
export function createRendererRegistry(options:{maxBytes?:number;maxActive?:number;timeoutMs?:number}={}){
  const maxBytes=options.maxBytes??1048576,maxActive=options.maxActive??32,timeout=options.timeoutMs??30000;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16777216||!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>1024||!Number.isSafeInteger(timeout)||timeout<1||timeout>120000)throw new RendererError('RENDERER_LIMIT_INVALID');
  type Entry={adapter:RendererAdapter<any>;token:RendererRegistration<any>};
  const failures:unknown[]=[];
  const entries=new Map<string,Entry>(),active=new Set<{cancel():void;done:Promise<void>}>();let sealed=false,closed=false,closing:Promise<void>|undefined;
  return {
    register<V>(adapter:RendererAdapter<V>):RendererRegistration<V>{
      if(sealed||closed)throw new RendererError('RENDERER_REGISTRATION_CLOSED');
      if(!adapter||!(/^[a-z][a-z0-9-]{0,63}$/).test(adapter.name)||typeof adapter.render!=='function'||adapter.dispose!==undefined&&typeof adapter.dispose!=='function'||!adapter.capabilities||Object.keys(adapter.capabilities).some(key=>!Object.hasOwn(rendererCapabilityMatrix.zyro,key))||Object.keys(rendererCapabilityMatrix.zyro).some(key=>typeof adapter.capabilities[key as RendererFeature]!=='boolean')||entries.has(adapter.name)||entries.size>=16)throw new RendererError('RENDERER_REGISTRATION_INVALID');
      // No implemented client runtime protocol exists; adapters cannot advertise a fictitious one.
      if(adapter.capabilities.hydration||adapter.capabilities.clientOnly)throw new RendererError('RENDERER_CLIENT_PROTOCOL_UNSUPPORTED');
      const captured={...adapter,capabilities:Object.freeze({...adapter.capabilities}),render:adapter.render.bind(adapter),dispose:adapter.dispose?.bind(adapter)};
      const token=Object.freeze({name:adapter.name,async dispose(){if(sealed||closed)throw new RendererError('RENDERER_REGISTRATION_CLOSED');const entry=entries.get(token.name);if(entry?.token===token){entries.delete(token.name);await captured.dispose?.();}}});entries.set(adapter.name,{adapter:captured,token});return token;
    },
    get(name:string):RendererRegistration<unknown>{const entry=entries.get(name);if(!entry||closed)throw new RendererError('RENDERER_UNKNOWN');return entry.token;},
    capabilities(){return [...entries.values()].map(({adapter})=>({name:adapter.name,...adapter.capabilities}));},
    async render<V>(token:RendererRegistration<V>,view:NoInfer<V>,request:RendererRequest,feature:RendererFeature='staticHtml'):Promise<RendererResult>{
      const entry=entries.get(token?.name);if(closed||!entry||entry.token!==token)throw new RendererError('RENDERER_UNKNOWN_OR_FOREIGN');
      if(!Object.hasOwn(rendererCapabilityMatrix.zyro,feature)||!entry.adapter.capabilities[feature])throw new RendererError('RENDERER_FEATURE_UNSUPPORTED',undefined,Object.freeze({renderer:entry.adapter.name,feature:Object.hasOwn(rendererCapabilityMatrix.zyro,feature)?feature:'unknown'}));
      if(!request||!(request.signal instanceof AbortSignal)||typeof request.requestId!=='string'||request.requestId.length>128||typeof request.pathname!=='string'||request.pathname.length>4096)throw new RendererError('RENDERER_CONTEXT_INVALID');
      if(request.signal.aborted)throw new RendererError('RENDERER_CANCELLED');if(active.size>=maxActive)throw new RendererError('RENDERER_OVERLOAD');sealed=true;
      const controller=new AbortController(),cleanups:(()=>void|Promise<void>)[]=[],locals=new Map();let finish!:()=>void,settled!:()=>void;
      const done=new Promise<void>(resolve=>finish=resolve),workDone=new Promise<void>(resolve=>settled=resolve);let release:Promise<void>|undefined,stopStream:(()=>Promise<unknown>)|undefined;
      const cleanup=()=>release??=(async()=>{controller.abort();await workDone;const errors:unknown[]=[];for(const dispose of cleanups.reverse())try{await dispose();}catch(error){errors.push(error);}locals.clear();request.signal.removeEventListener('abort',cancel);active.delete(lease);finish();if(errors.length){failures.push(...errors.slice(0,Math.max(0,1024-failures.length)));throw new AggregateError(errors,'Renderer cleanup failed');}})();
      const cancel=()=>{controller.abort();if(stopStream)void stopStream().catch(()=>{}).finally(settled);void cleanup().catch(()=>{});};const lease={cancel,done};active.add(lease);request.signal.addEventListener('abort',cancel,{once:true});
      const deadline=Date.now()+timeout,timer=setTimeout(()=>controller.abort(),timeout);
      const context:RendererContext=Object.freeze({requestId:request.requestId,pathname:request.pathname,feature,signal:controller.signal,locals,onDispose(dispose:()=>void|Promise<void>){if(release||typeof dispose!=='function'||cleanups.length>=32)throw new RendererError('RENDERER_CLEANUP_INVALID');cleanups.push(dispose);}});
      try{
        const result=await entry.adapter.render(view,context);if(Date.now()>=deadline)controller.abort();controller.signal.throwIfAborted();
        if(result?.headers)validateResponseHeaders(result.headers);
        if(result?.kind==='html'&&feature==='staticHtml'){
          if(typeof result.html!=='string'||Buffer.byteLength(result.html)>maxBytes)throw new RendererError('RENDERER_RESULT_INVALID');
          settled();return Object.freeze({[htmlMarker]:true as const,html:result.html,headers:result.headers?Object.freeze({...result.headers}):undefined});
        }
        if(result?.kind==='stream'&&feature==='streaming'&&result.source&&typeof result.source[Symbol.asyncIterator]==='function'){
          // The existing response stream owns backpressure and byte limits; iteration owns teardown.
          const iterator=result.source[Symbol.asyncIterator]();let returned:Promise<unknown>|undefined,pendingNext:Promise<IteratorResult<string|Uint8Array>>|undefined;
          stopStream=()=>returned??=(async()=>{try{return await iterator.return?.();}finally{await pendingNext?.catch(()=>{});}})();
          return stream((async function*(){try{while(true){controller.signal.throwIfAborted();pendingNext=Promise.resolve(iterator.next());const item=await pendingNext;pendingNext=undefined;controller.signal.throwIfAborted();if(item.done)break;yield item.value;}}finally{await stopStream!();settled();await cleanup();}})(),{contentType:'text/html; charset=utf-8',maxBytes,headers:result.headers});
        }
        throw new RendererError('RENDERER_RESULT_INVALID');
      }catch(cause){settled();try{await cleanup();}catch(cleanupError){throw new RendererError('RENDERER_FAILED',new AggregateError([cause,cleanupError]));}throw cause instanceof RendererError?cause:new RendererError(controller.signal.aborted?'RENDERER_CANCELLED':'RENDERER_FAILED',cause);}
      finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);if(!controller.signal.aborted){request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();}}
    },
    close(){return closing??=(async()=>{closed=true;for(const item of active)item.cancel();await Promise.allSettled([...active].map(item=>item.done));const errors:unknown[]=failures.splice(0);for(const {adapter}of [...entries.values()].reverse())try{await adapter.dispose?.();}catch(error){errors.push(error);}entries.clear();if(errors.length)throw new AggregateError(errors,'Renderer registry close failed');})();},
    get activeRenders(){return active.size;}
  };
}
export type RendererRegistry=ReturnType<typeof createRendererRegistry>;

export * from "./render-document.js";
