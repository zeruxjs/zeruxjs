import {createObservable, type Observable} from './observable.js';
export type AsyncState<T> = {status:'idle'|'loading'|'success'|'error'; data:T|undefined; error:unknown; updatedAt:number};
export interface AsyncObservable<T> extends Observable<AsyncState<T>> {
 refresh():Promise<T|undefined>; cancel():void; reset():void; destroy():void;
}
/** Latest-request-wins async resource with true AbortSignal propagation and no stale response commits. */
export function createAsyncObservable<T>(load:(signal:AbortSignal)=>Promise<T>,options:{initial?:T;timeoutMs?:number}={}):AsyncObservable<T>{
 if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<=0))throw new RangeError('Invalid timeout');
 const state=createObservable<AsyncState<T>>({status: options.initial===undefined?'idle':'success',data:options.initial,error:undefined,updatedAt:0});
 let active:AbortController|undefined, sequence=0, disposed=false;
 const cancel=()=>{sequence++;active?.abort();active=undefined};
 return {get:state.get,subscribe:state.subscribe,cancel(){cancel();if(!disposed&&state.get().status==='loading')state.set(s=>({...s,status:'idle'}))},
  async refresh(){if(disposed)throw new Error('Async observable is destroyed');cancel();const id=sequence,controller=new AbortController();active=controller;
   state.set(s=>({...s,status:'loading',error:undefined}));
   const timer=options.timeoutMs===undefined?undefined:setTimeout(()=>controller.abort(),options.timeoutMs);
   try{const result=await load(controller.signal);if(!disposed&&id===sequence&&!controller.signal.aborted)state.set({status:'success',data:result,error:undefined,updatedAt:Date.now()});return result}
   catch(error){if(!disposed&&id===sequence){state.set(s=>({...s,status:controller.signal.aborted?'idle':'error',error:controller.signal.aborted?undefined:error}))}throw error}
   finally{if(timer)clearTimeout(timer);if(active===controller)active=undefined}
  },reset(){cancel();if(!disposed)state.set({status:'idle',data:options.initial,error:undefined,updatedAt:0})},
  destroy(){disposed=true;cancel();state.destroy()}};
}
