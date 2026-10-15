/** Vue 3 runtime injection. Nothing imports Vue at module evaluation / during SSR. */
export interface VueRuntime {
 shallowRef<T>(value:T):{value:T};
 getCurrentScope():unknown;
 onScopeDispose(stop:()=>void):void;
 readonly?<T>(value:T):T;
 watch?<T>(source:()=>T,callback:(next:T)=>void,options?:{flush:'sync'}):()=>void;
}
export interface VueStore<T> {getSnapshot():T;subscribe(listener:()=>void):()=>void}
/**
 * Inside a Vue setup/effect scope, subscribe once and release when the scope ends.
 * Throw without a scope: silently subscribing in module code leaks listeners.
 */
export function createVueBindings(runtime:VueRuntime){
 const connect=<T>(store:VueStore<T>)=>{
  const state=runtime.shallowRef(store.getSnapshot());
  let active=true;
  const read=()=>{if(active)state.value=store.getSnapshot()};
  const stop=store.subscribe(read);
  // Catch an update between the first read and subscription.
  read();
  const dispose=()=>{if(!active)return;active=false;stop()};
  return {ref:runtime.readonly?runtime.readonly(state):state,stop:dispose};
 };
 return {
  /** Manual bridge for non-component code; caller owns `stop`. */
  connect,
  /** Automatic scope disposal; use inside setup() or effectScope.run(). */
  useStore<T>(store:VueStore<T>,options:{ssr?:boolean}={}){
   if(!runtime.getCurrentScope())throw new Error('Vue store binding requires an active Vue effect scope');
   if(options.ssr){const snapshot=runtime.shallowRef(store.getSnapshot());return runtime.readonly?runtime.readonly(snapshot):snapshot}
   const connection=connect(store);
   try{runtime.onScopeDispose(connection.stop)}catch(error){connection.stop();throw error}
   return connection.ref;
  },
  /** Adapt Vue's own ref into a subscribable store using sync watch. */
  fromRef<T>(ref:{value:T}){
   if(!runtime.watch)throw new Error('Vue watch() must be provided to bridge a Vue ref');
   return {getSnapshot:()=>ref.value,subscribe(listener:()=>void){return runtime.watch!(()=>ref.value,listener,{flush:'sync'})}};
  }
 };
}
