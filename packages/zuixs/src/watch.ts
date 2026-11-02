import fs from 'node:fs';
import path from 'node:path';
import { resolveLimits } from "./safety.js";
import { createProjectScanner, buildFromFiles, buildStylesheetFromFiles, outputPath } from './node-build.js';
import type { ZuixConfig, GenerateResult } from './types.js';

export interface ZuixWatchOptions {
 /** Project-relative directory roots; default ['.']. Scheduling identity alone is shared. */
 roots?: readonly string[];
 /** Project-relative path prefixes, never glob evaluation. */
 ignored?: readonly string[];
 debounceMs?: number; pollIntervalMs?: number; pollingOnly?: boolean;
 maxEntries?: number; maxPendingEvents?: number;
 signal?: AbortSignal;
 input?: string;
 configFile?: string;
 /** Trusted configuration loader, invoked only after that declared file changes. */
 loadConfig?: (context:{signal:AbortSignal})=>Promise<ZuixConfig>;
 maxConfigReloads?: number;
}
/** Callable legacy disposer, with explicit awaitable startup/drain and host-driven reload. */
export interface ZuixWatchHandle {
 ():void;
 readonly ready:Promise<void>; readonly closed:Promise<void>;
 flush():Promise<void>;
 reload(config:ZuixConfig):Promise<void>;
}

/** Copy application-owned data while retaining explicitly executable plugin functions.
 * Subscribers never share mutable configuration, caches, or callbacks with another app.
 */
function snapshot<T>(value:T):T {
 let count=0;
 const copy=(input:unknown,depth:number):unknown=>{
  if(++count>100000||depth>24)throw new Error('zuix: configuration bounds exceeded');
  if(input===null||typeof input!=='object')return input;
  if(!Array.isArray(input)&&![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new Error('zuix: configuration must be plain data/functions');
  const result:Record<string,unknown>|unknown[]=Array.isArray(input)?[]:Object.create(null);
  for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))){
   if(key==='length'&&Array.isArray(input))continue;
   if(!Object.hasOwn(descriptor,'value')||['__proto__','constructor','prototype'].includes(key))throw new Error('zuix: invalid configuration property');
   Object.defineProperty(result,key,{value:copy(descriptor.value,depth+1),enumerable:true});
  }
  return Object.freeze(result);
 };
 return copy(value,0) as T;
}

/** Watch trusted source roots through optional zlook. Synchronous initial compilation preserves
 * the old callback API; ready owns watcher startup, closed owns subscription/config-loader drain.
 */
