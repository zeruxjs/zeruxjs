import type {FontDefinition,FontFaceOptions} from './types.js';
import {cssToken,fontUrl,fontFamily,fontFormat,escapeHtml} from './validate.js';
export function fontFace(options: FontFaceOptions): string { return defineFont({ ...options, sources:[{url:options.src,format:options.format}] }); }
export function defineFont(options: FontDefinition): string {
 if(!options.sources?.length)throw new TypeError('Font requires at least one source');
 const src=options.sources.map(s=>`url("${fontUrl(s.url)}")${s.format?` format("${fontFormat(s.format)}")`:''}`).join(',');
 const declarations=[`font-family:${fontFamily(options.family)}`,`src:${src}`,`font-style:${cssToken(options.style??'normal')}`,`font-weight:${cssToken(String(options.weight??400))}`,`font-display:${options.display??'swap'}`];
 for(const [k,v] of [['unicode-range',options.unicodeRange],['font-stretch',options.stretch],['font-feature-settings',options.featureSettings],['font-variation-settings',options.variationSettings]] as const)if(v)declarations.push(`${k}:${cssToken(v)}`);
 return `@font-face{${declarations.join(';')}}`;
}
export function fontStack(...families:string[]): string {return families.map(s=>/^(?:serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-serif|ui-sans-serif|ui-monospace|emoji|math|fangsong)$/i.test(s)?s:fontFamily(s)).join(', ');}
export function fontPreload(src:string,type='font/woff2'):string {fontUrl(src);if(!/^font\/[a-z0-9.+-]+$/i.test(type))throw new TypeError('Invalid font MIME type');return `<link rel="preload" href="${escapeHtml(src)}" as="font" type="${escapeHtml(type)}" crossorigin>`;}
export function fontStylesheetLink(src:string):string {fontUrl(src);return `<link rel="stylesheet" href="${escapeHtml(src)}">`;}
