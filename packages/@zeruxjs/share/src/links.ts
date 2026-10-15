import type {ShareData} from './types.js';
import {validatedShareUrl} from './url.js';
export function shareLinks(data:ShareData) {const url=validatedShareUrl(data.url),title=data.title??'',text=data.text??'';const params=(base:string,values:Record<string,string>)=>`${base}?${new URLSearchParams(values)}`;return {x:params('https://twitter.com/intent/tweet',{url,text:[title,text].filter(Boolean).join(' ')}),linkedin:params('https://www.linkedin.com/sharing/share-offsite/',{url}),facebook:params('https://www.facebook.com/sharer/sharer.php',{u:url}),whatsapp:`https://wa.me/?${new URLSearchParams({text:[title,text,url].filter(Boolean).join(' ')})}`,email:`mailto:?${new URLSearchParams({subject:title,body:[text,url].filter(Boolean).join('\n')})}`};}
export function shareLink(provider:keyof ReturnType<typeof shareLinks>,data:ShareData):string{return shareLinks(data)[provider];}
/** Use when displaying a plain href outside a browser share sheet. */
export function shareLinkAttributes(provider:keyof ReturnType<typeof shareLinks>,data:ShareData){return{href:shareLink(provider,data),rel:'noopener noreferrer',target:'_blank' as const}}
