import type {Observable} from './observable.js';
/** An explicit ownership boundary for Zyro-style observable subscriptions. */
export interface ZyroSubscriptionScope {
 observe<T>(source:Observable<T>,onChange:(value:T)=>void,options?:{immediate?:boolean}):()=>void;
 add(dispose:()=>void):()=>void;
 destroy():void;
 readonly destroyed:boolean;
}
/** Suitable for mount/unmount and route teardown; does not mutate shared sources. */
export function createZyroSubscriptionScope():ZyroSubscriptionScope {
 let destroyed=false;
 const disposers=new Set<()=>void>();
 const add=(stop:()=>void)=>{
  if(typeof stop!=='function')throw new TypeError('A subscription disposer is required');
  if(destroyed){stop();return()=>{}}
  let active=true;
  const dispose=()=>{if(!active)return;active=false;disposers.delete(dispose);stop()};
  disposers.add(dispose);return dispose;
 };
 return{
  get destroyed(){return destroyed},add,
  observe<T>(source:Observable<T>,onChange:(value:T)=>void,options:{immediate?:boolean}={}){
   if(destroyed)throw new Error('Zyro subscription scope is destroyed');
   if(!source||typeof source.get!=='function'||typeof source.subscribe!=='function'||typeof onChange!=='function')throw new TypeError('Invalid observable subscription');
   // Capture synchronous callback errors until subscribe returns its rollback handle.
   let synchronous=false,installing=true,observing=true,failed=false,failure:unknown;
   const unsubscribe=source.subscribe(value=>{
    if(!observing||destroyed)return;
    if(installing){synchronous=true;try{onChange(value)}catch(error){failed=true;failure=error}}
    else onChange(value);
   });
   installing=false;
   if(typeof unsubscribe!=='function')throw new TypeError('Observable subscribe must return a disposer');
   const stop=add(()=>{observing=false;unsubscribe()});
   if(failed){try{stop()}catch(cleanup){throw new AggregateError([failure,cleanup],'Observable subscription rollback failed')}throw failure}
   if(destroyed)return stop;
   if(options.immediate!==false&&!synchronous){try{onChange(source.get())}catch(error){try{stop()}catch(cleanup){throw new AggregateError([error,cleanup],'Observable initial read and cleanup failed')}throw error}}
   return stop;
  },
  destroy(){if(destroyed)return;destroyed=true;const errors:unknown[]=[];
   for(const stop of [...disposers].reverse()){try{stop()}catch(error){errors.push(error)}}
   if(errors.length)throw new AggregateError(errors,'Failed to dispose Zyro subscriptions');
  }
 };
}
