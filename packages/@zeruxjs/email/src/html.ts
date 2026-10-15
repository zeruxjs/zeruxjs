/** Email-friendly HTML. Use proven sanitization/inlining libraries rather than regex "sanitization". */
export function escapeHtml(value:unknown):string {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
export interface EmailLayoutOptions {maxWidth?:number;background?:string;direction?:'ltr'|'rtl';language?:string;preheader?:string}
function width(value?:number){if(value===undefined)return 600;if(!Number.isSafeInteger(value)||value<320||value>1000)throw new RangeError('Invalid email width');return value;}
function safeColor(v?:string,fallback='#f5f5f5'){if(!v)return fallback;if(!/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(v))throw new TypeError('Invalid background color');return v;}
/** Table wrapper for mainstream email clients; caller supplies trusted template HTML. */
export function createEmailLayout(content:string,opts:EmailLayoutOptions={}):string{
  const w=width(opts.maxWidth),background=safeColor(opts.background),direction=opts.direction??'ltr';
  const preheader=opts.preheader?`<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(opts.preheader).slice(0,400)}</div>`:'';
  return `<!doctype html><html lang="${escapeHtml(opts.language??'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title></title></head><body style="margin:0;padding:0;width:100%;background-color:${background};" dir="${direction}">${preheader}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;background-color:${background}"><tr><td align="center" valign="top"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="border-collapse:collapse;width:100%;max-width:${w}px;"><tr><td>${content}</td></tr></table></td></tr></table></body></html>`;
}
/** Explicit tables for columns; don't expect arbitrary CSS Grid/Flex to convert automatically. */
export function emailRow(cells:readonly string[],widths?:readonly number[]):string{
  if(!cells.length||cells.length>8)throw new RangeError('Email row requires 1–8 cells');
  if(widths&&(widths.length!==cells.length||widths.some(w=>!Number.isFinite(w)||w<=0)))throw new TypeError('Invalid column widths');
  const total=widths?.reduce((n,w)=>n+w,0)??cells.length;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%"><tr>${cells.map((cell,i)=>`<td valign="top" width="${Math.round(10000*(widths?.[i]??1)/total)/100}%" style="vertical-align:top">${cell}</td>`).join('')}</tr></table>`;
}
export function emailButton(text:string,url:string,background='#1267dc'):string{
  const target=new URL(url);if(target.protocol!=='https:'&&target.protocol!=='http:')throw new TypeError('Invalid email link');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${safeColor(background,'#1267dc')}" style="padding:12px 22px;border-radius:4px"><a href="${escapeHtml(target.href)}" style="color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:16px;display:inline-block">${escapeHtml(text)}</a></td></tr></table>`;
}
export interface HtmlConversionOptions extends EmailLayoutOptions {layout?:boolean;maxInputBytes?:number;allowImages?:boolean;allowRemoteImages?:boolean}
/** Sanitizes attacker-controlled HTML and inlines style rules for email clients. */
export async function convertHtmlToEmail(input:string,options:HtmlConversionOptions={}):Promise<string>{
  const max=options.maxInputBytes??1_000_000;
  if(!Number.isSafeInteger(max)||max<1||max>10_000_000)throw new RangeError('Invalid HTML size bound');
  if(typeof input!=='string'||Buffer.byteLength(input)>max)throw new RangeError('HTML input too large');
  const [{default:sanitizeHtml},{default:juice}]=await Promise.all([import('sanitize-html'),import('juice')]);
  const tags=['p','br','div','span','a','strong','b','em','i','u','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','hr','table','thead','tbody','tfoot','tr','td','th','pre','code','small','sup','sub','center'];
  if(options.allowImages!==false)tags.push('img');
  const sanitized=sanitizeHtml(input,{allowedTags:tags,allowedAttributes:{'*':['class','id','style','dir','align','width','height','role','cellpadding','cellspacing','border','bgcolor','valign'],a:['href','title','target'],img:['src','alt','width','height','title']},allowedSchemes:['https','http','mailto','cid'],allowedSchemesByTag:{img:options.allowRemoteImages===false?['cid']:['https','http','cid']},allowProtocolRelative:false,disallowedTagsMode:'discard',enforceHtmlBoundary:false,parseStyleAttributes:true});
  // Preserve media queries for responsive clients and apply common CSS styles inline.
  const inlined=juice(sanitized,{applyStyleTags:true,removeStyleTags:true,preserveMediaQueries:true});
  return options.layout===false?inlined:createEmailLayout(inlined,options);
}
export async function plainTextFromHtml(html:string):Promise<string>{
  const {convert}=await import('html-to-text');
  return convert(html,{wordwrap:100,selectors:[{selector:'img',format:'skip'},{selector:'a',options:{hideLinkHrefIfSameAsText:true}}]});
}
