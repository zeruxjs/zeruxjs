import fs from 'node:fs';
import path from 'node:path';
import {createZuix} from './compiler.js';
import {extractClasses} from './scanner.js';
import {resolveLimits} from './safety.js';
import type {ZuixConfig,GenerateResult} from './types.js';

const supported=/\.(?:html?|jsx?|tsx?|vue|svelte|astro|mdx?)$/i;
const defaultExcluded=new Set(['node_modules','.git','dist','build','.next','.nuxt','.zerux','.output','coverage','.cache']);
function globRegex(pattern:string):RegExp {
 let s='^';const normalized=pattern.replace(/\\/g,'/').replace(/^\.\//,'');
 if(normalized.length>500)throw new Error('zuix: glob too long');
 for(let i=0;i<normalized.length;i++){
  const ch=normalized[i];if(ch==='*'){if(normalized[i+1]==='*'){i++;if(normalized[i+1]==='/'){i++;s+='(?:.*/)?';}else s+='.*';}else s+='[^/]*';}
  else if(ch==='?')s+='[^/]';else s+=ch.replace(/[.+^${}()|[\]\\]/g,'\\$&');
 }
 return new RegExp(s+'$');
}
function expandBraces(pattern:string):string[]{
 const match=/\{([^{}]+)\}/.exec(pattern);if(!match)return [pattern];
 const results=match[1].split(',').flatMap(part=>expandBraces(pattern.slice(0,match.index)+part+pattern.slice(match.index+match[0].length)));
 if(results.length>100)throw new Error('zuix: too many content globs');return results;
}
export function createProjectScanner(root:string,config:ZuixConfig={}) {
 const absoluteRoot=path.resolve(root),limits=resolveLimits(config.limits);
 const patterns=(config.content?.length?config.content:['**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}']).flatMap(expandBraces).map(globRegex);
 const excluded=(config.exclude??[]).flatMap(expandBraces).map(globRegex);
 const cache=new Map<string,{size:number;mtimeMs:number;classes:string[]}>();
 const perFileDir=config.perFile?path.resolve(absoluteRoot,typeof config.perFile==='object'?(config.perFile.dir??'zuix-files'):'zuix-files'):'';
 function scan():Map<string,string[]> {
  const files=new Map<string,string[]>();let totalBytes=0,visited=0;
  const nextCache=new Map<string,{size:number;mtimeMs:number;classes:string[]}>();
  function visit(dir:string):void {
   for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(++visited>limits.maxFiles*20)throw new Error('zuix: directory traversal limit exceeded');
    if(entry.isSymbolicLink()||defaultExcluded.has(entry.name)||entry.name.startsWith('.env'))continue;
    const abs=path.join(dir,entry.name),rel=path.relative(absoluteRoot,abs).split(path.sep).join('/');
    if(excluded.some(p=>p.test(rel)))continue;
    if(entry.isDirectory()){
     if(abs===perFileDir)continue;
     visit(abs);
    }else if(entry.isFile()&&supported.test(entry.name)&&patterns.some(p=>p.test(rel))){
     if(files.size>=limits.maxFiles)throw new Error('zuix: maxFiles limit exceeded');
     const stat=fs.statSync(abs);if(stat.size>limits.maxFileBytes)throw new Error(`zuix: maxFileBytes exceeded: ${rel}`);
     totalBytes+=stat.size;if(totalBytes>limits.maxTotalBytes)throw new Error('zuix: maxTotalBytes limit exceeded');
     const old=cache.get(rel);
     const classes=old&&old.size===stat.size&&old.mtimeMs===stat.mtimeMs?old.classes:extractClasses(fs.readFileSync(abs,'utf8'));
     files.set(rel,classes);nextCache.set(rel,{size:stat.size,mtimeMs:stat.mtimeMs,classes});
    }
   }
  }
  visit(absoluteRoot);cache.clear();for(const [key,value] of nextCache)cache.set(key,value);
  return files;
 }
 return {scan,clear:()=>cache.clear()};
}
export function scanProjectFiles(root:string,config:ZuixConfig={}):Map<string,string[]> {return createProjectScanner(root,config).scan();}
export function scanProject(root:string,config:ZuixConfig={}):string[] {return [...new Set([...scanProjectFiles(root,config).values()].flat())];}
function inside(root:string,location:string):boolean {const relative=path.relative(root,location);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function outputPath(root:string,target:string):string {
 const location=path.resolve(root,target);
 if(!inside(path.resolve(root),location))throw new Error('zuix: output must remain inside project root');
 let current=path.resolve(root);
 for(const segment of path.relative(current,location).split(path.sep)){
  current=path.join(current,segment);
  try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('zuix: symlink output path denied');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 return location;
}
function writeIfChanged(file:string,content:string):void {
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error(`zuix: refusing symlink output ${file}`);
 if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)fs.writeFileSync(file,content);
}
function buildFromFiles(root:string,config:ZuixConfig,files:Map<string,string[]>):GenerateResult {
 const result=createZuix(config).generate(new Set([...files.values()].flat()));
 const settings=typeof config.perFile==='object'?config.perFile:{};
 if(!config.perFile||settings.shared!==false){writeIfChanged(outputPath(root,config.output??'zuix.css'),result.css+'\n');}
 if(config.perFile){
  const directory=outputPath(root,settings.dir??'zuix-files');
  const manifest:Record<string,string>=Object.create(null);
  for(const [source,classes] of files){
   const dest=outputPath(root,path.join(directory,source+'.css'));
   if(!inside(directory,dest))throw new Error('zuix: invalid source filename');
   const css=createZuix({...config,preflight:false,safelist:[]}).generate(classes).css;
   writeIfChanged(dest,css+'\n');manifest[source]=path.relative(root,dest).split(path.sep).join('/');
  }
  const manifestFile=path.join(directory,'manifest.json');
  if(fs.existsSync(manifestFile)){
   const previous=JSON.parse(fs.readFileSync(manifestFile,'utf8')) as Record<string,string>;
   for(const [source,filename] of Object.entries(previous)){
    if(Object.hasOwn(manifest,source)||typeof filename!=='string'||!filename.endsWith(source+'.css'))continue;
    const stale=outputPath(root,filename);
    if(inside(directory,stale)&&fs.existsSync(stale)&&fs.lstatSync(stale).isFile())fs.unlinkSync(stale);
   }
  }
  writeIfChanged(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 }
 return result;
}
/** Output paths cannot escape the project root. */
export function buildZuix(root=process.cwd(),config:ZuixConfig={}):GenerateResult {
 const absolute=path.resolve(root);return buildFromFiles(absolute,config,scanProjectFiles(absolute,config));
}
/** Polling watcher with incremental class extraction. Reports recoverable errors and keeps watching. */
export function watchZuix(root=process.cwd(),config:ZuixConfig={},onBuild?:(result:GenerateResult)=>void,onError?:(error:unknown)=>void):()=>void {
 const absolute=path.resolve(root),scanner=createProjectScanner(absolute,config);
 let previous='',active=true;
 const tick=()=>{if(!active)return;try{
  const files=scanner.scan();const next=JSON.stringify([...files]);
  if(next!==previous){const result=buildFromFiles(absolute,config,files);previous=next;onBuild?.(result);}
 }catch(error){if(onError)onError(error);else console.error('[zuix] watch:',error);}};
 tick();const timer=setInterval(tick,500);
 return ()=>{active=false;clearInterval(timer);scanner.clear();};
}
