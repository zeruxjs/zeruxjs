import type {SubscribableRef} from './ref.js';
export function fromVueRef<T>(ref:{value:T},subscribe?:(listener:()=>void)=>()=>void){return{getSnapshot:()=>ref.value,subscribe:subscribe??(()=>()=>{})};}
export function bindVueRef<T>(source:{getSnapshot():T;subscribe(listener:()=>void):()=>void},target:SubscribableRef<T>):()=>void {
 target.value=source.getSnapshot();return source.subscribe(()=>{target.value=source.getSnapshot()});
}
/** Two-way link with equality checks and guaranteed tear-down; callers supply a mutable store. */
export function syncVueRef<T>(ref:SubscribableRef<T>,store:{getSnapshot():T;subscribe(listener:()=>void):()=>void;set(value:T):void},equal:(a:T,b:T)=>boolean=Object.is):()=>void{
 let stopped=false,busy=false;
 const fromStore=()=>{if(stopped||busy)return;const next=store.getSnapshot();if(!equal(ref.value,next)){busy=true;try{ref.value=next}finally{busy=false}}};
 const fromRef=(value:T)=>{if(stopped||busy||equal(store.getSnapshot(),value))return;busy=true;try{store.set(value)}finally{busy=false}};
 fromStore();const stopStore=store.subscribe(fromStore),stopRef=ref.subscribe(fromRef);
 return()=>{if(stopped)return;stopped=true;stopStore();stopRef()};
}
export function observableToVueRef<T>(source:{get():T;subscribe(listener:(value:T)=>void):()=>void}){
 let current=source.get(),active=true;const listeners=new Set<(value:T)=>void>();
 const stopSource=source.subscribe(value=>{if(!active||Object.is(value,current))return;current=value;for(const fn of [...listeners])if(listeners.has(fn))fn(value)});
 return{get value(){return current},set value(_next:T){throw new TypeError('Observable ref is readonly')},
  subscribe(listener:(value:T)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
  stop(){if(active){active=false;stopSource();listeners.clear()}}};
}
