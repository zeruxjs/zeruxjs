/** Vue 3 runtime injection. Nothing imports Vue at module evaluation / during SSR. */
export interface VueRuntime {
 shallowRef<T>(value:T):{value:T};
 getCurrentScope():unknown;
 onScopeDispose(stop:()=>void):void;
 readonly?(value:{value:any}):{readonly value:any};
 watch?<T>(source:()=>T,callback:(next:T)=>void,options?:{flush:'sync'}):()=>void;
}
export interface VueStore<T> {getSnapshot():T;subscribe(listener:()=>void):()=>void}
/**
 * Inside a Vue setup/effect scope, subscribe once and release when the scope ends.
 * Throw without a scope: silently subscribing in module code leaks listeners.
 */
export function createVueBindings(runtime:VueRuntime){
 if(!runtime||['shallowRef','getCurrentScope','onScopeDispose'].some(name=>typeof runtime[name as keyof VueRuntime]!=='function')||runtime.readonly!==undefined&&typeof runtime.readonly!=='function'||runtime.watch!==undefined&&typeof runtime.watch!=='function')throw new TypeError('Vue runtime functions are required');
 const expose=<T>(state:{value:T}):Readonly<{value:T}>=>runtime.readonly?runtime.readonly(state):state;
 const connect=<T>(store:VueStore<T>)=>{
  if(!store||typeof store.getSnapshot!=='function'||typeof store.subscribe!=='function')throw new TypeError('A getSnapshot/subscribe store is required');
  const state=runtime.shallowRef(store.getSnapshot());
  let active=true,installing=true,failed=false,failure:unknown;
  const read=()=>{if(active)state.value=store.getSnapshot()};
  const stop=store.subscribe(()=>{if(installing){try{read()}catch(error){failed=true;failure=error}}else read()});
  installing=false;
  if(typeof stop!=='function')throw new TypeError('Store subscribe must return a disposer');
  const dispose=()=>{if(!active)return;active=false;stop()};
  try{if(failed)throw failure;read();return{ref:expose(state),stop:dispose}}
  catch(error){try{dispose()}catch(cleanup){throw new AggregateError([error,cleanup],'Vue connection rollback failed')}throw error}
 };
 return {
  /** Manual bridge for non-component code; caller owns `stop`. */
  connect,
  /** Automatic scope disposal; use inside setup() or effectScope.run(). */
  useStore<T>(store:VueStore<T>,options:{ssr?:boolean}={}){
   if(!runtime.getCurrentScope())throw new Error('Vue store binding requires an active Vue effect scope');
   if(options.ssr){const snapshot=runtime.shallowRef(store.getSnapshot());return expose(snapshot)}
   const connection=connect(store);
   try{runtime.onScopeDispose(connection.stop)}catch(error){try{connection.stop()}catch(cleanup){throw new AggregateError([error,cleanup],'Vue scope registration rollback failed')}throw error}
   return connection.ref;
  },
  /** Adapt Vue's own ref into a subscribable store using sync watch. */
  fromRef<T>(ref:{value:T}){
   if(!runtime.watch)throw new Error('Vue watch() must be provided to bridge a Vue ref');
   return {getSnapshot:()=>ref.value,subscribe(listener:()=>void){return runtime.watch!(()=>ref.value,listener,{flush:'sync'})}};
  }
 };
}
