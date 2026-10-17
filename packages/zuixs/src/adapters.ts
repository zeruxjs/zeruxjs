import {createZuix} from './compiler.js';
import {extractClasses} from './scanner.js';
import type {ZuixConfig} from './types.js';
/** Framework-neutral Vite 5+ plugin. React/Vue/Svelte/Astro work through Vite compilation. */
export function zuixVite(config:ZuixConfig={}){
 const virtualId='virtual:zuix.css',resolved='\0'+virtualId;
 const modules=new Map<string,Set<string>>();
 let scanned=new Map<string,string[]>(),root='';
 let server:{moduleGraph:{getModuleById(id:string):unknown;invalidateModule(module:unknown):void};ws:{send(message:unknown):void}}|undefined;
 const relative=(id:string)=>{
  const pathname=id.split('?')[0].replace(/\\/g,'/');if(!root||!pathname.startsWith(root+'/'))return null;
  return pathname.slice(root.length+1);
 };
 const generate=()=>{
  const tokens=new Set<string>();
  for(const [file,values] of scanned)if(!modules.has(file))for(const value of values)tokens.add(value);
  for(const values of modules.values())for(const value of values)tokens.add(value);
  return createZuix(config).generate(tokens).css;
 };
 const invalidate=()=>{const mod=server?.moduleGraph.getModuleById(resolved);if(mod){server?.moduleGraph.invalidateModule(mod);server?.ws.send({type:'full-reload'});}};
 const refresh=async()=>{const {scanProjectFiles}=await import('./node.js');scanned=scanProjectFiles(root,config);invalidate();};
 return {name:'zuix',enforce:'pre' as const,
  configResolved(resolvedConfig:{root:string}){root=resolvedConfig.root.replace(/\\/g,'/').replace(/\/$/,'');},
  async buildStart(){await refresh();},
  configureServer(s:typeof server){server=s;},
  resolveId(id:string){return id===virtualId?resolved:null;},
  load(id:string){return id===resolved?generate():null;},
  transform(code:string,id:string){if(!/\.(?:tsx?|jsx?|vue|svelte|astro|html)(?:\?.*)?$/.test(id))return null;
   const file=relative(id);if(!file)return null;
   const next=new Set(extractClasses(code));const old=modules.get(file);
   if(!old||next.size!==old.size||[...next].some(c=>!old.has(c))){modules.set(file,next);invalidate();}
   return null;
  },
  watchChange(id:string,change:{event:string}){const file=relative(id);if(!file)return;
   if(change.event==='delete'){modules.delete(file);scanned.delete(file);invalidate();}
   else if(change.event==='create'){return refresh();}
  },
  handleHotUpdate(ctx:{file:string}){const file=relative(ctx.file);if(file&&modules.has(file))invalidate();},
  closeBundle(){modules.clear();scanned.clear();server=undefined;}
 };
}
/** Browser-only injection; call cleanup on unmount. */
export function injectZuix(classes:Iterable<string>,config:ZuixConfig={}):()=>void {
 if(typeof document==='undefined')return ()=>{};
 const style=document.createElement('style');style.setAttribute('data-zuix','');style.textContent=createZuix(config).generate(classes).css;document.head.appendChild(style);return ()=>style.remove();
}
/** Escaped inline SSR style. Prefer a nonce/external CSS for strict CSP. */
export function renderZuixStyle(classes:Iterable<string>,config:ZuixConfig={}):string {
 const css=createZuix(config).generate(classes).css.replace(/<\/style/gi,'<\\/style');return `<style data-zuix>${css}</style>`;
}
