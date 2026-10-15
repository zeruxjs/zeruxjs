import type {ExternalStore} from './store.js';
/** Adapt an Observable (including @zeruxjs/zyro) without a runtime dependency. */
export function observableToReactStore<T>(source:{get():T;subscribe(listener:(value:T)=>void):()=>void}):ExternalStore<T>{
 return{getSnapshot:()=>source.get(),subscribe(listener){return source.subscribe(()=>listener())}};
}
/** Observe a readable React store through the shared Observable contract. */
export function reactStoreToObservable<T>(store:ExternalStore<T>){return{get:store.getSnapshot,subscribe(listener:(value:T)=>void){return store.subscribe(()=>listener(store.getSnapshot()))}}}
