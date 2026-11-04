import { createHash } from 'node:crypto';
import type { FontRegistry } from './registry.js';
export interface FontStylesheetOptions { registry: FontRegistry; cacheSeconds?:number; preloadKeys?:string[]; maxPreloads?:number }
/** A bounded HTTP stylesheet endpoint. Does not fetch remote font bytes. */
export function createFontStylesheetHandler(options:FontStylesheetOptions):(request:Request)=>Response {
 const ttl=options.cacheSeconds??300;
 if(!Number.isSafeInteger(ttl)||ttl<0||ttl>31536000)throw new RangeError('Invalid stylesheet cache lifetime');
 const maxPreloads=options.maxPreloads??16;
 if(!Number.isSafeInteger(maxPreloads)||maxPreloads<0||maxPreloads>16||options.preloadKeys!==undefined&&(!Array.isArray(options.preloadKeys)||options.preloadKeys.length>64))throw new RangeError('Invalid stylesheet preload budget');
 const preloadKeys=options.preloadKeys?[...options.preloadKeys]:undefined;
 return(request)=>{
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
  const css=options.registry.css();
  const headers=new Headers({'content-type':'text/css; charset=utf-8','x-content-type-options':'nosniff','cache-control':`public, max-age=${ttl}`});
  const etag=`"${createHash('sha256').update(css).digest('base64url')}"`;
  headers.set('etag',etag);
  if(preloadKeys?.length){
   const selected=new Set(preloadKeys);
   const links=[...new Set(options.registry.entries().filter(([key])=>selected.has(key)).flatMap(([,font])=>font.sources.filter(s=>!s.url.startsWith('data:')).map(s=>`<${s.url}>; rel=preload; as=font; crossorigin`)))];
   if(links.length>maxPreloads)throw new RangeError('Font preload budget exceeded');
   if(links.length)headers.set('link',links.join(', '));
  }
  if(request.headers.get('if-none-match')?.split(',').some(tag=>tag.trim()===etag||tag.trim()==='*'))return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:css,{headers});
 };
}
