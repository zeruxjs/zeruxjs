import {escapeHtml,fontFamily} from './validate.js';
export interface SvgIcon {viewBox:readonly [number,number,number,number];paths:readonly {d:string;fill?:'none'|'currentColor'|string}[]}
export function validateSvgIcon(input:SvgIcon):SvgIcon{
 if(!input||Object.keys(input).some(key=>!['viewBox','paths'].includes(key))||!Array.isArray(input.viewBox)||input.viewBox.length!==4||input.viewBox.some(v=>!Number.isFinite(v)||Math.abs(v)>100000)||input.viewBox[2]<=0||input.viewBox[3]<=0||!Array.isArray(input.paths)||!input.paths.length||input.paths.length>128)throw new TypeError('Invalid structured SVG icon');
 return {viewBox:[...input.viewBox] as [number,number,number,number],paths:input.paths.map(path=>{if(!path||Object.keys(path).some(key=>!['d','fill'].includes(key))||typeof path.d!=='string'||!path.d||path.d.length>8192||! /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/.test(path.d)||/[\x00-\x1f\x7f]/.test(path.d)||path.fill!==undefined&&! /^(?:none|currentColor|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8})$/.test(path.fill))throw new TypeError('Unsafe SVG path');return {d:path.d,...(path.fill?{fill:path.fill}:{})};})};
}
export function svgIconMarkup(input:SvgIcon,options:{decorative?:boolean;label?:string}={}):string{
 const icon=validateSvgIcon(input),decorative=options.decorative??true;if(typeof decorative!=='boolean'||!decorative&&(typeof options.label!=='string'||!options.label.trim()||options.label.length>256))throw new TypeError('Meaningful icon requires a label');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox.join(' ')}" focusable="false" ${decorative?'aria-hidden="true"':`role="img" aria-label="${escapeHtml(options.label!)}"`}>${icon.paths.map(path=>`<path d="${escapeHtml(path.d)}" fill="${path.fill??'currentColor'}"/>`).join('')}</svg>`;
}
/** Plain glyph text plus validated CSS family, never arbitrary HTML. */
export function fontIcon(codePoint:number,family:string):{text:string;fontFamily:string}{if(!Number.isSafeInteger(codePoint)||codePoint<0x20||codePoint>0x10ffff||codePoint>=0xd800&&codePoint<=0xdfff||codePoint===0x7f)throw new TypeError('Invalid icon code point');return {text:String.fromCodePoint(codePoint),fontFamily:fontFamily(family)};}