export function watchZuix(root=process.cwd(),initial:ZuixConfig={},onBuild?:(result:GenerateResult)=>void,onError?:(error:unknown)=>void,options:ZuixWatchOptions={}):ZuixWatchHandle {
 const absolute=fs.realpathSync(path.resolve(root));
 if(!fs.statSync(absolute).isDirectory())throw new Error('zuix: watch root must be a directory');
 if(options.roots!==undefined&&!Array.isArray(options.roots)||options.ignored!==undefined&&!Array.isArray(options.ignored))throw new Error('zuix: invalid watch roots/ignores');
 const settings={...options,roots:[...(options.roots??['.'])],ignored:[...(options.ignored??[])]};
 if(!settings.roots.length||settings.roots.length>32||settings.ignored.length>128)throw new Error('zuix: invalid watch roots/ignores');
 const debounce=settings.debounceMs??60,poll=settings.pollIntervalMs??500,reloadLimit=settings.maxConfigReloads??128;
 if(!Number.isInteger(debounce)||debounce<0||debounce>600000||!Number.isInteger(poll)||poll<100||poll>600000||!Number.isInteger(reloadLimit)||reloadLimit<1||reloadLimit>1024)throw new Error('zuix: invalid watch scheduling limits');
 for(const [name,maximum] of [['maxEntries',1000000],['maxPendingEvents',100000]] as const){const value=settings[name];if(value!==undefined&&(!Number.isInteger(value)||value<1||value>maximum))throw new Error('zuix: invalid watch resource limit');}
 if(settings.pollingOnly!==undefined&&typeof settings.pollingOnly!=='boolean')throw new Error('zuix: invalid pollingOnly');
 if(settings.signal!==undefined&&!(settings.signal instanceof AbortSignal))throw new Error('zuix: invalid watch signal');
 if(settings.loadConfig!==undefined&&typeof settings.loadConfig!=='function')throw new Error('zuix: invalid config loader');
 if(Boolean(settings.configFile)!==Boolean(settings.loadConfig))throw new Error('zuix: configFile and loadConfig must be supplied together');
 const resolve=(name:string)=>name==='.'?absolute:outputPath(absolute,name);
 const roots=[...new Set(settings.roots.map(name=>resolve(name)))];
 for(const location of roots)if(!fs.statSync(location).isDirectory())throw new Error('zuix: watch roots must be existing directories');
 const ignored=settings.ignored.map(name=>resolve(name));
 const configPath=settings.configFile?resolve(settings.configFile):undefined;
 const input=settings.input?resolve(settings.input):undefined;
 for(const file of [configPath,input])if(file&&!roots.some(dir=>file.startsWith(dir+path.sep)))throw new Error('zuix: config/input must be covered by watch roots');
 let config=snapshot(initial),scanner=createProjectScanner(absolute,config),previous='',closed=false,timer:ReturnType<typeof setTimeout>|undefined;
 let work:Promise<void>=Promise.resolve(),reloads=0,configDirty=false;
 const controller=new AbortController();
 const handles:import('zlook').WatchHandle[]=[];
 const outputFiles=new Set<string>(),outputDirs=new Set<string>();
 const rememberOutputs=(candidate:ZuixConfig)=>{
  const output=outputPath(absolute,candidate.output??'zuix.css');outputFiles.add(output);outputFiles.add(output+'.map');
  if(candidate.buildManifest)outputFiles.add(outputPath(absolute,candidate.buildManifest.file));
  if(candidate.perFile)outputDirs.add(outputPath(absolute,typeof candidate.perFile==='object'?candidate.perFile.dir??'zuix-files':'zuix-files'));
 };
 const report=(error:unknown)=>{try{if(onError)onError(error);else console.error('[zuix] watch:',error);}catch(callbackError){console.error('[zuix] watch error callback:',callbackError);}};
 const build=(candidate:ZuixConfig,candidateScanner:ReturnType<typeof createProjectScanner>,force=false)=>{
  if(input&&candidate.perFile)throw new Error('zuix: CSS entries do not support per-file output');
  rememberOutputs(candidate);
  const files=candidateScanner.scan();
  if(input&&fs.statSync(input).size>resolveLimits(candidate.limits).maxFileBytes)throw new Error('zuix: invalid CSS entry size');
  const entry=input?fs.readFileSync(input,'utf8'):'';
  const signature=JSON.stringify([...files])+entry;
  if(!force&&signature===previous)return;
  const result=input?buildStylesheetFromFiles(absolute,path.relative(absolute,input),candidate,files):buildFromFiles(absolute,candidate,files);
  previous=signature;
  try{onBuild?.(result);}catch(error){report(error);}
 };
 rememberOutputs(config);
 const activate=(candidate:ZuixConfig)=>{
  const next=snapshot(candidate),nextScanner=createProjectScanner(absolute,next);
  build(next,nextScanner,true);
  scanner.clear();config=next;scanner=nextScanner;
 };
 const reconcile=async()=>{
  if(closed)return;
  if(configDirty&&settings.loadConfig){
   configDirty=false;if(++reloads>reloadLimit)throw new Error('zuix: config reload limit exceeded; recreate watcher');
   const candidate=await settings.loadConfig({signal:controller.signal});
   if(closed)return;activate(candidate);
  }else build(config,scanner);
 };
 let queued=false,trailing=false;
 const enqueue=()=>{
  if(queued){trailing=true;return work;}
  queued=true;
  work=work.then(async()=>{do{trailing=false;await reconcile();}while(trailing&&!closed);}).catch(report).finally(()=>{queued=false;});
  return work;
 };
 const schedule=()=>{if(closed)return;if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void enqueue();},debounce);};
 let finishClosed!:()=>void;
 const settled=new Promise<void>(resolve=>{finishClosed=resolve;});
 const stop=(()=>{
  if(closed)return;closed=true;controller.abort();if(timer)clearTimeout(timer);timer=undefined;
  settings.signal?.removeEventListener('abort',stop);
  for(const handle of handles)handle.close();scanner.clear();
  void Promise.allSettled([ready,work,...handles.map(handle=>handle.closed)]).then(()=>finishClosed());
 }) as ZuixWatchHandle;
 const ready=Promise.resolve().then(async()=>{
  if(closed)return;
  const {watchDirectory}=await import('zlook');if(closed)return;
  try{
   for(const location of roots){
    const handle=watchDirectory(location,event=>{
     const file=path.join(location,event.file),relative=path.relative(absolute,file).split(path.sep).join('/');
     scanner.invalidate(relative);if(file===configPath)configDirty=true;schedule();
    },{
     debounceMs:debounce,pollIntervalMs:poll,pollingOnly:settings.pollingOnly??false,
     maxEntries:settings.maxEntries??100000,maxPendingEvents:settings.maxPendingEvents??4096,
     signal:controller.signal,
     ignored:relative=>{
      const file=path.join(location,relative);
      if(file===configPath||file===input)return false;
      return relative.split('/').some(part=>['node_modules','.git','.svn','dist','build','.zerux','.cache','.zuix','.output','coverage','.next','.nuxt'].includes(part)||part.startsWith('.env')||part.startsWith('.zuix-'))||outputFiles.has(file)||[...outputDirs,...ignored].some(dir=>file===dir||file.startsWith(dir+path.sep));
     },
     onError:error=>{scanner.clear();report(error);schedule();},
    });handles.push(handle);
   }
   await Promise.all(handles.map(handle=>handle.ready));
   if(!closed){scanner.clear();await enqueue();}
  }catch(error){for(const handle of handles)handle.close();throw error;}
 });
 void ready.catch(error=>{report(error);stop();});
 Object.defineProperties(stop,{
  ready:{value:ready},closed:{value:settled},
  flush:{value:async()=>{await ready;if(closed)return;await Promise.all(handles.map(handle=>handle.flush()));if(timer)clearTimeout(timer);timer=undefined;await enqueue();}},
  reload:{value:(candidate:ZuixConfig)=>{
   const job=work.then(()=>{if(closed)throw new Error('zuix: watcher closed');activate(candidate);});
   work=job.catch(()=>{});return job;
  }},
 });
 // Aborted startup does not compile or allocate an underlying subscription.
 if(settings.signal?.aborted)stop();else{
  settings.signal?.addEventListener('abort',stop,{once:true});
  try{build(config,scanner);}catch(error){report(error);}
 }
 return stop;
}
