import type {ShareData,ShareCapabilities} from './types.js';
import {createShareController} from './controller.js';
import {normalizedShareData,validatedShareUrl} from './url.js';
export function shareCapabilities():ShareCapabilities {return {native:typeof navigator!=='undefined'&&typeof navigator.share==='function',clipboard:typeof navigator!=='undefined'&&!!navigator.clipboard?.writeText};}
export async function share(data:ShareData):Promise<boolean>{const normalized=normalizedShareData(data);if(typeof navigator==='undefined'||typeof navigator.share!=='function')return false;await navigator.share(normalized);return true;}
export async function copyShareUrl(url:string):Promise<void>{const valid=validatedShareUrl(url);if(typeof navigator==='undefined'||!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');await navigator.clipboard.writeText(valid);}
export async function copyShareText(text:string):Promise<void>{if(typeof navigator==='undefined'||!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');await navigator.clipboard.writeText(text);}
export async function shareOrCopy(data:ShareData):Promise<'shared'|'copied'|'unavailable'>{
 const environment=typeof navigator==='undefined'?{}:{
  share:navigator.share?((input:ShareData)=>navigator.share(input)):undefined,
  writeText:navigator.clipboard?.writeText?((text:string)=>navigator.clipboard.writeText(text)):undefined
 };
 return createShareController(environment).share(data);
}
