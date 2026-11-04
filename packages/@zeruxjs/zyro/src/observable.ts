export interface Observable<T> { get(): T; subscribe(listener: (value: T) => void): () => void }
export interface MutableObservable<T> extends Observable<T> {set(value: T | ((old: T) => T)): void; destroy(): void}
export interface BatchedObservable<T> extends MutableObservable<T> {batch<R>(fn: () => R): R}
/** Notifications are coalesced during a synchronous transaction; snapshots always reflect the latest write. */
export function createObservable<T>(initial: T): BatchedObservable<T> {
 let state = initial, disposed = false, depth = 0, pending = false, emitting = false;
 const listeners = new Set<(value:T)=>void>();
 const flush = () => { if (emitting || depth || !pending || disposed) return; emitting = true;
  try { while(pending && !depth && !disposed) {pending=false; for(const fn of [...listeners]) if(listeners.has(fn)) fn(state)} }
  finally {emitting=false} };
 return {get:()=>state, set(input){if(disposed)return; const next=typeof input==='function'?(input as (v:T)=>T)(state):input;
  if(Object.is(next,state))return;state=next;pending=true;flush()},
  subscribe(listener){if(disposed)return()=>{};listeners.add(listener);return()=>{listeners.delete(listener)}},
  batch(fn){if(disposed)return fn();depth++;try{return fn()}finally{depth--;flush()}},
  destroy(){disposed=true;pending=false;listeners.clear()}};
}
/** Memoizes a selected snapshot for consumers such as React useSyncExternalStore. */
export function mapObservable<A,B>(source:Observable<A>,selector:(value:A)=>B,equal:(a:B,b:B)=>boolean=Object.is):Observable<B>{
 let input=source.get(),selected=selector(input);
 const read=()=>{const next=source.get();if(!Object.is(next,input)){const projected=selector(next);const same=equal(selected,projected);input=next;if(!same)selected=projected}return selected};
 return{get:read,subscribe(listener){
  let previous=read(),installing=true,failed=false,failure:unknown;
  const notify=()=>{const next=read();if(!equal(previous,next)){previous=next;listener(next)}};
  const stop=source.subscribe(()=>{if(installing){try{notify()}catch(error){failed=true;failure=error}}else notify()});
  installing=false;
  if(typeof stop!=='function')throw new TypeError('Observable subscribe must return a disposer');
  if(failed){try{stop()}catch(cleanup){throw new AggregateError([failure,cleanup],'Observable subscription rollback failed')}throw failure}
  return stop;
 }};
}
export function combineObservables<T extends readonly unknown[]>(sources:{[K in keyof T]:Observable<T[K]>}):Observable<T>{
 let previous = sources.map(source=>source.get()) as unknown as T;
 const read=()=>{const current=sources.map(source=>source.get()) as unknown as T;
  if(current.length!==previous.length||current.some((v,i)=>!Object.is(v,previous[i])))previous=current;
  return previous};
 return{get:read,subscribe(listener){let last=read();const stops=sources.map(source=>source.subscribe(()=>{const next=read();if(!Object.is(last,next)){last=next;listener(next)}}));return()=>stops.forEach(stop=>stop())}};
}
