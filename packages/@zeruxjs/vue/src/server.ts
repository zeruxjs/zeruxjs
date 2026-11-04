import {createRequire} from 'node:module';
import {VueAdapterError,validateVueView,validateVueOptions,checkVueAbort,vueVersion,unwrapModule,createVueLease,VUE_RENDER_CONTEXT,type VueRenderView,type VueRenderOptions} from './render-policy.js';
export {VueAdapterError} from './render-policy.js';
export interface VueServerOptions extends VueRenderOptions{maxBytes?:number}
async function peers(){
 try{
  const require=createRequire(__filename),version=require('@vue/server-renderer/package.json').version,vue=require('vue/package.json').version;
  const runtime=unwrapModule(await import('@vue/runtime-dom'));
  vueVersion(runtime.version);if(!runtime.isRuntimeOnly())throw new VueAdapterError('RUNTIME_ONLY_BUILD_REQUIRED');
  if(version!==runtime.version||vue!==runtime.version)throw new VueAdapterError('VUE_PEER_VERSION_MISMATCH');
  // Publicly exported compiler-free build. Its template compiler is a throwing stub, never eval.
  const entry='@vue/server-renderer/dist/server-renderer.esm-bundler.js';
  const renderer=await import(entry) as typeof import('@vue/server-renderer');
  if(typeof renderer.renderToString!=='function'||typeof runtime.createSSRApp!=='function')throw new VueAdapterError('VUE_CAPABILITY_UNAVAILABLE');
  return{runtime,renderer};
 }catch(cause){throw cause instanceof VueAdapterError?cause:new VueAdapterError('VUE_DEPENDENCY_UNAVAILABLE',cause);}
}
/** Native async SSR using Vue's compiler-free server build. Every call creates a fresh application/context. */
export async function renderVueToString(input:VueRenderView,options:VueServerOptions={}):Promise<string>{
 const view=validateVueView(input),settings=validateVueOptions(options),max=options.maxBytes??1048576;
 if(!Number.isSafeInteger(max)||max<1||max>16777216)throw new VueAdapterError('INVALID_BYTE_LIMIT');checkVueAbort(settings.signal);
 const lease=createVueLease(true,settings);let result:string|undefined,failure:unknown;
 try{
  const{runtime,renderer}=await peers();checkVueAbort(lease.context.signal);
  const app=runtime.createSSRApp({name:'ZeruxVueRoot',render:()=>runtime.h(view.component,view.props?{...view.props}:undefined)});
  app.config.idPrefix=settings.idPrefix??'';app.provide(VUE_RENDER_CONTEXT,lease.context);
  app.config.errorHandler=error=>lease.report('VUE_RENDER_ERROR',error);
  app.config.warnHandler=(message)=>lease.report('VUE_RENDER_WARNING',new Error(message));
  const ssrContext:import('@vue/server-renderer').SSRContext={};
  result=await renderer.renderToString(app,ssrContext);checkVueAbort(lease.context.signal);
  if(ssrContext.teleports&&Object.keys(ssrContext.teleports).length)throw new VueAdapterError('SSR_TELEPORTS_UNSUPPORTED');
  if(lease.errors.length)throw new VueAdapterError('VUE_RENDER_FAILED',new AggregateError(lease.errors,'Vue SSR reported errors'));
  if(new TextEncoder().encode(result).length>max)throw new VueAdapterError('HTML_BYTE_LIMIT');
 }catch(cause){failure=lease.context.signal.aborted?new VueAdapterError('RENDER_ABORTED',cause):cause instanceof VueAdapterError?cause:new VueAdapterError('VUE_RENDER_FAILED',cause);}
 try{await lease.close();}catch(cleanup){failure=failure?new VueAdapterError('VUE_RENDER_FAILED',new AggregateError([failure,cleanup],'Vue SSR and cleanup failed')):cleanup;}
 if(failure)throw failure;return result!;
}
export async function getVueServerCapabilities(){const{runtime}=await peers();return Object.freeze({version:runtime.version,ssr:true,hydration:true,streaming:false,templates:'precompiled-only'});}
