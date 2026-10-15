export interface VueRef<T>{value:T}
export interface SubscribableRef<T> extends VueRef<T> {subscribe(listener:(value:T)=>void):()=>void}
export function createVueRef<T>(initial:T):SubscribableRef<T>{let value=initial;const listeners=new Set<(v:T)=>void>();return {
 get value(){return value},set value(next:T){if(Object.is(value,next))return;value=next;for(const fn of [...listeners])if(listeners.has(fn))fn(value)},
 subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener)}}}}
export function toVueReadable<T>(subscribe:(listener:(value:T)=>void)=>()=>void,get:()=>T):VueRef<T>&{stop():void}{
 let current=get(),active=true;const stopSource=subscribe(v=>{if(active)current=v});
 return{get value(){return current},stop(){if(active){active=false;stopSource()}}};
}
export function mapVueRef<A,B>(source:SubscribableRef<A>,project:(value:A)=>B,equal:(a:B,b:B)=>boolean=Object.is):SubscribableRef<B>&{stop():void}{
 const result=createVueRef(project(source.value));const stop=source.subscribe(value=>{const next=project(value);if(!equal(result.value,next))result.value=next});
 return{get value(){return result.value},set value(_next:B){throw new TypeError('Derived ref is readonly')},subscribe:result.subscribe,stop};
}
/** Multi-ref derived state with a stable cached value. */
export function combineVueRefs<T extends readonly unknown[]>(sources:{[K in keyof T]:SubscribableRef<T[K]>}):SubscribableRef<T>&{stop():void}{
 const read=()=>sources.map(s=>s.value) as unknown as T;const result=createVueRef(read());
 const update=()=>{const next=read();if(next.some((v,i)=>!Object.is(v,result.value[i])))result.value=next};
 const stops=sources.map(s=>s.subscribe(update));return{get value(){return result.value},set value(_next:T){throw new TypeError('Combined ref is readonly')},subscribe:result.subscribe,stop(){stops.forEach(s=>s())}};
}
