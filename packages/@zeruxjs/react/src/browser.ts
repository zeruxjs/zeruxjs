import type {ReactElement} from 'react';
import type {Root} from 'react-dom/client';
import {ReactAdapterError,checkReactAbort,reactPrefix,validateReactVersions,importedDefault} from './render-errors.js';
export {ReactAdapterError} from './render-errors.js';
export interface ReactRootOptions{
 identifierPrefix?:string;signal?:AbortSignal;
 /** Receives bounded fixed-code errors. Inspect cause only in trusted host diagnostics. */
 onError?:(error:ReactAdapterError)=>void;
 /** Runs once for an accepted owner after unmount, including later preparation failure/cancellation. */
 onDispose?:()=>void;
}
export interface ReactMount{
 readonly mode:'mount'|'hydrate';readonly closed:boolean;
 readonly errors:readonly ReactAdapterError[];readonly droppedErrors:number;
 update(view:ReactElement|null):void;unmount():void;
}
const owners=new WeakMap<object,object>();
async function peers(){
 try{
  const [reactModule,clientModule,domModule]=await Promise.all([import('react'),import('react-dom/client'),import('react-dom')]);
  const React=importedDefault(reactModule),client=importedDefault(clientModule),dom=importedDefault(domModule);
  const major=validateReactVersions(React.version,dom.version);
  if(typeof React.isValidElement!=='function'||typeof client.createRoot!=='function'||typeof client.hydrateRoot!=='function')throw new ReactAdapterError('REACT_CAPABILITY_UNAVAILABLE');
  return {React,client,major};
 }catch(cause){throw cause instanceof ReactAdapterError?cause:new ReactAdapterError('REACT_DEPENDENCY_UNAVAILABLE',cause)}
}
async function open(mode:ReactMount['mode'],view:ReactElement|null,container:Element,options:ReactRootOptions):Promise<ReactMount>{
 options={...options};
 if(!container||container.nodeType!==1||!container.ownerDocument)throw new ReactAdapterError('INVALID_CONTAINER');
 if(options.onError!==undefined&&typeof options.onError!=='function'||options.onDispose!==undefined&&typeof options.onDispose!=='function')throw new ReactAdapterError('INVALID_CALLBACK');
 const prefix=options.identifierPrefix??'';reactPrefix(prefix);checkReactAbort(options.signal);
 if(owners.has(container))throw new ReactAdapterError('ROOT_ALREADY_OWNED');
 const owner={},errors:ReactAdapterError[]=[];let dropped=0,closed=false,root:Root|undefined;
 owners.set(container,owner);
 const report=(code:string,cause:unknown)=>{
  if(closed)return;
  const error=new ReactAdapterError(code,cause);if(errors.length<16)errors.push(error);else dropped++;
  try{options.onError?.(error)}catch(cause){if(errors.length<16)errors.push(new ReactAdapterError('REACT_OBSERVER_FAILED',cause));else dropped++}
 };
 const unmount=()=>{
  if(closed)return;closed=true;const native=root;root=undefined;const failures:unknown[]=[];
  try{native?.unmount()}catch(error){failures.push(error)}
  finally{
   if(owners.get(container)===owner)owners.delete(container);
   options.signal?.removeEventListener('abort',unmount);
   try{options.onDispose?.()}catch(error){failures.push(error)}
  }
  if(failures.length)throw new ReactAdapterError('REACT_UNMOUNT_FAILED',new AggregateError(failures,'React root cleanup failed'));
 };
 options.signal?.addEventListener('abort',unmount,{once:true});
 try{
  const {React,client,major}=await peers();checkReactAbort(options.signal);
  if(closed)throw new ReactAdapterError('ROOT_CLOSED');
  if(view!==null&&!React.isValidElement(view))throw new ReactAdapterError('INVALID_REACT_ELEMENT');
  const rootOptions={identifierPrefix:prefix,onRecoverableError:(error:unknown)=>report('REACT_RECOVERABLE_ERROR',error),...(major===19?{
   onCaughtError:(error:unknown)=>report('REACT_CAUGHT_ERROR',error),onUncaughtError:(error:unknown)=>report('REACT_UNCAUGHT_ERROR',error)
  }:{})};
  if(mode==='hydrate')root=client.hydrateRoot(container,view,rootOptions);
  else{root=client.createRoot(container,rootOptions);root.render(view)}
  return Object.freeze({mode,get closed(){return closed},get errors(){return Object.freeze([...errors])},get droppedErrors(){return dropped},
   update(next:ReactElement|null){if(closed||!root)throw new ReactAdapterError('ROOT_CLOSED');if(next!==null&&!React.isValidElement(next))throw new ReactAdapterError('INVALID_REACT_ELEMENT');root.render(next)},unmount});
 }catch(cause){
  try{unmount()}catch(cleanup){throw new ReactAdapterError('REACT_PREPARATION_FAILED',new AggregateError([cause,cleanup],'React root preparation failed'))}
  throw cause instanceof ReactAdapterError?cause:new ReactAdapterError('REACT_PREPARATION_FAILED',cause);
 }
}
/** Creates a native concurrent root. Resolves acquisition, not React's asynchronous commit. */
export function mountReact(view:ReactElement|null,container:Element,options:ReactRootOptions={}):Promise<ReactMount>{return open('mount',view,container,options)}
/** Adopts native React SSR output; mismatches follow installed React's recovery behavior and are recorded. */
export function hydrateReact(view:ReactElement|null,container:Element,options:ReactRootOptions={}):Promise<ReactMount>{return open('hydrate',view,container,options)}
