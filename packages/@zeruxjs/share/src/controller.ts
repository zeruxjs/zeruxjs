import type {ShareData} from './types.js';
import {normalizedShareData} from './url.js';
export interface ShareEnvironment {
 share?:(data:ShareData)=>Promise<void>;writeText?:(text:string)=>Promise<void>;open?:(url:string)=>void;
}
/** Explicitly injected browser behavior, usable in SSR without touching navigator. */
export function createShareController(environment:ShareEnvironment,options:{copyFallback?:boolean;onResult?:(result:'shared'|'copied'|'unavailable')=>void}={}){
 return{get capabilities(){return{native:typeof environment.share==='function',clipboard:typeof environment.writeText==='function'}},
  async share(data:ShareData):Promise<'shared'|'copied'|'unavailable'>{const normalized=normalizedShareData(data);
   // AbortError is a deliberate user cancellation: never open a popup or copy unexpectedly.
   if(environment.share){try{await environment.share(normalized);options.onResult?.('shared');return 'shared'}
    catch(error){if((error as {name?:string})?.name==='AbortError')throw error;
     if((error as {name?:string})?.name!=='NotAllowedError'&&(error as {name?:string})?.name!=='NotSupportedError')throw error;
    }}
   if(options.copyFallback!==false&&environment.writeText){await environment.writeText(normalized.url);options.onResult?.('copied');return 'copied'}
   options.onResult?.('unavailable');return 'unavailable';
  }};
}
