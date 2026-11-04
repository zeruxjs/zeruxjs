import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,rename,rm,rmdir} from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import {defineFont} from './css.js';
import {validateSvgIcon,svgIconMarkup,fontIcon} from './icons.js';
import type {SvgIcon} from './icons.js';
import {validateFace} from './face-validation.js';
import type {FontDefinition} from './types.js';
import type {FontAxis,FontToolsTool,FontBinaryFormat,FontInspection} from './fonttools.js';
export {createFontToolsTool} from './fonttools.js';
export type {FontToolsTool,FontBinaryFormat,FontAxis,FontInspection} from './fonttools.js';
export interface FontLicense {id:string;source:string;attribution:string;redistributionAllowed:true;subsettingAllowed?:boolean;text?:string}
export interface BuildFont extends Omit<FontDefinition,'sources'> {
 key:string;source:{path:string}|{url:string};format:FontBinaryFormat;license:FontLicense;preload?:boolean;
 axes?:readonly FontAxis[];
 subset?:{codePoints:readonly number[];language?:string;script?:string};
}
export type BuildIcon={key:string;kind:'svg';geometry:SvgIcon;license:FontLicense}|{key:string;kind:'font';fontKey:string;codePoint:number};
export interface FontBuildOptions {
 projectRoot:string;outputDir:string;publicBase:string;fonts:readonly BuildFont[];icons?:readonly BuildIcon[];
 preload?:{maxCount:number;maxBytes:number};maxFileBytes?:number;maxTotalBytes?:number;signal?:AbortSignal;
 tool?:FontToolsTool;
 remote?:{fetch:typeof fetch;allowedOrigins:readonly string[];maxRedirects?:number;timeoutMs?:number};
}
export interface FontAssetManifest {
 schema:1;digest:string;css:{file:string;url:string;sha256:string};
 fonts:{key:string;family:string;weight:string;style:string;url:string;file:string;sha256:string;sourceSha256:string;bytes:number;format:FontBinaryFormat;license:FontLicense;axes:FontAxis[];tool?:{name:'fonttools';version:string};subset?:{codePoints:number[];language?:string;script?:string}}[];
 icons:({key:string;kind:'svg';url:string;file:string;sha256:string;bytes:number;license:FontLicense}|{key:string;kind:'font';fontKey:string;codePoint:number})[];
 preloads:{url:string;type:string;bytes:number}[];
}
const hash=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
const keyPattern=/^[a-z][a-z0-9_-]{0,63}$/;
const extensions={woff2:'woff2',woff:'woff',truetype:'ttf',opentype:'otf'};
function bounded(value:number,min:number,max:number){if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Font build budget invalid');return value;}
function license(value:FontLicense):FontLicense{
 if(!value||value.redistributionAllowed!==true||typeof value.id!=='string'||! /^[A-Za-z0-9.-]{1,128}$/.test(value.id)||typeof value.attribution!=='string'||!value.attribution.trim()||value.attribution.length>2048||/[\x00-\x1f\x7f]/.test(value.attribution)||typeof value.source!=='string'||value.source.length>2048||value.subsettingAllowed!==undefined&&typeof value.subsettingAllowed!=='boolean'||value.text!==undefined&&(typeof value.text!=='string'||value.text.length>32768))throw new TypeError('Explicit redistribution permission/license attribution required');
 if(! /^local:[A-Za-z0-9._/-]{1,256}$/.test(value.source)){let url:URL;try{url=new URL(value.source);}catch{throw new TypeError('Invalid attribution source');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new TypeError('Attribution source must not contain credentials/tokens');}
 return {id:value.id,source:value.source,attribution:value.attribution,redistributionAllowed:true,...(value.subsettingAllowed!==undefined?{subsettingAllowed:value.subsettingAllowed}:{}),...(value.text!==undefined?{text:value.text}:{})};
}
function signature(bytes:Uint8Array,format:FontBinaryFormat){const data=Buffer.from(bytes);if(!Object.hasOwn(extensions,format)||bytes.length<48||!(format==='woff2'?data.toString('ascii',0,4)==='wOF2':format==='woff'?data.toString('ascii',0,4)==='wOFF':format==='opentype'?data.toString('ascii',0,4)==='OTTO':data.readUInt32BE(0)===0x00010000))throw new TypeError('Font container signature/format mismatch');}
function axes(input:readonly FontAxis[]=[]):FontAxis[]{if(!Array.isArray(input)||input.length>32)throw new TypeError('Axis limit');const seen=new Set<string>();return input.map((axis:FontAxis)=>{if(!axis||Object.keys(axis).some(key=>!['tag','min','default','max'].includes(key))||! /^[A-Za-z]{4}$/.test(axis.tag)||seen.has(axis.tag)||[axis.min,axis.default,axis.max].some(v=>!Number.isFinite(v)||Math.abs(v)>1000000)||axis.min>axis.default||axis.default>axis.max)throw new TypeError('Invalid/duplicate variable axis');seen.add(axis.tag);return {tag:axis.tag,min:axis.min,default:axis.default,max:axis.max};}).sort((a,b)=>a.tag<b.tag?-1:1);}
function weightRange(font:BuildFont){const text=String(font.weight??400);const values=text==='normal'?[400]:text==='bold'?[700]:text.split(' ').map(Number);return [values[0],values.at(-1)!];}
/** Build-only bounded vendoring. Writes only a complete staging candidate; no runtime remote loader. */
export async function buildFontAssets(options:FontBuildOptions):Promise<FontAssetManifest>{
 if(!options||typeof options.projectRoot!=='string'||typeof options.outputDir!=='string'||!Array.isArray(options.fonts)||options.fonts.length>64||!Array.isArray(options.icons??[])||(options.icons?.length??0)>256||!options.fonts.length&&!options.icons?.length)throw new TypeError('Explicit bounded font/icon definitions required');
 if(! /^[A-Za-z0-9_./-]{1,256}$/.test(options.outputDir)||isAbsolute(options.outputDir)||options.outputDir.split('/').some(part=>!part||part==='.'||part==='..'))throw new TypeError('Output must stay within the project');
 if(typeof options.publicBase!=='string'||! /^\/(?:[A-Za-z0-9_-]+\/)*$/.test(options.publicBase))throw new TypeError('Canonical absolute public base ending in / required');
 const root=resolve(options.projectRoot),output=join(root,options.outputDir),maxFile=bounded(options.maxFileBytes??8*1024*1024,1,16*1024*1024),maxTotal=bounded(options.maxTotalBytes??64*1024*1024,1,128*1024*1024);
 const preload={...(options.preload??{maxCount:2,maxBytes:128*1024})};bounded(preload.maxCount,0,16);bounded(preload.maxBytes,0,16*1024*1024);
 const cancelled=()=>{if(options.signal?.aborted)throw new Error('Font build cancelled');};
 async function secure(path:string,create=false){if(path!==root&&!path.startsWith(root+'/'))throw new Error('Unsafe font output');if(create&&path!==root)await secure(dirname(path),true);if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)throw new Error('Unsafe font directory');}
 await secure(root);
 const keys=new Set<string>(),faces:{family:string;style:string;angles:number[];stretch:number[];range:number[]}[]=[];
 const fonts=options.fonts.map((input:BuildFont)=>{if(!input||!keyPattern.test(input.key)||keys.has(input.key))throw new TypeError('Duplicate font key');keys.add(input.key);validateFace({...input,sources:[]});if(!input.source||typeof input.source!=='object'||Object.keys(input.source).length!==1||!('path' in input.source)&&!('url' in input.source))throw new TypeError('Choose one font source');if(input.preload!==undefined&&typeof input.preload!=='boolean')throw new TypeError('Invalid preload option');if(!Object.hasOwn(extensions,input.format))throw new TypeError('Unsupported font format');
  const range=weightRange(input),family=input.family.trim().normalize('NFC').toLowerCase(),styleText=input.style??'normal',style=styleText.split(' ')[0],angleValues=styleText.match(/-?\d+(?:\.\d+)?/g)?.map(Number)??[14],angles=style==='oblique'?[angleValues[0],angleValues.at(-1)!]:[0,0],widthNames:Record<string,number>={'ultra-condensed':50,'extra-condensed':62.5,condensed:75,'semi-condensed':87.5,normal:100,'semi-expanded':112.5,expanded:125,'extra-expanded':150,'ultra-expanded':200},widthText=input.stretch??'normal',widths=Object.hasOwn(widthNames,widthText)?[widthNames[widthText]]:widthText.split(' ').map(parseFloat),stretch=[widths[0],widths.at(-1)!];if(faces.some(face=>face.family===family&&face.style===style&&face.angles[0]<=angles[1]&&angles[0]<=face.angles[1]&&face.stretch[0]<=stretch[1]&&stretch[0]<=face.stretch[1]&&face.range[0]<=range[1]&&range[0]<=face.range[1]))throw new TypeError('Overlapping duplicate family/weight/style');faces.push({family,range,style,angles,stretch});
  const declaredAxes=axes(input.axes);if((declaredAxes.length||input.subset)&&(!options.tool||options.tool.name!=='fonttools'))throw new Error('Explicit FontTools tool required for axes/subsetting');
  const wght=declaredAxes.find(a=>a.tag==='wght');if(wght&&(wght.min<1||wght.max>1000||range[0]<wght.min||range[1]>wght.max))throw new TypeError('Weight outside variable axis');
  const subset=input.subset?{...input.subset,codePoints:[...new Set(input.subset.codePoints)].sort((a,b)=>a-b)}:undefined;
  if(subset){if(input.license?.subsettingAllowed!==true)throw new Error('Explicit font subsetting permission required');if(!Array.isArray(input.subset!.codePoints)||!subset.codePoints.length||subset.codePoints.length>65536||subset.codePoints.some(cp=>!Number.isSafeInteger(cp)||cp<0||cp>0x10ffff||cp>=0xd800&&cp<=0xdfff)||subset.language!==undefined&&(typeof subset.language!=='string'||subset.language.length>64)||subset.script!==undefined&&! /^[A-Z][a-z]{3}$/.test(subset.script))throw new TypeError('Invalid subset coverage request');if(subset.language)subset.language=Intl.getCanonicalLocales(subset.language)[0];}
  return {...input,source:{...input.source},license:license(input.license),axes:declaredAxes,subset};
 }).sort((a,b)=>a.key<b.key?-1:1);
 const icons=(options.icons??[]).map((icon:BuildIcon)=>{if(!icon||!keyPattern.test(icon.key)||keys.has(icon.key))throw new TypeError('Duplicate icon/font key');keys.add(icon.key);if(icon.kind==='svg')return {...icon,geometry:validateSvgIcon(icon.geometry),license:license(icon.license)};if(icon.kind!=='font'||!fonts.some(font=>font.key===icon.fontKey))throw new TypeError('Icon font not registered');fontIcon(icon.codePoint,fonts.find(f=>f.key===icon.fontKey)!.family);if(!options.tool)throw new Error('FontTools coverage inspection required for font icons');return {...icon};}).sort((a,b)=>a.key<b.key?-1:1);
 const remote=options.remote?{...options.remote,allowedOrigins:[...options.remote.allowedOrigins]}:undefined;
 if(remote&&(!Array.isArray(remote.allowedOrigins)||!remote.allowedOrigins.length||remote.allowedOrigins.length>32||remote.allowedOrigins.some(origin=>{try{const u=new URL(origin);return u.origin!==origin||u.protocol!=='https:';}catch{return true;}})||typeof remote.fetch!=='function'))throw new TypeError('Approved build transport/origins required');
 const timeout=bounded(remote?.timeoutMs??15000,1,120000),redirects=bounded(remote?.maxRedirects??2,0,5);
 async function acquire(source:BuildFont['source']):Promise<Uint8Array>{
  cancelled();if('path' in source){if(typeof source.path!=='string'||!source.path||isAbsolute(source.path)||source.path.split(/[\\/]/).some(p=>!p||p==='..'||p==='.')||source.path.includes('\0')||source.path.length>2048)throw new TypeError('Font source must be project-relative');const path=resolve(root,source.path);if(await realpath(path)!==path||!path.startsWith(root+'/'))throw new Error('Unsafe local font path');const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maxFile)throw new RangeError('Font size limit');const data=Buffer.alloc(stat.size+1);let offset=0;while(offset<data.length){cancelled();const {bytesRead}=await handle.read(data,offset,data.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}if(offset!==stat.size)throw new Error('Font changed during read');return data.subarray(0,offset);}finally{await handle.close();}}
  if(!remote)throw new Error('Remote acquisition is not configured');if(typeof source.url!=='string'||source.url.length>8192)throw new TypeError('Invalid remote font URL');let url:URL;try{url=new URL(source.url);}catch{throw new TypeError('Invalid remote font URL');}
  const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();const timer=setTimeout(abort,timeout);
  try{for(let step=0;step<=redirects;step++){
   if(controller.signal.aborted)throw new Error('Font acquisition cancelled');
   if(url.protocol!=='https:'||url.username||url.password||url.hash||!remote.allowedOrigins.includes(url.origin))throw new Error('Remote font destination denied');
   const response=await remote.fetch(url.href,{signal:controller.signal,redirect:'manual',credentials:'omit'});
   if(response.redirected){await response.body?.cancel();throw new Error('Transport followed an unapproved redirect');}
   if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();if(step===redirects)throw new Error('Font redirect limit');const next=response.headers.get('location');if(!next)throw new Error('Missing font redirect');url=new URL(next,url);continue;}
   if(!response.ok||!response.body){await response.body?.cancel();throw new Error('Remote font download failed');}
   if(response.headers.has('content-encoding')&&response.headers.get('content-encoding')!=='identity'){await response.body.cancel();throw new Error('Encoded font downloads unsupported');}
   const length=response.headers.get('content-length');if(length!==null&&(! /^\d+$/.test(length)||Number(length)>maxFile)){await response.body.cancel();throw new RangeError('Font download size limit');}
   const reader=response.body.getReader(),cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});let size=0,count=0;const chunks:Uint8Array[]=[];
   try{while(true){if(controller.signal.aborted)throw new Error('Font download cancelled/deadline');const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxFile||++count>65536)throw new RangeError('Font download size limit');chunks.push(new Uint8Array(part.value));}if(controller.signal.aborted)throw new Error('Font download cancelled/deadline');if(length!==null&&size!==Number(length))throw new Error('Font download length mismatch');const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return data;}
   finally{controller.signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  }throw new Error('Font redirect limit');}catch{throw new Error('Build-time font acquisition failed');}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
 }
 await secure(dirname(output),true);try{await secure(output);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 function verifyInspection(declared:readonly FontAxis[],inspection:FontInspection){
  const actual=axes(inspection.axes);
  if(typeof inspection.toolVersion!=='string'||! /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(inspection.toolVersion)||!Array.isArray(inspection.codePoints)||inspection.codePoints.length>200000||inspection.codePoints.some(cp=>!Number.isSafeInteger(cp)||cp<0||cp>0x10ffff||cp>=0xd800&&cp<=0xdfff))throw new Error('Invalid glyph inspection');
  for(const axis of declared){const found=actual.find(a=>a.tag===axis.tag);if(!found||axis.min<found.min||axis.max>found.max||axis.default!==found.default)throw new Error('Declared axis does not match emitted font');}
 }
 const lock=join(root,'.font-build-lock-'+hash(options.outputDir).slice(0,16));await mkdir(lock,{mode:0o700}).catch(()=>{throw new Error('Font output locked');});
 const staging=join(dirname(output),'.font-stage-'+randomUUID()),backup=join(dirname(output),'.font-previous-'+randomUUID());let promoted=false,moved=false,total=0;
 const manifest:FontAssetManifest={schema:1,digest:'',css:{file:'',url:'',sha256:''},fonts:[],icons:[],preloads:[]};const coverage=new Map<string,Set<number>>(),css:string[]=[];
 async function emit(file:string,data:Uint8Array|string){cancelled();total+=typeof data==='string'?Buffer.byteLength(data):data.byteLength;if(total>maxTotal)throw new RangeError('Total font output limit');const handle=await open(join(staging,file),'wx',0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}}
 try{await mkdir(staging,{mode:0o700});const emitted=new Set<string>();
  for(const font of fonts){let bytes=await acquire(font.source);signature(bytes,font.format);const sourceSha256=hash(bytes);let inspection:FontInspection|undefined;
   if(options.tool){inspection=await options.tool.inspect(bytes,font.format,options.signal);verifyInspection(font.axes,inspection);}
   if(font.subset){const required=font.subset.codePoints;if(!required.every(cp=>inspection!.codePoints.includes(cp)))throw new Error('Source font lacks requested glyphs');bytes=await options.tool!.subset(bytes,font.format,required,options.signal);if(bytes.byteLength>maxFile)throw new RangeError('Subset size limit');signature(bytes,font.format);inspection=await options.tool!.inspect(bytes,font.format,options.signal);verifyInspection(font.axes,inspection);if(!Array.isArray(inspection.codePoints)||!required.every(cp=>inspection!.codePoints.includes(cp)))throw new Error('Subset glyph coverage failed');}
   if(inspection)coverage.set(font.key,new Set(inspection.codePoints));const sha256=hash(bytes),file=sha256+'.'+extensions[font.format],url=options.publicBase+file;if(!emitted.has(file)){await emit(file,bytes);emitted.add(file);}
   css.push(defineFont({...font,sources:[{url,format:font.format}]}));manifest.fonts.push({key:font.key,family:font.family,weight:String(font.weight??400),style:font.style??'normal',url,file,sha256,sourceSha256,bytes:bytes.length,format:font.format,license:font.license,axes:font.axes,...(inspection?{tool:{name:'fonttools' as const,version:inspection.toolVersion}}:{}),...(font.subset?{subset:font.subset}:{})});
   if(font.preload&&!manifest.preloads.some(item=>item.url===url))manifest.preloads.push({url,type:'font/'+extensions[font.format],bytes:bytes.length});
  }
  if(manifest.preloads.length>preload.maxCount||manifest.preloads.reduce((sum,item)=>sum+item.bytes,0)>preload.maxBytes)throw new RangeError('Font preload budget exceeded');
  for(const icon of icons){if(icon.kind==='font'){if(!coverage.get(icon.fontKey)?.has(icon.codePoint))throw new Error('Icon glyph missing from emitted font');manifest.icons.push({key:icon.key,kind:'font',fontKey:icon.fontKey,codePoint:icon.codePoint});continue;}const svg=svgIconMarkup(icon.geometry),sha256=hash(svg),file=sha256+'.svg';if(!emitted.has(file)){await emit(file,svg);emitted.add(file);}manifest.icons.push({key:icon.key,kind:'svg',file,url:options.publicBase+file,sha256,bytes:Buffer.byteLength(svg),license:icon.license});}
  const stylesheet=css.join('\n'),styleHash=hash(stylesheet),styleFile=styleHash+'.css';await emit(styleFile,stylesheet);manifest.css={file:styleFile,url:options.publicBase+styleFile,sha256:styleHash};manifest.digest=hash(JSON.stringify(manifest));await emit('manifest.json',JSON.stringify(manifest,null,2));cancelled();
  try{await secure(output);await rename(output,backup);moved=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  try{await rename(staging,output);promoted=true;}catch(error){if(moved){await rename(backup,output);}throw error;}
  if(moved)await rm(backup,{recursive:true});return structuredClone(manifest);
 }finally{if(!promoted)await rm(staging,{recursive:true,force:true});await rmdir(lock);}
}
