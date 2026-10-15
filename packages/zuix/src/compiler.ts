import {resolveTheme} from './theme.js';
import {utilityFor} from './utilities.js';
import type {Declarations} from './utilities.js';
import type {ZuixConfig,GenerateResult,ZuixPluginAPI} from './types.js';
import {cssEscapeClass,resolveLimits,safeCondition,safeDeclaration} from './safety.js';
export const preflight = `*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:currentColor}html{line-height:1.5;-webkit-text-size-adjust:100%;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;line-height:inherit}button,input,select,textarea{font:inherit}button{cursor:pointer}img,svg,video,canvas{display:block;max-width:100%}a{color:inherit;text-decoration:inherit}h1,h2,h3,h4,h5,h6,p{margin:0}ol,ul{list-style:none;margin:0;padding:0}`;

function splitVariants(input:string):string[] {const result:string[]=[];let buf='',depth=0;for(const ch of input){if(ch==='[')depth++;else if(ch===']')depth--;if(ch===':'&&depth===0){result.push(buf);buf='';}else buf+=ch;}result.push(buf);return result;}
function cssDeclarations(decls:Declarations,important:boolean):string|undefined{const entries=Object.entries(decls);if(!entries.length||entries.some(([prop,val])=>!safeDeclaration(prop,String(val))))return;return entries.map(([prop,val])=>`${prop}:${String(val)}${important?' !important':''};`).join('');}
const pseudo:Record<string,string>={ 'first-letter':'::first-letter','first-line':'::first-line',marker:'::marker',backdrop:'::backdrop','file':'::file-selector-button','open':':is([open],:popover-open)',target:':target','only':':only-child','first-of-type':':first-of-type','last-of-type':':last-of-type','only-of-type':':only-of-type','read-only':':read-only','read-write':':read-write','autofill':':autofill','indeterminate':':indeterminate','in-range':':in-range','out-of-range':':out-of-range','placeholder-shown':':placeholder-shown',default:':default',optional:':optional',autofocus:':focus-visible',hover:':hover',focus:':focus','focus-visible':':focus-visible','focus-within':':focus-within',active:':active',disabled:':disabled',enabled:':enabled',checked:':checked',required:':required',invalid:':invalid',valid:':valid',first:':first-child',last:':last-child',odd:':nth-child(odd)',even:':nth-child(even)',visited:':visited',empty:':empty',before:'::before',after:'::after',placeholder:'::placeholder',selection:'::selection'};
function safeQuery(value:string):boolean{return safeCondition(value);}
function safeSelector(value:string):boolean{return value.length<=120&&/^[a-zA-Z0-9.#:[\]_'\"()=~+* >|-]+$/.test(value);}
export function createZuix(config:ZuixConfig={}) {
 const theme=resolveTheme(config);const limits=resolveLimits(config.limits);const utilities:Record<string,Declarations>={};const components:Record<string,Declarations>={};const base:string[]=[];
 const api:ZuixPluginAPI={
  addUtilities(items){for(const [key,value] of Object.entries(items))utilities[key.replace(/^\./,'')]=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,String(v)]));},
  addComponents(items){for(const [key,value] of Object.entries(items))components[key.replace(/^\./,'')]=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,String(v)]));},
  addBase(css){base.push(css);},
  theme(path,fallback=''){const [category,...rest]=path.split('.');return String(theme[category]?.[rest.join('.')]??fallback);}
 };for(const plugin of config.plugins??[])plugin(api);
 function compileClass(token:string):string|undefined {
  if(typeof token!=='string'||!token||token.length>limits.maxTokenLength||/[\u0000-\u001f\u007f{};\\]/.test(token))return;
  const chunks=splitVariants(token);if(chunks.length>12)return;let name=chunks.pop()??'';const variants=chunks;
  if(config.prefix){if(!name.startsWith(config.prefix))return;name=name.slice(config.prefix.length);}
  const important=name.startsWith('!')||Boolean(config.important);if(name.startsWith('!'))name=name.slice(1);
  const decl=utilityFor(name,theme,{...utilities,...components});if(!decl)return;const body=cssDeclarations(decl,important);if(!body)return;
  let selector=`.${cssEscapeClass(token)}`;let atRules:string[]=[];let groupPeer='';
  for(const variant of variants){
   if(Object.hasOwn(theme.screens,variant)){const screen=String(theme.screens[variant]);if(!/^(?:\d+(?:\.\d+)?)(?:px|rem|em)$/.test(screen))return;atRules.push(`@media (min-width: ${screen})`);continue;}
   if(variant==='dark'){if(config.darkMode==='media')atRules.push('@media (prefers-color-scheme: dark)');else selector=`:is(.dark ${selector},[data-theme="dark"] ${selector})`;continue;}
   if(variant==='print'){atRules.push('@media print');continue;}
   if(variant==='motion-reduce'){atRules.push('@media (prefers-reduced-motion: reduce)');continue;}
   if(variant==='motion-safe'){atRules.push('@media (prefers-reduced-motion: no-preference)');continue;}
   if(variant==='portrait'||variant==='landscape'){atRules.push(`@media (orientation: ${variant})`);continue;}
   if(variant==='motion' || variant==='hoverable'){atRules.push('@media (hover: hover) and (pointer: fine)');continue;}
   if(variant==='forced-colors'){atRules.push('@media (forced-colors: active)');continue;}
   if(variant==='contrast-more'||variant==='contrast-less'){atRules.push(`@media (prefers-contrast: ${variant==='contrast-more'?'more':'less'})`);continue;}
   if(variant==='rtl'||variant==='ltr'){selector=`:where([dir="${variant}"]) ${selector}`;continue;}
   if(variant==='starting'){atRules.push('@starting-style');continue;}
   if(variant.startsWith('supports-[')&&variant.endsWith(']')){const query=variant.slice(10,-1).replace(/_/g,' ');if(!safeQuery(query))return;atRules.push(`@supports (${query})`);continue;}
   if(variant.startsWith('media-[')&&variant.endsWith(']')){const query=variant.slice(7,-1).replace(/_/g,' ');if(!safeQuery(query))return;atRules.push(`@media (${query})`);continue;}
   if(variant.startsWith('container-[')&&variant.endsWith(']')){const query=variant.slice(11,-1).replace(/_/g,' ');if(!safeQuery(query))return;atRules.push(`@container (${query})`);continue;}
   if(variant.startsWith('cq-')){const key=variant.slice(3);if(!Object.hasOwn(theme.screens,key))return;const screen=String(theme.screens[key]);if(!/^(?:\d+(?:\.\d+)?)(?:px|rem|em)$/.test(screen))return;atRules.push(`@container (min-width: ${screen})`);continue;}
   if(variant==='group-hover' ||variant==='group-focus'){groupPeer=`.group:${variant.slice(6)} `+groupPeer;continue;}
   if(variant==='peer-checked'||variant==='peer-focus'){groupPeer=`.peer:${variant.slice(5)} ~ `+groupPeer;continue;}
   if(variant in pseudo){selector+=pseudo[variant];continue;}
   if(variant.startsWith('has-[')&&variant.endsWith(']')){const nested=variant.slice(5,-1);if(!safeSelector(nested))return;selector+=`:has(${nested})`;continue;}
   if(variant.startsWith('not-[')&&variant.endsWith(']')){const nested=variant.slice(5,-1);if(!safeSelector(nested))return;selector+=`:not(${nested})`;continue;}
   if(variant.startsWith('aria-')){const attr=variant.slice(5);if(!/^[a-z-]+$/.test(attr))return;selector+=`[aria-${attr}="true"]`;continue;}
   if(variant.startsWith('data-')){const attr=variant.slice(5);if(!/^[a-z-]+$/.test(attr))return;selector+=`[data-${attr}]`;continue;}
   return;
  }
  selector=groupPeer+selector;
  let rule=`${selector}{${body}}`;
  for(const atRule of atRules.reverse())rule=`${atRule}{${rule}}`;
  return rule;
 }
 function generate(tokens:Iterable<string>):GenerateResult {
  const classSet=new Set<string>();const add=(token:string)=>{if(typeof token!=='string')throw new Error('zuix: class tokens must be strings');classSet.add(token);if(classSet.size>limits.maxClasses)throw new Error('zuix: maxClasses limit exceeded');};
  for(const token of tokens)add(token);for(const token of config.safelist??[])add(token);
  const classes=[...classSet].filter(Boolean).sort();const unmatched:string[]=[];const rules:string[]=[];
  for(const name of classes){const rule=compileClass(name);if(rule)rules.push(rule);else unmatched.push(name);}
  // Merge identical declaration blocks only when they occupy the same at-rule context.
  // Never merge distinct declarations or reorder conflicting rules.
  const merged:string[]=[];const seen=new Set<string>();
  for(const rule of rules){if(!seen.has(rule)){seen.add(rule);merged.push(rule);}}
  const builtin:Record<string,string>={
   'zuix-spin':'to{transform:rotate(360deg)}',
   'zuix-pulse':'50%{opacity:.5}',
   'zuix-bounce':'0%,100%{transform:translateY(-25%);animation-timing-function:cubic-bezier(.8,0,1,1)}50%{transform:none;animation-timing-function:cubic-bezier(0,0,.2,1)}',
   'zuix-ping':'75%,100%{transform:scale(2);opacity:0}'
  };
  const frames={...builtin,...config.keyframes};
  const usedRules=merged.join('');
  const keyframes=Object.entries(frames).filter(([name])=>/^[a-zA-Z][\w-]{0,79}$/.test(name)&&usedRules.includes(name)&&new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(usedRules)).map(([name,value])=>`@keyframes ${name}{${value}}`);
  const chunks=[config.preflight===false?'':preflight,...base,...keyframes,...merged].filter(Boolean);
  return {css:chunks.join(config.minify?'':'\n'),classes,unmatched};
 }

 return {config,theme,compileClass,generate};
}
export function generateCSS(classes:Iterable<string>,config:ZuixConfig={}):string{return createZuix(config).generate(classes).css;}
