import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseFragment} from 'parse5';
import {escapeHtmlText,escapeHtmlAttribute} from '@zeruxjs/security/encoding';
import {createRendererRegistry,isRenderedHtml,type RendererAdapter} from './renderers.js';
import {createPublicRouteManifest} from './navigation-manifest.js';
import {assertSafeBuildDirectories,assertDisjointBuildSources,readBuildFile} from './commands/build-paths.js';
import {redactManifestConfig} from './bootstrap/manifest-config.js';

export interface StaticExportContext {
 readonly signal:AbortSignal;
 readonly deadline:number;
 readonly pathname:string;
 readonly canonical:string;
 asset(url:string):string;
}
export interface StaticExportPage<V> {
 path:string;
 access:'public';
 view(params:Readonly<Record<string,string>>,context:StaticExportContext):V|Promise<V>;
 /** Required for each dynamic route. Every parameter must be enumerated. */
 params?:(context:Pick<StaticExportContext,'signal'|'deadline'>)=>Iterable<Record<string,string>>|AsyncIterable<Record<string,string>>|Promise<Iterable<Record<string,string>>|AsyncIterable<Record<string,string>>>;
 title?:string;
}
export interface StaticExportRedirect {path:string;access:'public';redirect:string;status:301|302|307|308}
export interface StaticExportOptions<V> {
 rootDir:string;
 outDir?:string;
 origin:string;
 basePath?:string;
 mode?:'static'|'mixed';
 routes:readonly (StaticExportPage<V>|StaticExportRedirect)[];
 notFound:{access:'public';view:V;title?:string};
 /** New export-owned adapter, disposed before publication; no app bootstrap. */
 renderer:()=>RendererAdapter<V>|Promise<RendererAdapter<V>>;
 assets?:{directory:string;manifest:unknown;include:readonly string[]};
 maxRoutes?:number;
 maxBytes?:number;
 maxPageBytes?:number;
 timeoutMs?:number;
 routeTimeoutMs?:number;
 signal?:AbortSignal;
}
export interface StaticExportManifest {
 version:1;kind:'zerux-static-export';mode:'static'|'mixed';basePath:string;
 pages:{url:string;file:string;status:200|404;canonical?:string}[];
 assets:{source:string;url:string;integrity:string}[];
 files:{file:string;bytes:number;sha256:string}[];
 hosting:{notFound:{file:string;status:404};redirects:{from:string;to:string;status:301|302|307|308}[];unlisted:'404'|'node-server-required'};
}
export class StaticExportError extends Error {
 constructor(readonly code:string,cause?:unknown){super(code);this.name='StaticExportError';if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
function fail(code:string):never{throw new StaticExportError(code);}
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');

const ownKeys=(value:unknown,keys:readonly string[])=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
function number(value:unknown,fallback:number,max:number){const result=value??fallback;if(typeof result!=='number'||!Number.isSafeInteger(result)||result<1||result>max)fail('STATIC_LIMIT_INVALID');return result as number;}
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
function relative(value:string){if(typeof value!=='string'||!value||value.length>2048||value.includes('\\')||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\x7f]/.test(part)))fail('STATIC_PATH_INVALID');return value;}
function publicValue<T>(input:T):T {
 let nodes=0;const seen=new Set<object>();
 const visit=(value:any,depth:number):any=>{
  if(++nodes>5000||depth>24)fail('STATIC_PROPS_LIMIT');
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'){if(value.length>1048576)fail('STATIC_PROPS_LIMIT');return value;}
  if(!value||typeof value!=='object'||seen.has(value)||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('STATIC_PRIVATE_DATA');
  if(Reflect.ownKeys(value).length>1000)fail('STATIC_PROPS_LIMIT');seen.add(value);const result:any=Array.isArray(value)?[]:Object.create(null);
  for(const key of Object.keys(value).sort()){
   if(key.length>256||['_action_key','_action_csrf','__proto__','prototype','constructor'].includes(key)||(redactManifestConfig({[key]:0}) as any)[key]!==0)fail('STATIC_PRIVATE_DATA');
   const property=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in property))fail('STATIC_PRIVATE_DATA');result[key]=visit(property.value,depth+1);
  }
  seen.delete(value);return Object.freeze(result);
 };
 const result=visit(input,0);if(Buffer.byteLength(JSON.stringify(result))>1048576)fail('STATIC_PROPS_LIMIT');return result;
}
async function safeFile(root:string,file:string,maximum:number):Promise<Buffer>{
 await assertSafeBuildDirectories(root,path.dirname(file),'static source');
 try{return await readBuildFile(file,maximum,true);}catch(error){if((error as NodeJS.ErrnoException).code==='ELOOP'||error instanceof Error&&error.message==='Invalid or oversized build file')fail('STATIC_ASSET_INVALID');throw error;}
}
/** Explicit request-free static export. It does not discover or execute app routes/services. */
export async function exportStaticSite<V>(options:StaticExportOptions<V>):Promise<StaticExportManifest>{
 if(!ownKeys(options,['rootDir','outDir','origin','basePath','mode','routes','notFound','renderer','assets','maxRoutes','maxBytes','maxPageBytes','timeoutMs','routeTimeoutMs','signal'])||!options||typeof options.rootDir!=='string'||typeof options.renderer!=='function'||!Array.isArray(options.routes)||!options.routes.length||options.routes.length>256||!ownKeys(options.notFound,['access','view','title'])||options.notFound.access!=='public'||options.notFound.title!==undefined&&(typeof options.notFound.title!=='string'||options.notFound.title.length>256)||options.signal!==undefined&&!(options.signal instanceof AbortSignal)||options.mode!==undefined&&!['static','mixed'].includes(options.mode))fail('STATIC_CONFIG_INVALID');
 let origin:URL;try{origin=new URL(options.origin);}catch{fail('STATIC_ORIGIN_INVALID');}
 if(!['http:','https:'].includes(origin!.protocol)||origin!.origin!==options.origin||options.origin.length>2048)fail('STATIC_ORIGIN_INVALID');
 if(options.basePath!==undefined&&typeof options.basePath!=='string')fail('STATIC_BASE_INVALID');
 const base=(options.basePath??'/').replace(/\/$/,'')||'/';if(!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(base))fail('STATIC_BASE_INVALID');
 const root=path.resolve(options.rootDir),out=path.resolve(root,relative(options.outDir??'.zerux/static'));
 const first=path.relative(root,out).split(path.sep)[0];if(['app','src','public','node_modules','.git','.agents','.codex','.aws','packages','apps','sample-packages','middleware','controllers','plugins','components','lib'].includes(first)||out===root)fail('STATIC_OUTPUT_INVALID');
 const maxRoutes=number(options.maxRoutes,1000,10000),maxBytes=number(options.maxBytes,33554432,536870912),maxPage=number(options.maxPageBytes,1048576,16777216),timeout=number(options.timeoutMs,30000,300000),routeTimeout=number(options.routeTimeoutMs,5000,30000);
 const routes=options.routes.map((route:StaticExportPage<V>|StaticExportRedirect)=>{
  if(!route||route.access!=='public'||!ownKeys(route,'redirect'in route?['path','access','redirect','status']:['path','access','view','params','title'])||typeof route.path!=='string'||route.path.includes('//')||route.path.includes('{')||route.path.includes('}')||route.path.split('/').some(part=>part==='.'||part==='..'||part.length>200))fail('STATIC_ROUTE_INVALID');
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if('redirect'in route){if(typeof route.redirect!=='string'||!route.redirect.startsWith('/')||route.redirect.startsWith('//')||/[\\\x00-\x20\x7f]/.test(route.redirect)||!/^\/[A-Za-z0-9._~/-]*$/.test(route.redirect)||route.redirect.includes('//')||route.redirect.split('/').some(part=>part==='.'||part==='..')||!(base==='/'||route.redirect===base||route.redirect.startsWith(base+'/'))||![301,302,307,308].includes(route.status))fail('STATIC_REDIRECT_INVALID');}
  else if(typeof route.view!=='function'||route.params!==undefined&&typeof route.params!=='function'||route.title!==undefined&&(typeof route.title!=='string'||route.title.length>256))fail('STATIC_ROUTE_INVALID');
  return {...route,path:route.path.replace(/\/$/,'')||'/'};
 });
 const routeManifest=createPublicRouteManifest({basePath:base,routes:routes.map((route,index)=>({id:'route'+index,pattern:route.path}))});
 const patterns=new Map(routeManifest.routes.map(route=>[route.pattern,route]));
 await assertSafeBuildDirectories(root,root);if(await fs.realpath(root)!==root)fail('STATIC_SYMLINK_ROOT');
 await assertSafeBuildDirectories(root,out);
 await assertDisjointBuildSources(root,out,['app','src','public','node_modules','.git','middleware','controllers','plugins','components','lib',...(options.assets?[relative(options.assets.directory)]:[])]);
 const parent=path.dirname(out);await fs.mkdir(parent,{recursive:true});await assertSafeBuildDirectories(root,parent);
 const lockPath=path.join(parent,'.static-'+digest(out).slice(0,16)+'.lock'),lock=await fs.open(lockPath,'wx',0o600);
 let stage:string|undefined,adapter:RendererAdapter<V>|undefined,disposed=false,total=0;const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 const deadline=Date.now()+timeout,timer=setTimeout(abort,timeout),check=()=>{if(Date.now()>=deadline)controller.abort();if(controller.signal.aborted)fail('STATIC_CANCELLED');};
 const manifest:StaticExportManifest={version:1,kind:'zerux-static-export',mode:options.mode??'static',basePath:base,pages:[],assets:[],files:[],hosting:{notFound:{file:(base==='/'?'':base.slice(1)+'/')+'404.html',status:404},redirects:[],unlisted:options.mode==='mixed'?'node-server-required':'404'}};
 const mount=(url:string)=>(base==='/'?'':base)+url;
 const assetUrls=new Map<string,string>();
 try{
  // Never overwrite a directory that this exporter does not own, or edited output.
  try{
   const previous=JSON.parse((await safeFile(root,path.join(out,'static-export.json'),8388608)).toString());
   if(previous.kind!=='zerux-static-export'||previous.version!==1||!Array.isArray(previous.files)||previous.files.length>12000)fail('STATIC_OUTPUT_INVALID');
   const expected=new Set(['static-export.json']);
   for(const file of previous.files){if(typeof file.file!=='string'||! /^[a-f0-9]{64}$/.test(file.sha256))fail('STATIC_OUTPUT_INVALID');relative(file.file);expected.add(file.file);if(digest(await safeFile(root,path.join(out,file.file),16777216))!==file.sha256)fail('STATIC_OUTPUT_MODIFIED');}
   const walk=async(dir:string)=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())fail('STATIC_OUTPUT_MODIFIED');if(item.isDirectory())await walk(file);else if(!expected.has(path.relative(out,file).split(path.sep).join('/')))fail('STATIC_OUTPUT_MODIFIED');}};await walk(out);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{await fs.lstat(out);fail('STATIC_OUTPUT_INVALID');}catch(missing){if((missing as NodeJS.ErrnoException).code!=='ENOENT')throw missing;}}
  stage=await fs.mkdtemp(path.join(parent,'.static-candidate-'));
  const put=async(file:string,bytes:Buffer|string)=>{check();relative(file);if(manifest.files.some(item=>item.file===file))fail('STATIC_OUTPUT_COLLISION');const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);total+=data.length;if(total>maxBytes||data.length>16777216)fail('STATIC_OUTPUT_LIMIT');const target=path.join(stage!,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx',mode:0o644});manifest.files.push({file,bytes:data.length,sha256:digest(data)});};
  if(options.assets){
   const assets=options.assets,source=assets.manifest as any;if(!source||source.schema!==1||!Array.isArray(source.assets)||source.assets.length>10000||!Array.isArray(assets.include)||assets.include.length>1000||new Set(assets.include).size!==assets.include.length)fail('STATIC_ASSET_MANIFEST_INVALID');
   const directory=path.resolve(root,relative(assets.directory));await assertSafeBuildDirectories(root,directory);
   for(const url of [...assets.include].sort()){
    if(typeof url!=='string'||!/^\/(?!\/)[A-Za-z0-9_./-]+\.(?:css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|txt|xml)$/.test(url))fail('STATIC_ASSET_INVALID');relative(url.slice(1));const matches=source.assets.filter((item:any)=>item.url===url);if(matches.length!==1)fail('STATIC_ASSET_MISSING');const item=matches[0],bytes=await safeFile(root,path.join(directory,url.slice(1)),Math.min(maxBytes,16777216)),integrity='sha256-'+createHash('sha256').update(bytes).digest('base64');
    if(bytes.length!==item.bytes||item.integrity!==integrity)fail('STATIC_ASSET_INTEGRITY');const mounted=mount(url);assetUrls.set(url,mounted);manifest.assets.push({source:url,url:mounted,integrity});await put(mounted.slice(1),bytes);
   }
  }
  const paths=new Set<string>(),pages:{route:StaticExportPage<V>;params:Readonly<Record<string,string>>;pathname:string}[]=[];
  for(const route of routes){
   check();if(paths.size>=maxRoutes)fail('STATIC_ROUTE_LIMIT');const pattern=patterns.get(route.path)!;
   if('redirect'in route){if(pattern.parameters.length)fail('STATIC_REDIRECT_UNRESOLVED');if(paths.has(route.path))fail('STATIC_ROUTE_DUPLICATE');paths.add(route.path);manifest.hosting.redirects.push({from:route.path,to:route.redirect,status:route.status});continue;}
   if(pattern.parameters.length&&!route.params)fail('STATIC_PARAMS_REQUIRED');
   const routeController=new AbortController(),routeDeadline=Math.min(deadline,Date.now()+routeTimeout),routeTimer=setTimeout(()=>routeController.abort(),Math.max(1,routeDeadline-Date.now())),forward=()=>routeController.abort();controller.signal.addEventListener('abort',forward,{once:true});
   let iterator:AsyncIterator<Record<string,string>>|Iterator<Record<string,string>>|undefined;
   try{
    const values=route.params?await route.params(Object.freeze({signal:routeController.signal,deadline:routeDeadline})):[{}];
    if(!values||typeof (values as any)[Symbol.asyncIterator]!=='function'&&typeof(values as any)[Symbol.iterator]!=='function')fail('STATIC_PARAMS_INVALID');iterator=typeof(values as any)[Symbol.asyncIterator]==='function'?(values as any)[Symbol.asyncIterator]():(values as any)[Symbol.iterator]();let enumerated=0;
    while(true){check();if(routeController.signal.aborted||Date.now()>=routeDeadline)fail('STATIC_ENUMERATION_TIMEOUT');const next=await iterator!.next();check();if(routeController.signal.aborted||Date.now()>=routeDeadline)fail('STATIC_ENUMERATION_TIMEOUT');if(next.done)break;if(++enumerated>maxRoutes||paths.size>=maxRoutes)fail('STATIC_ROUTE_LIMIT');const params=publicValue(next.value);
     if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).sort().join(',')!==pattern.parameters.map(item=>item.name).sort().join(','))fail('STATIC_PARAMS_INVALID');let pathname=route.path;
     // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
     for(const parameter of pattern.parameters){const value=params[parameter.name];if(typeof value!=='string'||!value||!parameter.catchAll&&value.includes('/'))fail('STATIC_PARAMS_INVALID');const parts=value.split('/');if(parts.some(part=>!part||! /^[A-Za-z0-9._~-]+$/.test(part)||part==='.'||part==='..'||/[\\\x00-\x1f\x7f]/.test(part)||encodeURIComponent(part).length>200))fail('STATIC_PARAMS_INVALID');pathname=pathname.replace(':'+parameter.name+(parameter.catchAll?'*':''),parts.map(part=>encodeURIComponent(part)).join('/'));}
     if(pathname.length>2048||paths.has(pathname))fail('STATIC_ROUTE_DUPLICATE');paths.add(pathname);pages.push({route,params,pathname});
    }
    if(!enumerated)fail('STATIC_PARAMS_EMPTY');
   }finally{routeController.abort();try{await iterator?.return?.();}finally{clearTimeout(routeTimer);controller.signal.removeEventListener('abort',forward);}}
  }
  const redirects=new Map(manifest.hosting.redirects.map(item=>[item.from,item.to.replace(/\/$/,'')||'/']));
  for(const [from]of redirects){const visited=new Set<string>();let target=from;while(redirects.has(target)){if(visited.has(target))fail('STATIC_REDIRECT_CYCLE');visited.add(target);target=redirects.get(target)!;}if(options.mode!=='mixed'&&!paths.has(target)&&target!==mount('/404.html'))fail('STATIC_REDIRECT_UNRESOLVED');}
  if(paths.has(mount('/404.html')))fail('STATIC_OUTPUT_COLLISION');
  check();adapter=await options.renderer();if(!adapter||!adapter.capabilities?.staticHtml||adapter.capabilities.streaming||adapter.capabilities.hydration||adapter.capabilities.clientOnly)fail('STATIC_RENDERER_UNSUPPORTED');
  const validateHtml=(html:string,pathname:string)=>{
   if(/<!doctype|<\s*\/?\s*(?:html|head|body)(?:\s|>)/i.test(html))fail('STATIC_FRAGMENT_REQUIRED');
   const fragment=parseFragment(html);const pending:any[]=[fragment];let count=0;
   while(pending.length){const node=pending.pop();if(++count>50000)fail('STATIC_HTML_LIMIT');const name=node.tagName;if(['script','form','iframe','object','embed','base','meta','template'].includes(name))fail('STATIC_SERVER_FEATURE');
    for(const attr of node.attrs??[]){if(/^on/i.test(attr.name)||attr.name==='srcset'||/^_action_/.test(attr.value))fail('STATIC_SERVER_FEATURE');if(['src','href','action','srcdoc','poster','xlink:href'].includes(attr.name)){
      if(attr.name==='srcdoc')fail('STATIC_SERVER_FEATURE');const url=new URL(attr.value,origin!.origin+(pathname.endsWith('/404.html')?(base==='/'?'/':base+'/'):(pathname==='/'?'/':pathname+'/')));const resource=['src','poster'].includes(attr.name)||attr.name==='href'&&!['a','area'].includes(name);if(resource&&(url.origin!==origin!.origin||!Array.from(assetUrls.values()).includes(url.pathname)))fail('STATIC_ASSET_MISSING');if(!['http:','https:','mailto:','tel:'].includes(url.protocol))fail('STATIC_URL_INVALID');if(/\/_zerux\/actions\//.test(url.pathname))fail('STATIC_SERVER_FEATURE');if(url.origin===origin!.origin&&attr.value&&!attr.value.startsWith('#')){if(!(base==='/'||url.pathname===base||url.pathname.startsWith(base+'/')))fail('STATIC_BASE_INVALID');if((['src','poster'].includes(attr.name)||attr.name==='href'&&!['a','area'].includes(name))&&!Array.from(assetUrls.values()).includes(url.pathname))fail('STATIC_ASSET_MISSING');}
    }}
    pending.push(...(node.childNodes??[]));
   }
  };
  const render=async(view:V,pathname:string,signal:AbortSignal)=>{
   const registry=createRendererRegistry({maxBytes:maxPage,maxActive:1,timeoutMs:routeTimeout});
   try{const token=registry.register({...adapter!,render:adapter!.render.bind(adapter),dispose:undefined});const result=await registry.render(token,view,{requestId:'static-'+digest(pathname).slice(0,24),pathname,signal});if(!isRenderedHtml(result)||result.headers&&Object.keys(result.headers).length)fail('STATIC_PRIVATE_RESPONSE');validateHtml(result.html,pathname);return result.html;}finally{await registry.close();}
  };
  const document=(title:string,html:string,canonical?:string)=>`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title>${canonical?`<link rel="canonical" href="${escapeHtmlAttribute(canonical)}">`:''}</head><body>${html}</body></html>\n`;
  for(const page of pages.sort((a,b)=>a.pathname<b.pathname?-1:1)){
   const canonical=origin!.origin+(page.pathname==='/'?'/':page.pathname+'/');let html:string|undefined;
   for(let pass=0;pass<2;pass++){
    check();const local=new AbortController(),forward=()=>local.abort(),expires=Math.min(deadline,Date.now()+routeTimeout),timer=setTimeout(forward,Math.max(1,expires-Date.now()));controller.signal.addEventListener('abort',forward,{once:true});
    try{const context:StaticExportContext=new Proxy(Object.freeze({signal:local.signal,deadline:expires,pathname:page.pathname,canonical,asset(url:string){const value=assetUrls.get(url);if(!value)fail('STATIC_ASSET_MISSING');return value;}}),{get(target,key,receiver){if(typeof key==='string'&&!['signal','deadline','pathname','canonical','asset'].includes(key))fail('STATIC_REQUEST_CONTEXT_UNAVAILABLE');return Reflect.get(target,key,receiver);}});
     const view=publicValue(await page.route.view(page.params,context));if(local.signal.aborted||Date.now()>=expires)fail('STATIC_RENDER_TIMEOUT');const rendered=await render(view,page.pathname,local.signal);if(local.signal.aborted||Date.now()>=expires)fail('STATIC_RENDER_TIMEOUT');if(pass&&rendered!==html)fail('STATIC_NONDETERMINISTIC');html=rendered;
    }finally{local.abort();clearTimeout(timer);controller.signal.removeEventListener('abort',forward);}
   }
   const output=document(page.route.title??page.pathname,html!,canonical);if(Buffer.byteLength(output)>maxPage)fail('STATIC_PAGE_LIMIT');const file=(page.pathname==='/'?'':page.pathname.slice(1)+'/')+'index.html';await put(file,output);manifest.pages.push({url:page.pathname==='/'?'/':page.pathname+'/',file,status:200,canonical});if(page.pathname!=='/')manifest.hosting.redirects.push({from:page.pathname,to:page.pathname+'/',status:308});
  }
  const notFound=publicValue(options.notFound.view),missing=await render(notFound,mount('/404.html'),controller.signal);const missingAgain=await render(notFound,mount('/404.html'),controller.signal);if(missing!==missingAgain)fail('STATIC_NONDETERMINISTIC');const missingDocument=document(options.notFound.title??'Not found',missing);if(Buffer.byteLength(missingDocument)>maxPage)fail('STATIC_PAGE_LIMIT');await put(manifest.hosting.notFound.file,missingDocument);manifest.pages.push({url:mount('/404.html'),file:manifest.hosting.notFound.file,status:404});
  disposed=true;await adapter.dispose?.();check();
  manifest.files.sort((a,b)=>a.file<b.file?-1:1);manifest.pages.sort((a,b)=>a.url<b.url?-1:1);manifest.hosting.redirects.sort((a,b)=>a.from<b.from?-1:1);
  const serialized=JSON.stringify(manifest,null,2)+'\n';if(total+Buffer.byteLength(serialized)>maxBytes)fail('STATIC_OUTPUT_LIMIT');await fs.writeFile(path.join(stage,'static-export.json'),serialized,{flag:'wx',mode:0o644});
  for(const file of manifest.files){check();if(digest(await safeFile(root,path.join(stage!,file.file),16777216))!==file.sha256)fail('STATIC_CANDIDATE_MODIFIED');}
  await assertSafeBuildDirectories(root,out);await fs.chmod(stage!,0o755);check();const backup=path.join(parent,'.static-previous-'+randomUUID());let saved=false;
  try{try{await fs.rename(out,backup);saved=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}try{check();await fs.rename(stage,out);stage=undefined;}catch(error){if(saved)await fs.rename(backup,out);throw error;}if(saved)await fs.rm(backup,{recursive:true,force:true});}catch(cause){throw new StaticExportError('STATIC_PROMOTION_FAILED',cause);}
  return manifest;
 }catch(cause){throw cause instanceof StaticExportError?cause:new StaticExportError('STATIC_EXPORT_FAILED',cause);}
 finally{controller.abort();clearTimeout(timer);options.signal?.removeEventListener('abort',abort);try{if(adapter&&!disposed)await adapter.dispose?.();}finally{try{if(stage)await fs.rm(stage,{recursive:true,force:true});}finally{await lock.close();await fs.unlink(lockPath);}}}
}
