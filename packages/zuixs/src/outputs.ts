import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createZuix } from './compiler.js';
import type { ZuixConfig, ZuixBuildManifest } from './types.js';
const require = createRequire(import.meta.url);

/** Read a bounded regular inode rather than checking and reopening a pathname. */
export function readProjectFile(file:string,maximum:number):string {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try {
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size>maximum)throw new Error('zuix: unsafe or oversized file');
  const buffer=Buffer.alloc(stat.size+1);let size=0;
  while(size<buffer.length){const count=fs.readSync(fd,buffer,size,buffer.length-size,null);if(!count)break;size+=count;}
  if(size>stat.size)throw new Error('zuix: file changed during read');
  return buffer.subarray(0,size).toString('utf8');
 } finally {fs.closeSync(fd);}
}

/** Prepare every changed file before replacing any output. Each rename is atomic;
 * ordinary failures roll back replaced files. This is not a crash-atomic multi-file deployment.
 */
export function commitOutputs(files: Map<string,string>, maxBytes:number, deletions:readonly string[]=[]): void {
 let bytes=0;
 const prepared: {file:string;temp:string;before:string|null;deleting?:boolean}[]=[];
 const replaced: typeof prepared=[];
 try {
  for(const [file,text] of files){
   bytes+=Buffer.byteLength(text);if(bytes>maxBytes)throw new Error('zuix: maxOutputBytes exceeded');
   let before:string|null=null;
   try{before=readProjectFile(file,maxBytes);}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(before===text)continue;
   fs.mkdirSync(path.dirname(file),{recursive:true});
   const temp=path.join(path.dirname(file),`.zuix-${randomUUID()}.tmp`);
   prepared.push({file,temp,before});
   const fd=fs.openSync(temp,'wx',0o644);
   try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  for(const file of new Set(deletions)){
   if(files.has(file))continue;
   const before=readProjectFile(file,maxBytes);
   prepared.push({file,temp:path.join(path.dirname(file),`.zuix-${randomUUID()}.tmp`),before,deleting:true});
  }
  for(const item of prepared){if(item.deleting)fs.unlinkSync(item.file);else fs.renameSync(item.temp,item.file);replaced.push(item);}
 }catch(error){
  const errors:unknown[]=[error];
  for(const item of replaced.reverse())try{
   if(item.before===null)fs.unlinkSync(item.file);
   else{fs.writeFileSync(item.temp,item.before,{flag:'wx'});fs.renameSync(item.temp,item.file);}
  }catch(rollback){errors.push(rollback);}
  if(errors.length>1)throw new AggregateError(errors,'zuix: output replacement/rollback failed');
  throw error;
 }finally{for(const item of prepared)try{fs.unlinkSync(item.temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
}

/** Emit public output-only records. Source maps are explicit, file-level mappings;
 * no original source content is copied unless includeSources is separately enabled.
 */
export function attachManifest(root:string,config:ZuixConfig,files:Map<string,string>,sources:Map<string,string[]>,safePath:(name:string)=>string,owners?:Map<string,string>):ZuixBuildManifest|undefined {
 const settings=config.buildManifest;if(!settings)return;
 if(!settings||typeof settings!=='object'||typeof settings.file!=='string'||typeof settings.publicPath!=='string')throw new Error('zuix: invalid build manifest');
 const base=settings.publicPath;
 if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)||base.startsWith('//'))throw new Error('zuix: publicPath must be an absolute path ending in /');
 if(settings.sourceMap!==undefined&&typeof settings.sourceMap!=='boolean'||settings.includeSources!==undefined&&typeof settings.includeSources!=='boolean'||settings.includeSources&&!settings.sourceMap)throw new Error('zuix: invalid source map policy');
 const directory=path.dirname(safePath(config.output??'zuix.css'));
 const url=(file:string)=>{
  const relative=path.relative(directory,file).split(path.sep).join('/');
  if(relative.startsWith('../')||relative==='..'||path.isAbsolute(relative))throw new Error('zuix: manifest assets must be inside the shared output directory');
  return base+relative.split('/').map(encodeURIComponent).join('/');
 };
 const entries:ZuixBuildManifest['stylesheets']=[];
 for(const [file,original] of [...files]){
  if(!file.endsWith('.css'))continue;
  let text=original,mapUrl:string|undefined;
  if(settings.sourceMap){
   const {SourceMapGenerator}=require('source-map-js') as typeof import('source-map-js');
   const map=new SourceMapGenerator({file:path.basename(file)});
   const compiler=createZuix({...config,preflight:false,recipes:[],plugins:[]});
   const offsets=new Set<number>();
   // File-level ownership only. Resets/recipes/plugin-only rules deliberately stay unmapped.
   for(const [source,tokens] of sources){
    if(owners?.has(file)&&owners.get(file)!==source)continue;
    const sourcePath=path.relative(path.dirname(file),safePath(source)).split(path.sep).join('/');
    for(const token of tokens){
     const rule=compiler.compileClass(token);if(!rule)continue;
     const offset=original.indexOf(rule);if(offset<0||offsets.has(offset))continue;offsets.add(offset);
     const before=original.slice(0,offset),line=before.split('\n').length,column=offset-(before.lastIndexOf('\n')+1);
     map.addMapping({generated:{line,column},original:{line:1,column:0},source:sourcePath});
    }
    if(settings.includeSources)map.setSourceContent(sourcePath,fs.readFileSync(safePath(source),'utf8'));
   }
   const mapFile=safePath(file+'.map');if(files.has(mapFile))throw new Error('zuix: duplicate output');
   files.set(mapFile,map.toString()+'\n');mapUrl=url(mapFile);
   text=original.trimEnd()+`\n/*# sourceMappingURL=${encodeURIComponent(path.basename(mapFile))} */\n`;files.set(file,text);
  }
  entries.push({id:path.resolve(file)===safePath(config.output??'zuix.css')?'shared':createHash('sha256').update(path.relative(directory,file)).digest('hex').slice(0,24),url:url(file),integrity:'sha256-'+createHash('sha256').update(text).digest('base64'),...(mapUrl?{sourceMap:mapUrl}:{})});
 }
 entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const manifest:ZuixBuildManifest={version:1,stylesheets:entries};
 const target=safePath(settings.file);if(files.has(target))throw new Error('zuix: duplicate manifest output');
 files.set(target,JSON.stringify(manifest,null,2)+'\n');return manifest;
}
