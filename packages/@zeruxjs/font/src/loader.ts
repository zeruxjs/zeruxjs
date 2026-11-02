import {defineFont} from './css.js';
export {createFontRegistry} from './registry.js';
export type {FontRegistry} from './registry.js';
export function injectFontStyles(css:string, doc:Document = document):()=>void { const style=doc.createElement('style');style.setAttribute('data-zerux-font','');style.textContent=css;doc.head.appendChild(style);return ()=>style.remove(); }
export interface LoadFontOptions {sample?:string;timeoutMs?:number;document?:Document;signal?:AbortSignal}
/** Cancels observation only: FontFaceSet.load has no native AbortSignal parameter. */
export async function loadFont(family:string,options:LoadFontOptions={}):Promise<boolean> {
 defineFont({family,sources:[{url:'/validation.woff2'}]});
 const timeout=options.timeoutMs??10000;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||options.sample!==undefined&&(typeof options.sample!=='string'||options.sample.length>4096))throw new RangeError('Invalid font loading bounds');
 if(options.signal?.aborted)throw new Error('Font loading cancelled');
 const doc=options.document??(typeof document!=='undefined'?document:undefined);if(!doc?.fonts)return false;
 let handle:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{return await Promise.race([
  Promise.resolve().then(()=>{if(options.signal?.aborted)throw new Error('Font loading cancelled');return doc.fonts.load(`16px ${JSON.stringify(family)}`,options.sample);}).then(result=>result.length>0,()=>{throw new Error('Font loading failed');}),
  new Promise<boolean>((_,reject)=>{handle=setTimeout(()=>reject(new Error('Font loading timed out')),timeout);abort=()=>reject(new Error('Font loading cancelled'));options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();})
 ]);}finally{if(handle)clearTimeout(handle);if(abort)options.signal?.removeEventListener('abort',abort);}
}
/** Per-mount observer ownership; never removes host/CSS-owned font faces. */
export function createFontLoadScope(options:{document?:Document;maxPending?:number}={}){
 const max=options.maxPending??8;if(!Number.isSafeInteger(max)||max<1||max>64)throw new RangeError('Invalid font loading concurrency');
 const pending=new Set<AbortController>();let disposed=false;
 return {load(family:string,input:Omit<LoadFontOptions,'document'>={}){
  if(disposed)return Promise.reject(new Error('Font loading scope disposed'));
  if(pending.size>=max)return Promise.reject(new Error('Font loading concurrency exceeded'));
  const controller=new AbortController(),abort=()=>controller.abort();pending.add(controller);
  input.signal?.addEventListener('abort',abort,{once:true});if(input.signal?.aborted)abort();
  return loadFont(family,{...input,document:options.document,signal:controller.signal}).finally(()=>{pending.delete(controller);input.signal?.removeEventListener('abort',abort);});
 },dispose(){if(disposed)return;disposed=true;for(const controller of pending)controller.abort();},get pendingCount(){return pending.size;}};
}
