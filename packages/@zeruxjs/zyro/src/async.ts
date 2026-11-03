import {createObservable, type Observable} from './observable.js';
export type AsyncState<T> = {status:'idle'|'loading'|'success'|'error'; data:T|undefined; error:unknown; updatedAt:number};
export interface AsyncObservable<T> extends Observable<AsyncState<T>> {
 refresh():Promise<T|undefined>; cancel():void; reset():void; destroy():void;
}
export interface AsyncObservableOptions<T> {initial?:T;timeoutMs?:number;signal?:AbortSignal;maxPending?:number}
const aborted = (cause?:unknown) => Object.assign(new Error('Async observable aborted',{cause}),{name:'AbortError'});
/** Latest-request-wins state. Cancellation is cooperative; unsettled loaders keep their pending slots. */
export function createAsyncObservable<T>(load:(signal:AbortSignal)=>Promise<T>,options:AsyncObservableOptions<T>={}):AsyncObservable<T>{
 if(typeof load!=='function')throw new TypeError('Async observable requires a loader');
 if(options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>300000))throw new RangeError('Invalid timeout');
 const maxPending=options.maxPending??8,parent=options.signal;
 if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>128)throw new RangeError('Invalid pending limit');
 if(parent!==undefined&&(!(parent instanceof AbortSignal)))throw new TypeError('Invalid abort signal');
 const state=createObservable<AsyncState<T>>({status:options.initial===undefined?'idle':'success',data:options.initial,error:undefined,updatedAt:0});
 let active:AbortController|undefined,activeTimer:ReturnType<typeof setTimeout>|undefined,sequence=0,disposed=false,pending=0;
 const cancelActive=(reason?:unknown)=>{sequence++;const previous=active;active=undefined;if(activeTimer!==undefined)clearTimeout(activeTimer);activeTimer=undefined;previous?.abort(reason);};
 const cancel=(reason?:unknown)=>{const expected=sequence+1;cancelActive(reason);if(!disposed&&sequence===expected&&state.get().status==='loading')state.set(s=>({...s,status:'idle',error:undefined}));};
 const parentAbort=()=>cancel(parent?.reason);
 parent?.addEventListener('abort',parentAbort,{once:true});
 return {get:state.get,subscribe:state.subscribe,cancel,
  async refresh(){
   if(disposed)throw new Error('Async observable is destroyed');
   if(parent?.aborted)throw aborted(parent.reason);
   if(pending>=maxPending)throw new Error('Async observable pending limit exceeded');
   const expected=sequence+1;
   cancelActive();
   // Aborting the previous loader may synchronously start a newer refresh from its listener.
   if(disposed||sequence!==expected||parent?.aborted)throw aborted(parent?.reason);
   const id=sequence,controller=new AbortController();active=controller;pending++;
   const timer=options.timeoutMs===undefined?undefined:setTimeout(()=>{
    if(active===controller){controller.abort(aborted());if(!disposed&&id===sequence)state.set(s=>({...s,status:'idle',error:undefined}));}
   },options.timeoutMs);
   activeTimer=timer;
   try{
    state.set(s=>({...s,status:'loading',error:undefined}));
    // An observer may synchronously cancel/destroy the resource during the loading notification.
    if(disposed||id!==sequence||controller.signal.aborted)throw aborted();
    const result=await load(controller.signal);
    if(!disposed&&id===sequence&&!controller.signal.aborted)state.set({status:'success',data:result,error:undefined,updatedAt:Date.now()});
    // Compatibility: old refresh promises can resolve even when their result was fenced from state.
    return result;
   }catch(error){
    if(!disposed&&id===sequence)state.set(s=>({...s,status:controller.signal.aborted?'idle':'error',error:controller.signal.aborted?undefined:error}));
    throw error;
   }finally{if(timer!==undefined)clearTimeout(timer);if(activeTimer===timer)activeTimer=undefined;pending--;if(active===controller)active=undefined;}
  },
  reset(){const expected=sequence+1;cancelActive();if(!disposed&&sequence===expected)state.set({status:'idle',data:options.initial,error:undefined,updatedAt:0});},
  destroy(){if(disposed)return;disposed=true;parent?.removeEventListener('abort',parentAbort);try{cancelActive();}finally{state.destroy();}}
 };
}
