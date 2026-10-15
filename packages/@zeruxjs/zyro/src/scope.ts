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
  if(destroyed){stop();return()=>{}}
  let active=true;
  const dispose=()=>{if(!active)return;active=false;disposers.delete(dispose);stop()};
  disposers.add(dispose);return dispose;
 };
 return{
  get destroyed(){return destroyed},add,
  observe<T>(source:Observable<T>,onChange:(value:T)=>void,options:{immediate?:boolean}={}){
   if(destroyed)throw new Error('Zyro subscription scope is destroyed');
   // Install first to avoid missing a concurrent transition; re-read after subscription.
   let synchronous=false,installing=true;
   const stop=add(source.subscribe(value=>{if(installing)synchronous=true;onChange(value)}));
   installing=false;
   if(options.immediate!==false&&!synchronous){try{onChange(source.get())}catch(error){stop();throw error}}
   return stop;
  },
  destroy(){if(destroyed)return;destroyed=true;const errors:unknown[]=[];
   for(const stop of [...disposers].reverse()){try{stop()}catch(error){errors.push(error)}}
   if(errors.length)throw new AggregateError(errors,'Failed to dispose Zyro subscriptions');
  }
 };
}
