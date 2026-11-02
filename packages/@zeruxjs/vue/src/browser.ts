import type {App} from 'vue';
import {VueAdapterError,validateVueView,validateVueOptions,checkVueAbort,vueVersion,unwrapModule,createVueLease,VUE_RENDER_CONTEXT,type VueRenderView,type VueRenderOptions} from './render-policy.js';
export {VueAdapterError} from './render-policy.js';
export interface VueMount{readonly mode:'mount'|'hydrate';readonly closed:boolean;readonly errors:readonly VueAdapterError[];readonly droppedErrors:number;update(view:VueRenderView):Promise<void>;unmount():Promise<void>}
const owners=new WeakMap<object,object>();
async function peers(){
 try{
  const runtime=unwrapModule(await import('@vue/runtime-dom'));vueVersion(runtime.version);
  if(typeof runtime.createApp!=='function'||typeof runtime.createSSRApp!=='function'||!runtime.isRuntimeOnly())throw new VueAdapterError('RUNTIME_ONLY_BUILD_REQUIRED');
  return runtime;
 }catch(cause){throw cause instanceof VueAdapterError?cause:new VueAdapterError('VUE_DEPENDENCY_UNAVAILABLE',cause)}
}
async function open(mode:VueMount['mode'],input:VueRenderView,container:Element,options:VueRenderOptions):Promise<VueMount>{
 const view=validateVueView(input),settings=validateVueOptions(options);checkVueAbort(settings.signal);
 if(!container||container.nodeType!==1||!container.ownerDocument)throw new VueAdapterError('INVALID_CONTAINER');
 if(owners.has(container))throw new VueAdapterError('ROOT_ALREADY_OWNED');
 const owner={},lease=createVueLease(false,settings);owners.set(container,owner);
 let closed=false,app:App|undefined,closing:Promise<void>|undefined;
 const unmount=()=>{closed=true;return closing??=Promise.resolve().then(async()=>{
  const failures:unknown[]=[];
  try{app?.unmount()}catch(error){failures.push(error)}finally{settings.signal?.removeEventListener('abort',abort)}
  try{await lease.close()}catch(error){failures.push(error)}
  if(owners.get(container)===owner)owners.delete(container);
  if(failures.length)throw new VueAdapterError('VUE_UNMOUNT_FAILED',new AggregateError(failures,'Vue app cleanup failed'));
 })};
 const abort=()=>{void unmount().catch(error=>lease.report('VUE_UNMOUNT_FAILED',error))};
 settings.signal?.addEventListener('abort',abort,{once:true});
 try{
  const runtime=await peers();checkVueAbort(lease.context.signal);if(closed)throw new VueAdapterError('ROOT_CLOSED');
  const current=runtime.shallowRef(view);
  const root={name:'ZeruxVueRoot',setup:()=>()=>runtime.h(current.value.component,current.value.props?{...current.value.props}:undefined)};
  app=mode==='hydrate'?runtime.createSSRApp(root):runtime.createApp(root);
  app.config.idPrefix=settings.idPrefix??'';app.provide(VUE_RENDER_CONTEXT,lease.context);
  app.config.errorHandler=error=>lease.report('VUE_RENDER_ERROR',error);
  app.config.warnHandler=message=>lease.report(/runtime compilation|on-the-fly template/i.test(message)?'TEMPLATE_BUILD_REQUIRED':'VUE_RENDER_WARNING',new Error(message));
  app.mount(container);await runtime.nextTick();checkVueAbort(lease.context.signal);
  if(lease.criticalError?.code==='TEMPLATE_BUILD_REQUIRED')throw lease.criticalError;
  if(lease.criticalError)throw new VueAdapterError('VUE_MOUNT_FAILED',lease.criticalError);
  return Object.freeze({mode,get closed(){return closed},get errors(){return lease.errors},get droppedErrors(){return lease.droppedErrors},
   async update(next:VueRenderView){if(closed)throw new VueAdapterError('ROOT_CLOSED');if(!runtime.isRuntimeOnly())throw new VueAdapterError('RUNTIME_ONLY_BUILD_REQUIRED');const before=lease.criticalEpoch;current.value=validateVueView(next);await runtime.nextTick();if(lease.criticalEpoch!==before)throw new VueAdapterError('VUE_UPDATE_FAILED',lease.criticalError)},unmount});
 }catch(cause){try{await unmount()}catch(cleanup){throw new VueAdapterError('VUE_PREPARATION_FAILED',new AggregateError([cause,cleanup],'Vue preparation cleanup failed'))}throw cause instanceof VueAdapterError?cause:new VueAdapterError('VUE_PREPARATION_FAILED',cause)}
}
/** Runtime-only authored render functions; never compile a container's HTML or an option template. */
export function mountVue(view:VueRenderView,container:Element,options:VueRenderOptions={}):Promise<VueMount>{return open('mount',view,container,options)}
/** Native Vue SSR hydration. Host must provide matching tree/state/idPrefix; native mismatch warnings are recorded. */
export function hydrateVue(view:VueRenderView,container:Element,options:VueRenderOptions={}):Promise<VueMount>{return open('hydrate',view,container,options)}
