import type {Component,InjectionKey} from 'vue';
export class VueAdapterError extends Error{constructor(readonly code:string,cause?:unknown){super(`Vue adapter: ${code}`,{cause});this.name='VueAdapterError'}}
export interface VueRenderView{readonly component:Component;readonly props?:Record<string,unknown>}
export interface VueRenderContext{readonly ssr:boolean;readonly signal:AbortSignal;onDispose(dispose:()=>void|Promise<void>):void}
/** A key only; every app provides its own context. It is never a global request state holder. */
export const VUE_RENDER_CONTEXT:InjectionKey<VueRenderContext>=Symbol('zerux.vue.render-context');
export interface VueRenderOptions{signal?:AbortSignal;idPrefix?:string;onError?:(error:VueAdapterError)=>void;onDispose?:()=>void|Promise<void>}
export function validateVueView(view:VueRenderView):VueRenderView{
 if(!view||typeof view!=='object')throw new VueAdapterError('INVALID_VIEW');
 const seen=new Set<unknown>();let count=0;
 const check=(component:any,depth:number,path=new Set<unknown>())=>{
  if(path.has(component))throw new VueAdapterError('COMPONENT_OPTIONS_CYCLE');
  if(seen.has(component))return;
  if(++count>256||depth>32)throw new VueAdapterError('COMPONENT_GRAPH_LIMIT');
  if(!component||!['object','function'].includes(typeof component))throw new VueAdapterError('INVALID_COMPONENT');
  seen.add(component);
  if('template'in component||'compilerOptions'in component)throw new VueAdapterError('TEMPLATE_BUILD_REQUIRED');
  if(typeof component!=='function'&&!component.extends&&!component.mixins&&!['setup','render','ssrRender'].some(key=>typeof component[key]==='function'))throw new VueAdapterError('RENDER_FUNCTION_REQUIRED');
  if(component.extends)check(component.extends,depth+1,new Set([...path,component]));
  if(component.mixins){if(!Array.isArray(component.mixins)||component.mixins.length>64)throw new VueAdapterError('COMPONENT_GRAPH_LIMIT');for(const mixin of component.mixins)checkMixin(mixin,depth+1,new Set([...path,component]))}
  if(component.components){const values=Object.values(component.components);if(values.length>256)throw new VueAdapterError('COMPONENT_GRAPH_LIMIT');for(const child of values)check(child,depth+1)}
 };
 const checkMixin=(mixin:any,depth:number,path:Set<unknown>)=>{
  if(path.has(mixin))throw new VueAdapterError('COMPONENT_OPTIONS_CYCLE');
  if(!mixin||typeof mixin!=='object'||depth>32)throw new VueAdapterError('INVALID_COMPONENT');
  if('template'in mixin||'compilerOptions'in mixin)throw new VueAdapterError('TEMPLATE_BUILD_REQUIRED');
  // Mixins need not contain render/setup. A rendering proxy validates their nested options.
  check({...mixin,setup:mixin.setup??(()=>({}))},depth,new Set([...path,mixin]));
 };
 check(view.component,0);
 let props:Record<string,unknown>|undefined;
 if(view.props!==undefined){
  if(!view.props||typeof view.props!=='object'||Array.isArray(view.props)||![Object.prototype,null].includes(Object.getPrototypeOf(view.props)))throw new VueAdapterError('INVALID_PROPS');
  const keys=Reflect.ownKeys(view.props);if(keys.length>256)throw new VueAdapterError('PROPS_LIMIT');props=Object.create(null);
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(view.props,key)!;
   if(typeof key!=='string'||key.length>128||/^(?:__proto__|prototype|constructor)$/.test(key)||!descriptor.enumerable||!('value'in descriptor))throw new VueAdapterError('INVALID_PROPS');
   props![key]=Reflect.get(view.props,key);
  }
  Object.freeze(props);
 }
 return Object.freeze({component:view.component,props});
}
/** Validate a host-authored component tree and snapshot the shallow prop bag without cloning Vue refs/proxies. */
export const createVueView=(component:Component,props?:Record<string,unknown>):VueRenderView=>validateVueView({component,props});
export function validateVueOptions(options:VueRenderOptions):VueRenderOptions{
 if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw new VueAdapterError('INVALID_SIGNAL');
 if(options.idPrefix!==undefined&&(typeof options.idPrefix!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(options.idPrefix)))throw new VueAdapterError('INVALID_ID_PREFIX');
 if(options.onError!==undefined&&typeof options.onError!=='function'||options.onDispose!==undefined&&typeof options.onDispose!=='function')throw new VueAdapterError('INVALID_CALLBACK');
 return Object.freeze({...options});
}
export function checkVueAbort(signal?:AbortSignal):void{if(signal?.aborted)throw new VueAdapterError('RENDER_ABORTED',signal.reason)}
export function vueVersion(version:unknown):void{if(typeof version!=='string'||!/^3\.5\.\d+$/.test(version)||Number(version.split('.')[2])<44)throw new VueAdapterError('VUE_PEER_VERSION_MISMATCH')}
export function unwrapModule<T>(module:T):T{return((module as any).default??module)as T}
/** Bounded host callbacks and sanitized error records, owned by one accepted app/render. */
export function createVueLease(ssr:boolean,options:VueRenderOptions){
 const controller=new AbortController(),disposers:(()=>void|Promise<void>)[]=[],errors:VueAdapterError[]=[];
 let closing=false,closed:Promise<void>|undefined,dropped=0,criticalEpoch=0,criticalError:VueAdapterError|undefined;
 const abort=()=>controller.abort(options.signal?.reason);
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const record=(error:VueAdapterError)=>{if(errors.length<16)errors.push(error);else dropped++};
 const report=(code:string,cause:unknown)=>{
  const error=new VueAdapterError(code,cause);record(error);
  if(['VUE_RENDER_ERROR','TEMPLATE_BUILD_REQUIRED'].includes(code)){criticalEpoch++;criticalError=error;}
  try{options.onError?.(error)}catch(cause){record(new VueAdapterError('VUE_OBSERVER_FAILED',cause))}
 };
 const context:VueRenderContext=Object.freeze({ssr,signal:controller.signal,onDispose(dispose:()=>void|Promise<void>){
  if(closing||typeof dispose!=='function'||disposers.length>=32)throw new VueAdapterError('INVALID_DISPOSER');disposers.push(dispose);
 }});
 return{context,report,get criticalEpoch(){return criticalEpoch},get criticalError(){return criticalError},get errors(){return Object.freeze([...errors])},get droppedErrors(){return dropped},
  close(){closing=true;return closed??=Promise.resolve().then(async()=>{
   controller.abort(options.signal?.reason);options.signal?.removeEventListener('abort',abort);const failures:unknown[]=[];
   for(const stop of disposers.splice(0).reverse())try{await stop()}catch(error){failures.push(error)}
   try{await options.onDispose?.()}catch(error){failures.push(error)}
   if(failures.length)throw new VueAdapterError('VUE_CLEANUP_FAILED',new AggregateError(failures,'Vue render cleanup failed'));
  })}
 };
}
