import {serializeJsonForScript} from '@zeruxjs/security/encoding';
import {createReactStore,type WritableExternalStore} from './store.js';
import {ReactAdapterError,reactByteLimit,reactPrefix} from './render-errors.js';
export {ReactAdapterError} from './render-errors.js';
export interface ReactStatePolicy<T>{validateState:(input:unknown)=>T;maxBytes?:number}
export interface ReactHydrationState<T>{readonly version:1;readonly identifierPrefix:string;readonly data:string;readonly store:WritableExternalStore<T>;dispose():void}
function limit(value:unknown){const bytes=reactByteLimit(value,65536);if(bytes>1048576)throw new ReactAdapterError('STATE_BYTE_LIMIT');return bytes;}
/** JSON-only, immutable public projection. No getters/toJSON or implicit JSON omission/coercion. */
function snapshot<T>(input:unknown,policy:ReactStatePolicy<T>,bytes:number):T{
 if(!policy||typeof policy.validateState!=='function')throw new ReactAdapterError('STATE_VALIDATOR_REQUIRED');
 let value:T;try{value=policy.validateState(input);}catch(cause){throw new ReactAdapterError('STATE_VALIDATION_FAILED',cause);}
 let entries=0,size=0;const ancestors=new Set<object>();
 const text=(value:string)=>{size+=new TextEncoder().encode(value).length;if(size>bytes)throw new ReactAdapterError('STATE_BYTE_LIMIT');};
 const visit=(value:unknown,depth:number):unknown=>{
  if(++entries>4096||depth>16)throw new ReactAdapterError('STATE_STRUCTURE_LIMIT');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return Object.is(value,-0)?0:value;
  if(typeof value==='string'){if(value.length>bytes)throw new ReactAdapterError('STATE_BYTE_LIMIT');text(value);return value;}
  if(!value||typeof value!=='object'||ancestors.has(value))throw new ReactAdapterError('INVALID_PUBLIC_STATE');
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
  if(!array&&proto!==Object.prototype&&proto!==null)throw new ReactAdapterError('INVALID_PUBLIC_STATE');
  const keys=Reflect.ownKeys(value);if(keys.length>4097||array&&value.length>4096)throw new ReactAdapterError('STATE_STRUCTURE_LIMIT');
  ancestors.add(value);const result:any=array?[]:Object.create(null);
  for(const key of keys){
   if(array&&key==='length')continue;
   if(typeof key!=='string'||key.length>256||/^(?:__proto__|prototype|constructor|toJSON)$/i.test(key)||/(?:password|secret|token|credential|authorization|cookie|privatekey|apikey)/i.test(key))throw new ReactAdapterError('PRIVATE_STATE_KEY');
   const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
   if(!descriptor.enumerable||!('value'in descriptor)||array&&!/^(0|[1-9][0-9]*)$/.test(key))throw new ReactAdapterError('INVALID_PUBLIC_STATE');
   text(key);result[key]=visit(descriptor.value,depth+1);
  }
  if(array&&(result.length!==value.length||Object.keys(result).length!==value.length))throw new ReactAdapterError('INVALID_PUBLIC_STATE');
  ancestors.delete(value);return Object.freeze(result);
 };
 return visit(value,0) as T;
}
function owned<T>(state:T,identifierPrefix:string,maxBytes:number):ReactHydrationState<T>{
 const data=serializeJsonForScript({version:1,identifierPrefix,state});
 if(new TextEncoder().encode(data).length>maxBytes)throw new ReactAdapterError('STATE_BYTE_LIMIT');
 const store=createReactStore(state,{serverSnapshot:state});
 return Object.freeze({version:1 as const,identifierPrefix,data,store,dispose:()=>store.destroy()});
}
/** A new request-owned store whose pinned getServerSnapshot is exactly the independently script-encoded state. */
export function createReactHydrationState<T>(input:unknown,options:ReactStatePolicy<T>&{identifierPrefix:string}):ReactHydrationState<T>{
 reactPrefix(options?.identifierPrefix,true);const max=limit(options.maxBytes);
 return owned(snapshot(input,options,max),options.identifierPrefix,max);
}
/** Restore the exact payload; non-idempotent validation/transforms reject instead of silently changing hydration state. */
export function readReactHydrationState<T>(data:string,options:ReactStatePolicy<T>):ReactHydrationState<T>{
 const max=limit(options?.maxBytes);
 if(typeof data!=='string'||data.length>max||new TextEncoder().encode(data).length>max)throw new ReactAdapterError('STATE_BYTE_LIMIT');
 let parsed:any;try{parsed=JSON.parse(data);}catch(cause){throw new ReactAdapterError('INVALID_STATE_JSON',cause);}
 if(!parsed||parsed.version!==1||Object.keys(parsed).sort().join(',')!=='identifierPrefix,state,version')throw new ReactAdapterError('INVALID_STATE_VERSION');
 reactPrefix(parsed.identifierPrefix,true);
 const state=snapshot(parsed.state,options,max);
 if(JSON.stringify(state)!==JSON.stringify(parsed.state))throw new ReactAdapterError('HYDRATION_STATE_CHANGED');
 return owned(state,parsed.identifierPrefix,max);
}
