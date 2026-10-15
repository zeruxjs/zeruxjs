import type {Observable} from './observable.js';
export function toExternalStore<T>(source:Observable<T>){return{getSnapshot:()=>source.get(),subscribe(listener:()=>void){return source.subscribe(()=>listener())}}}
export function fromExternalStore<T>(store:{getSnapshot():T;subscribe(listener:()=>void):()=>void}):Observable<T>{return{get:()=>store.getSnapshot(),subscribe(listener){return store.subscribe(()=>listener(store.getSnapshot()))}}}
/** Subscribes until a predicate matches, aborts, or the timeout expires. Handles synchronous subscribe callbacks. */
export function awaitObservable<T>(source:Observable<T>,predicate:(value:T)=>boolean,options:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<T>{
 if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<0))return Promise.reject(new RangeError('Invalid timeout'));
 return new Promise((resolve,reject)=>{
  let stop:(()=>void)|undefined, done=false, mustStop=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(result:T|unknown,failed:boolean)=>{if(done)return;done=true;if(stop)stop();else mustStop=true;
   if(timer!==undefined)clearTimeout(timer);options.signal?.removeEventListener('abort',aborted);
   if(failed)reject(result);else resolve(result as T)};
  const aborted=()=>finish(new Error('Observable wait aborted'),true);
  if(options.signal?.aborted){aborted();return}
  options.signal?.addEventListener('abort',aborted,{once:true});
  try{
   const current=source.get();if(predicate(current)){finish(current,false);return}
   if(options.timeoutMs!==undefined)timer=setTimeout(()=>finish(new Error('Observable wait timed out'),true),options.timeoutMs);
   stop=source.subscribe(value=>{try{if(predicate(value))finish(value,false)}catch(e){finish(e,true)}});
   if(mustStop)stop();
  }catch(e){finish(e,true)}
 });
}
