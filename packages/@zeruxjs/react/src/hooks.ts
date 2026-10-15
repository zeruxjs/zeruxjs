import {selectReactStore,type ExternalStore} from './store.js';
/** Supply React.useSyncExternalStore; no React dependency is bundled. */
export type UseSyncExternalStore = <T>(subscribe:(listener:()=>void)=>()=>void,getSnapshot:()=>T,getServerSnapshot?:()=>T)=>T;
export interface ReactHookRuntime {
 useSyncExternalStore:UseSyncExternalStore;
 useMemo:<T>(create:()=>T,dependencies:readonly unknown[])=>T;
}
export function useReactStore<T>(useSyncExternalStore:UseSyncExternalStore,store:ExternalStore<T>,serverSnapshot?:()=>T):T {
 return useSyncExternalStore(store.subscribe,store.getSnapshot,serverSnapshot??store.getSnapshot);
}
/**
 * For direct useReactSelector calls, keep the selector and comparator stable (React.useCallback).
 * createReactBindings below is preferable for ordinary components.
 */
const selectors=new WeakMap<object,WeakMap<Function,{comparator:Function;store:ExternalStore<unknown>}>>();
export function useReactSelector<A,B>(useSyncExternalStore:UseSyncExternalStore,store:ExternalStore<A>,selector:(state:A)=>B,options:{equal?:(a:B,b:B)=>boolean;serverSnapshot?:()=>A}={}):B{
 let cached=selectors.get(store);if(!cached){cached=new WeakMap();selectors.set(store,cached)}
 let entry=cached.get(selector);const equal=options.equal??Object.is;
 if(!entry||entry.comparator!==equal){entry={comparator:equal,store:selectReactStore(store,selector,equal) as ExternalStore<unknown>};cached.set(selector,entry)}
 const derived=entry.store as ExternalStore<B>;
 return useSyncExternalStore(derived.subscribe,derived.getSnapshot,options.serverSnapshot?()=>selector(options.serverSnapshot!()):derived.getSnapshot);
}
/** Correct React Hooks lifecycle: memoize selected stores across renders via injected useMemo. */
export function createReactBindings(runtime:ReactHookRuntime){
 return{
  useStore<T>(store:ExternalStore<T>,serverSnapshot?:()=>T){return useReactStore(runtime.useSyncExternalStore,store,serverSnapshot)},
  useSelector<A,B>(store:ExternalStore<A>,selector:(state:A)=>B,options:{equal?:(a:B,b:B)=>boolean;serverSnapshot?:()=>A}={}){
   const derived=runtime.useMemo(()=>selectReactStore(store,selector,options.equal),[store,selector,options.equal]);
   return runtime.useSyncExternalStore(derived.subscribe,derived.getSnapshot,options.serverSnapshot?()=>selector(options.serverSnapshot!()):derived.getSnapshot);
  }
 };
}
