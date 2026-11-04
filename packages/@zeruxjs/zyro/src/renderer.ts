import type {Signal,ReadonlySignal} from 'zyrojs/component';
import {mapObservable,type Observable,type MutableObservable} from './observable.js';
import {createZyroSubscriptionScope} from './scope.js';
import {createAsyncObservable,type AsyncObservable,type AsyncObservableOptions} from './async.js';
/** The host explicitly injects public standalone primitives; importing core starts no renderer. */
export type ZyroRendererRuntime=Pick<typeof import('zyrojs/component'),'signal'|'batch'|'untracked'|'onScopeDispose'|'useRef'>;
export interface ZyroRendererBridgeOptions {signal?:AbortSignal;maxConnections?:number}
export type RendererReadable<T>=ReadonlySignal<T>&{dispose():void};
export type RendererWritable<T>=Signal<T>&{dispose():void};
export interface ZyroRendererBridge {
 read<T>(source:Observable<T>):RendererReadable<T>;
 select<A,B>(source:Observable<A>,selector:(value:A)=>B,equal?:(a:B,b:B)=>boolean):RendererReadable<B>;
 write<T>(source:MutableObservable<T>):RendererWritable<T>;
 resource<T>(load:(signal:AbortSignal)=>Promise<T>,options?:Omit<AsyncObservableOptions<T>,'signal'>):AsyncObservable<T>;
 batch<T>(fn:()=>T):T;
 destroy():void;
 readonly destroyed:boolean;
 readonly activeConnections:number;
}
function validateSource(source:unknown):asserts source is Observable<unknown>{
 if(!source||typeof (source as Observable<unknown>).get!=='function'||typeof (source as Observable<unknown>).subscribe!=='function')throw new TypeError('An explicit get/subscribe observable is required');
}
/** Mount/request-owned conversion scope. Sources are borrowed; only resources created here are destroyed. */
export function createZyroRendererBridge(runtime:ZyroRendererRuntime,options:ZyroRendererBridgeOptions={}):ZyroRendererBridge{
 if(!runtime||['signal','batch','untracked','onScopeDispose','useRef'].some(name=>typeof runtime[name as keyof ZyroRendererRuntime]!=='function'))throw new TypeError('ZyroJS runtime primitives are required');
 const max=options.maxConnections??128,parent=options.signal;
 if(!Number.isSafeInteger(max)||max<1||max>4096)throw new RangeError('Invalid bridge connection limit');
 if(parent!==undefined&&!(parent instanceof AbortSignal))throw new TypeError('Invalid bridge abort signal');
 const {signal,batch,untracked}=runtime,scope=createZyroSubscriptionScope(),lifetime=new AbortController();
 let connections=0,resources=0;
 const assertOpen=()=>{if(scope.destroyed)throw new Error('Zyro renderer bridge is destroyed')};
 const destroy=()=>{try{scope.destroy()}finally{lifetime.abort(parent?.reason);parent?.removeEventListener('abort',destroy)}};
 const select=<A,B>(source:Observable<A>,selector:(value:A)=>B,equal:(a:B,b:B)=>boolean=Object.is,write?:MutableObservable<B>):RendererReadable<B>=>{
  assertOpen();validateSource(source);
  if(typeof selector!=='function'||typeof equal!=='function')throw new TypeError('Invalid bridge selector/equality');
  if(connections>=max)throw new Error('Zyro renderer bridge connection limit exceeded');
  const compare=(a:B,b:B)=>{const result=untracked(()=>equal(a,b));if(typeof result!=='boolean')throw new TypeError('Bridge equality must return a boolean');return result};
  const input:Observable<A>={get:()=>untracked(()=>source.get()),subscribe:listener=>source.subscribe(listener)};
  const selected=untracked(()=>mapObservable(input,value=>untracked(()=>selector(value)),compare));
  const target=signal(untracked(()=>selected.get()));
  if(!target||typeof target.peek!=='function'||!('value' in target))throw new TypeError('Runtime signal must implement ZyroJS value/peek');
  let active=true,stop:(()=>void)|undefined;
  connections++;
  const release=scope.add(()=>{if(!active)return;active=false;connections--;stop?.()});
  try{
   stop=scope.observe(selected,value=>{if(active&&!scope.destroyed)batch(()=>{target.value=value})});
   if(typeof stop!=='function')throw new TypeError('Observable subscribe must return a disposer');
   if(!active)stop();
  }catch(error){try{release()}catch(cleanup){throw new AggregateError([error,cleanup],'Bridge registration cleanup failed')}throw error}
  const check=()=>{assertOpen();if(!active)throw new Error('Zyro renderer conversion is disposed')};
  return Object.freeze({get value(){check();return target.value},set value(value:B){
   check();if(!write)throw new TypeError('Read-only observable conversion');
   batch(()=>{write.set(()=>value);target.value=untracked(()=>selected.get())});
  },peek(){check();return target.peek()},dispose:release});
 };
 const bridge:ZyroRendererBridge={
  read<T>(source:Observable<T>){return select(source,value=>value)},
  select<A,B>(source:Observable<A>,selector:(value:A)=>B,equal?:(a:B,b:B)=>boolean){return select(source,selector,equal)},
  write<T>(source:MutableObservable<T>){if(!source||typeof source.set!=='function')throw new TypeError('Write-through requires an explicit mutable observable');return select(source,value=>value,Object.is,source) as RendererWritable<T>},
  resource<T>(load:(signal:AbortSignal)=>Promise<T>,resourceOptions:Omit<AsyncObservableOptions<T>,'signal'>={}){
   assertOpen();if(resources>=max)throw new Error('Zyro renderer bridge resource limit exceeded');
   if(Object.hasOwn(resourceOptions,'signal'))throw new TypeError('Bridge owns resource cancellation');
   const resource=createAsyncObservable(load,{...resourceOptions,signal:lifetime.signal});resources++;
   const release=scope.add(()=>{resources--;resource.destroy()});
   return {...resource,destroy:release};
  },
  batch<T>(fn:()=>T){assertOpen();if(typeof fn!=='function')throw new TypeError('Bridge batch requires a function');return batch(fn)},
  destroy,get destroyed(){return scope.destroyed},get activeConnections(){return connections}
 };
 if(parent?.aborted)destroy();else parent?.addEventListener('abort',destroy,{once:true});
 return bridge;
}
/** Call once from defineComponent setup (or an explicit ZyroJS effect scope), never a repeated render. */
export function useZyroRendererBridge(runtime:ZyroRendererRuntime,options:ZyroRendererBridgeOptions={}):ZyroRendererBridge{
 if(!runtime||typeof runtime.useRef!=='function')throw new TypeError('ZyroJS scoped runtime primitives are required');
 const holder=runtime.useRef<ZyroRendererBridge|undefined>(undefined);
 if(!holder||typeof holder!=='object'||!('current' in holder))throw new TypeError('Runtime useRef must return a current holder');
 const bridge=createZyroRendererBridge(runtime,options);
 try{holder.current=bridge;runtime.onScopeDispose(()=>{const owned=holder.current;holder.current=undefined;owned?.destroy()})}catch(error){try{bridge.destroy()}catch(cleanup){throw new AggregateError([error,cleanup],'Bridge scope registration failed')}throw error}
 return bridge;
}
