import fs from 'node:fs';
import path from 'node:path';
import {createZuix} from './compiler.js';
import {extractClasses} from './scanner.js';
import type {ZuixConfig,GenerateResult} from './types.js';
const supported=/\.(?:html?|jsx?|tsx?|vue|svelte|astro|mdx?)$/i;
const defaultExcluded=new Set(['node_modules','.git','dist','build','.next','.nuxt','.zerux','.output','coverage','.cache']);
function globRegex(pattern:string):RegExp {
 let s='^';const normalized=pattern.replace(/\\/g,'/').replace(/^\.\//,'');
 for(let i=0;i<normalized.length;i++){const ch=normalized[i];if(ch==='*'){if(normalized[i+1]==='*'){i++;if(normalized[i+1]==='/'){i++;s+='(?:.*/)?';}else s+='.*';}else s+='[^/]*';}else if(ch==='?')s+='.';else s+=ch.replace(/[.+^${}()|[\]\\]/g,'\\$&');}
 return new RegExp(s+'$');
}
export function scanProjectFiles(root:string,config:ZuixConfig={}):Map<string,string[]> {
 const absoluteRoot=path.resolve(root);
 const patterns=(config.content?.length?config.content:['**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}']).flatMap(p=>p.includes('{')?expandBraces(p):[p]).map(globRegex);
 const excluded=(config.exclude??[]).map(globRegex);const files=new Map<string,string[]>();
 function visit(dir:string){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(defaultExcluded.has(entry.name)||entry.name.startsWith('.env')|| (config.perFile && entry.isDirectory() && path.resolve(dir,entry.name)===path.resolve(absoluteRoot,typeof config.perFile==='object'?(config.perFile.dir??'zuix-files'):'zuix-files')))continue;
  const abs=path.join(dir,entry.name),rel=path.relative(absoluteRoot,abs).split(path.sep).join('/');
  if(excluded.some(p=>p.test(rel)))continue;
  if(entry.isDirectory()&&!entry.isSymbolicLink())visit(abs);
  else if(entry.isFile()&&supported.test(entry.name)&&patterns.some(p=>p.test(rel))){
   try{files.set(rel,extractClasses(fs.readFileSync(abs,'utf8')));}catch{/* unreadable files */}
  }
 }}visit(absoluteRoot);return files;
}
export function scanProject(root:string,config:ZuixConfig={}):string[]{
 return [...new Set([...scanProjectFiles(root,config).values()].flat())];
}
function expandBraces(pattern:string):string[]{const match=/\{([^{}]+)\}/.exec(pattern);if(!match)return [pattern];return match[1].split(',').flatMap(part=>expandBraces(pattern.slice(0,match.index)+part+pattern.slice(match.index+match[0].length)));}
function writeIfChanged(file:string,content:string):void {
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)fs.writeFileSync(file,content);
}
/** Generate a shared stylesheet and optionally one CSS file per source file. */
export function buildZuix(root=process.cwd(),config:ZuixConfig={}):GenerateResult {
 const files=scanProjectFiles(root,config);
 const all=[...new Set([...files.values()].flat())];
 const compiler=createZuix(config);
 const result=compiler.generate(all);
 const output=path.resolve(root,config.output??'zuix.css');
 writeIfChanged(output,result.css+'\n');
 if(config.perFile){
  const settings=typeof config.perFile==='object'?config.perFile:{};
  const directory=path.resolve(root,settings.dir??'zuix-files');
  const manifest:Record<string,string>={};
  for(const [source,classes] of files){
   const dest=path.join(directory,source+'.css');
   // Per-file stylesheets omit preflight by default; global CSS owns reset.
   const css=createZuix({...config,preflight:false,safelist:[]}).generate(classes).css;
   writeIfChanged(dest,css+'\n');manifest[source]=path.relative(root,dest).split(path.sep).join('/');
  }
  const manifestFile=path.join(directory,'manifest.json');
  try{const previous=JSON.parse(fs.readFileSync(manifestFile,'utf8')) as Record<string,string>;
   for(const [source,filename] of Object.entries(previous))if(!(source in manifest)){
    const stale=path.resolve(root,filename);if(stale.startsWith(directory+path.sep)&&fs.existsSync(stale))fs.unlinkSync(stale);
   }
  }catch{/* first build */}
  writeIfChanged(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 }
 return result;
}
export function watchZuix(root=process.cwd(),config:ZuixConfig={},onBuild?:(result:GenerateResult)=>void):()=>void {
 let snapshot='';let active=true;
 const tick=()=>{if(!active)return;const files=scanProjectFiles(root,config);const next=JSON.stringify([...files]);
  if(next!==snapshot){snapshot=next;onBuild?.(buildZuix(root,config));}};
 tick();const timer=setInterval(tick,500);(timer as unknown as {unref?:()=>void}).unref?.();
 return ()=>{active=false;clearInterval(timer);};
}
