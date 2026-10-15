export interface ExternalStore<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export type Updater<T> = T | ((previous: T) => T);
export interface WritableExternalStore<T> extends ExternalStore<T> {set(value: Updater<T>): void; update(fn:(state:T)=>T):void; batch<R>(fn:()=>R):R; getServerSnapshot():T; destroy():void}
/** Snapshot updates are synchronous; a batch notifies subscribers once. */
export function createReactStore<T>(initial:T):WritableExternalStore<T>{
 let current=initial,active=true,depth=0,pending=false,emitting=false;
 const listeners=new Set<()=>void>();const getSnapshot=()=>current;
 const flush=()=>{if(depth||emitting||!pending||!active)return;emitting=true;try{while(pending&&!depth&&active){pending=false;for(const listener of [...listeners])if(listeners.has(listener))listener()}}finally{emitting=false}};
 const set=(value:Updater<T>)=>{if(!active)return;const next=typeof value==='function'?(value as (v:T)=>T)(current):value;
  if(Object.is(next,current))return;current=next;pending=true;flush()};
 return {getSnapshot,getServerSnapshot:getSnapshot,subscribe(listener){if(!active)return()=>{};listeners.add(listener);return()=>listeners.delete(listener)},
  set,update:set,batch(fn){depth++;try{return fn()}finally{depth--;flush()}},destroy(){active=false;pending=false;listeners.clear()}};
}
/** Memoizes selected snapshots instead of producing fresh references on every read. */
export function selectReactStore<A,B>(source:ExternalStore<A>,selector:(value:A)=>B,equal:(a:B,b:B)=>boolean=Object.is):ExternalStore<B>{
 let lastSource=source.getSnapshot(),lastSelected=selector(lastSource);
 const getSnapshot=()=>{const current=source.getSnapshot();if(!Object.is(lastSource,current)){lastSource=current;const selected=selector(current);if(!equal(lastSelected,selected))lastSelected=selected}return lastSelected};
 return{getSnapshot,subscribe(listener){let previous=getSnapshot();return source.subscribe(()=>{const next=getSnapshot();if(!equal(previous,next)){previous=next;listener()}})}};
}
