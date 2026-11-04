import type {FontRegistry} from './registry.js';
import type {FontAssetManifest} from './build.js';
import {createFontRegistry} from './registry.js';
import {fontStack,defineFont} from './css.js';
import {fontUrl} from './validate.js';
import {fontIcon} from './icons.js';

/** Structural subset of Zuixs' public plugin API; no compiler dependency at runtime. */
export interface FontThemeAPI {
 addUtilities(items:Record<string,Record<string,string|number>>):void;
 addBase(css:string):void;
 theme(path:string,fallback?:string):string;
}
export interface FontToken {token:string;key:string;fallback?:readonly string[]}
export interface FontZuixOptions {
 registry:FontRegistry;
 assets:FontAssetManifest;
 fonts:readonly FontToken[];
 icons?:readonly {token:string;key:string}[];
}
const tokenPattern=/^[a-z][a-z0-9-]{0,47}$/;
function token(value:string){if(typeof value!=='string'||!tokenPattern.test(value)||['constructor','prototype','__proto__'].includes(value))throw new TypeError('Invalid font theme token');return value;}
/** Snapshot only explicitly selected faces. Returned CSS must be served as an external stylesheet. */
export function createFontZuixAdapter(options:FontZuixOptions){
 if(!options||options.assets?.schema!==1||!Array.isArray(options.assets.fonts)||options.assets.fonts.length>64||!Array.isArray(options.assets.icons)||options.assets.icons.length>256||!Array.isArray(options.fonts)||options.fonts.length>64||!Array.isArray(options.icons??[])||(options.icons?.length??0)>256)throw new TypeError('Invalid font adapter input');
 const entries=options.registry.entries();if(entries.length>64)throw new RangeError('Font registry limit');
 const source=new Map(entries),assets=new Map(options.assets.fonts.map(face=>[face.key,structuredClone(face)]));
 if(assets.size!==options.assets.fonts.length)throw new TypeError('Duplicate manifest font key');
 const registry=createFontRegistry(),families:Record<string,string>=Object.create(null),weights:Record<string,string>=Object.create(null),stacks:Record<string,string>=Object.create(null);
 const fonts:FontAssetManifest['fonts']=[],icons:FontAssetManifest['icons']=[],seen=new Set<string>(),used=new Set<string>();
 function select(key:string){
  const face=source.get(key),asset=assets.get(key);
  if(!face||!asset)throw new TypeError('Selected font is missing from registry or asset manifest');
  defineFont(face);fontUrl(asset.url);
  if(!asset.url.startsWith('/')||asset.url.startsWith('//')||face.family!==asset.family||String(face.weight??400)!==asset.weight||(face.style??'normal')!==asset.style||!face.sources.some(s=>s.url===asset.url)||!Object.hasOwn({woff2:1,woff:1,truetype:1,opentype:1},asset.format)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1)throw new TypeError('Font registry/asset manifest mismatch');
  if(!used.has(key)){registry.add(key,{...face,sources:[{url:asset.url,format:asset.format}]});fonts.push(structuredClone(asset));used.add(key);}
  return face;
 }
 const mappings=options.fonts.map(item=>({...item})).sort((a,b)=>a.token<b.token?-1:a.token>b.token?1:0);
 for(const mapping of mappings){
  const name=token(mapping.token);if(seen.has(name))throw new TypeError('Font theme token collision');seen.add(name);
  const face=select(mapping.key),fallback=mapping.fallback??['system-ui','sans-serif'];
  if(!Array.isArray(fallback)||!fallback.length||fallback.length>8)throw new TypeError('Font fallback stack required');
  for(const family of fallback)defineFont({family,sources:[{url:'/validation.woff2'}]});
  stacks[name]=fontStack(...new Set([face.family,...fallback,'system-ui','sans-serif']));families[name]=`var(--zx-font-${name})`;
  const weight=String(face.weight??400);
  // A variable range is a face descriptor, not a valid font-weight property value.
  weights[name]=weight.includes(' ')?weight.split(' ')[0]:weight;
 }
 const iconKeys=new Map(options.assets.icons.map(icon=>[icon.key,icon]));if(iconKeys.size!==options.assets.icons.length)throw new TypeError('Duplicate manifest icon key');
 const iconUtilities:Record<string,Record<string,string>>=Object.create(null);
 for(const mapping of [...(options.icons??[])].sort((a,b)=>a.token<b.token?-1:a.token>b.token?1:0)){
  const name=token(mapping.token);if(seen.has(name))throw new TypeError('Font theme token collision');seen.add(name);
  const icon=iconKeys.get(mapping.key);if(!icon)throw new TypeError('Selected icon is missing');
  if(icon.kind==='font'){
   const face=select(icon.fontKey);fontIcon(icon.codePoint,face.family);
   // Glyph text remains explicit DOM text, never CSS generated content or HTML.
   stacks[name]=fontStack(face.family,'sans-serif');families[name]=`var(--zx-font-${name})`;
   iconUtilities[`icon-${name}`]={'font-family':families[name],'font-style':(face.style??'normal').replace(/(-?\d+(?:\.\d+)?deg)\s+-?\d+(?:\.\d+)?deg$/, '$1'),'font-weight':String(face.weight??400).split(' ')[0]};
  }else if(icon.kind==='svg'){fontUrl(icon.url);if(!icon.url.startsWith('/')||icon.url.startsWith('//'))throw new TypeError('Icon must be a local asset');}
  else throw new TypeError('Unsupported icon kind');
  icons.push(structuredClone(icon));
 }
 const theme={fontFamily:families,fontWeight:weights};
 const plugin=(api:FontThemeAPI)=>{
  api.addBase(`:root{${Object.keys(stacks).sort().map(name=>`--zx-font-${name}:${stacks[name]};`).join('')}}`);
  const utilities:Record<string,Record<string,string>>=Object.create(null);
  for(const name of Object.keys(families))utilities[`font-family-${name}`]={'font-family':api.theme(`fontFamily.${name}`,families[name])};
  for(const name of Object.keys(weights))utilities[`font-weight-${name}`]={'font-weight':api.theme(`fontWeight.${name}`,weights[name])};
  for(const [name,values] of Object.entries(iconUtilities))utilities[name]={...values,'font-family':api.theme(`fontFamily.${name.slice(5)}`,values['font-family'])};
  api.addUtilities(utilities);
 };
 fonts.sort((a,b)=>a.key<b.key?-1:1);icons.sort((a,b)=>a.key<b.key?-1:1);
 return {theme,plugin,registry,css:registry.css(),manifest:{schema:1 as const,sourceDigest:options.assets.digest,fonts,icons},
  /** Explicit route selections; one call unions routes and deduplicates binary URLs. */
  preloads(routes:readonly (readonly string[])[],budget:{maxCount:number;maxBytes:number}={maxCount:2,maxBytes:128*1024}){
   if(!Array.isArray(routes)||routes.length>256||!Number.isSafeInteger(budget.maxCount)||budget.maxCount<0||budget.maxCount>16||!Number.isSafeInteger(budget.maxBytes)||budget.maxBytes<0||budget.maxBytes>16*1024*1024)throw new RangeError('Invalid preload budget');
   const urls=new Map<string,{url:string;type:string;bytes:number}>();
   for(const route of routes){if(!Array.isArray(route)||route.length>64)throw new RangeError('Route font limit');for(const name of route){const mapping=mappings.find(item=>item.token===name);if(!mapping)throw new TypeError('Unknown route font token');const asset=assets.get(mapping.key)!;urls.set(asset.url,{url:asset.url,type:`font/${({truetype:'ttf',opentype:'otf',woff:'woff',woff2:'woff2'} as const)[asset.format]}`,bytes:asset.bytes});}}
   const result=[...urls.values()].sort((a,b)=>a.url<b.url?-1:1);if(result.length>budget.maxCount||result.reduce((n,item)=>n+item.bytes,0)>budget.maxBytes)throw new RangeError('Font preload budget exceeded');return result;
  }};
}
