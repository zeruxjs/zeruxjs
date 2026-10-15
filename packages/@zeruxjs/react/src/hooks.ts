import {selectReactStore,type ExternalStore} from './store.js';
/** A React.useSyncExternalStore-compatible injection (React remains a peer). */
export type UseSyncExternalStore = <T>(subscribe:(listener:()=>void)=>()=>void,getSnapshot:()=>T,getServerSnapshot?:()=>T)=>T;
export interface ReactHookRuntime {
 useSyncExternalStore:UseSyncExternalStore;
 useMemo:<T>(create:()=>T,dependencies:readonly unknown[])=>T;
}
/** On SSR, React requires the server snapshot to match the hydration payload. */
export function useReactStore<T>(useSyncExternalStore:UseSyncExternalStore,store:ExternalStore<T>,serverSnapshot?:()=>T):T {
 return useSyncExternalStore(store.subscribe,store.getSnapshot,serverSnapshot??store.getServerSnapshot);
}
const selectors=new WeakMap<object,WeakMap<Function,{comparator:Function;store:ExternalStore<unknown>}>>();
/** Prefer createReactBindings inside actual components: it uses React's own hook memoization. */
export function useReactSelector<A,B>(useSyncExternalStore:UseSyncExternalStore,store:ExternalStore<A>,selector:(state:A)=>B,options:{equal?:(a:B,b:B)=>boolean;serverSnapshot?:()=>A}={}):B{
 let cached=selectors.get(store);if(!cached){cached=new WeakMap();selectors.set(store,cached)}
 let entry=cached.get(selector);const equal=options.equal??Object.is;
 if(!entry||entry.comparator!==equal){entry={comparator:equal,store:selectReactStore(store,selector,equal) as ExternalStore<unknown>};cached.set(selector,entry)}
 const derived=entry.store as ExternalStore<B>;
 const serverRead=options.serverSnapshot;
 return useSyncExternalStore(derived.subscribe,derived.getSnapshot,serverRead?()=>selector(serverRead()):derived.getServerSnapshot);
}
/** Correct React hook lifecycle: one selector store per stable dependency set. */
export function createReactBindings(runtime:ReactHookRuntime){
 return{
  useStore<T>(store:ExternalStore<T>,serverSnapshot?:()=>T){return useReactStore(runtime.useSyncExternalStore,store,serverSnapshot)},
  useSelector<A,B>(store:ExternalStore<A>,selector:(state:A)=>B,options:{equal?:(a:B,b:B)=>boolean;serverSnapshot?:()=>A}={}){
   const derived=runtime.useMemo(()=>selectReactStore(store,selector,options.equal),[store,selector,options.equal]);
   const serverRead=options.serverSnapshot;
   return runtime.useSyncExternalStore(derived.subscribe,derived.getSnapshot,serverRead?()=>selector(serverRead()):derived.getServerSnapshot);
  }
 };
}
