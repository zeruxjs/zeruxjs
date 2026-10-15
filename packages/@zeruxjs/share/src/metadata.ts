import type {ShareData} from './types.js';
import {normalizedShareData,validatedShareUrl} from './url.js';
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/** Build safe metadata tags; the application controls where they are inserted in the HTML head. */
export function createShareMetadata(input:ShareData & {image?:string;siteName?:string;type?:'website'|'article'},options:{maxTextLength?:number}={}):string[]{
 const data=normalizedShareData(input);const max=options.maxTextLength??300;
 if(!Number.isInteger(max)||max<1||max>10000)throw new RangeError('Invalid metadata text limit');
 const tags:[string,string][]=[['og:url',data.url],['og:type',data.type??'website']];
 if(data.title)tags.push(['og:title',data.title.slice(0,max)]);
 if(data.text)tags.push(['og:description',data.text.slice(0,max)]);
 if(data.image)tags.push(['og:image',validatedShareUrl(data.image)]);
 if(data.siteName)tags.push(['og:site_name',data.siteName.slice(0,max)]);
 return tags.map(([name,value])=>`<meta property="${name}" content="${escape(value)}">`);
}
export function createCanonicalShareLink(url:string):string{return `<link rel="canonical" href="${escape(validatedShareUrl(url))}">`}
