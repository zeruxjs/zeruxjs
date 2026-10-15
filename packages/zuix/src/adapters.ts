import {createZuix} from './compiler.js';
import {extractClasses} from './scanner.js';
import type {ZuixConfig} from './types.js';
/** Vite integration with per-module replacement, removal and build invalidation. */
export function zuixVite(config:ZuixConfig={}){
 const virtualId='virtual:zuix.css',resolved='\0'+virtualId;
 const modules=new Map<string,Set<string>>();
 let scanned=new Set<string>();
 let server: {moduleGraph:{getModuleById(id:string):unknown;invalidateModule(module:unknown):void};ws:{send(message:unknown):void}}|undefined;
 const generate=()=>createZuix(config).generate(new Set([...scanned,...modules.values()].flatMap(value=>typeof value==='string'?[value]:[...value]))).css;
 const invalidate=()=>{const mod=server?.moduleGraph.getModuleById(resolved);if(mod){server?.moduleGraph.invalidateModule(mod);server?.ws.send({type:'full-reload'});}};
 return {name:'zuix',enforce:'pre' as const,
  async buildStart(){const {scanProject}=await import('./node.js');scanned=new Set(scanProject(process.cwd(),config));},
  configureServer(s:typeof server){server=s;},
  resolveId(id:string){return id===virtualId?resolved:null;},
  load(id:string){return id===resolved?generate():null;},
  transform(code:string,id:string){if(/\.(tsx?|jsx?|vue|svelte|astro|html)(?:\?.*)?$/.test(id)){
   const next=new Set(extractClasses(code));const old=modules.get(id);
   if(!old||next.size!==old.size||[...next].some(c=>!old.has(c))){modules.set(id,next);invalidate();}
  }return null;},
  watchChange(id:string,change:{event:string}){if(change.event==='delete'&&modules.delete(id))invalidate();},
  handleHotUpdate(ctx:{file:string}){if(!modules.has(ctx.file))return;invalidate();}
 };
}
/** Browser-only injection; call cleanup on unmount. */
export function injectZuix(classes:Iterable<string>,config:ZuixConfig={}):()=>void {
 if(typeof document==='undefined')return ()=>{};
 const style=document.createElement('style');style.setAttribute('data-zuix','');style.textContent=createZuix(config).generate(classes).css;document.head.appendChild(style);return ()=>style.remove();
}
/** Safe inline SSR style tag (class inputs must be trusted). */
export function renderZuixStyle(classes:Iterable<string>,config:ZuixConfig={}):string {
 const css=createZuix(config).generate(classes).css.replace(/<\/style/gi,'<\\/style');return `<style data-zuix>${css}</style>`;
}
