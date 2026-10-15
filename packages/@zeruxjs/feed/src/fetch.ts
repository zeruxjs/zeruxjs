import { createHash } from 'node:crypto';
import type { FeedOptions } from './types.js';
import { createFeedResponse } from './http.js';

export type FeedFormat = 'rss' | 'atom' | 'json';
export interface FeedFetchOptions {
  /** Called on each request, or return a fixed feed. */
  feed: FeedOptions | (() => FeedOptions | Promise<FeedOptions>);
  format?: FeedFormat | 'negotiate';
  cacheSeconds?: number;
  maxItems?: number;
}
function preferredFormat(accept: string): FeedFormat | undefined {
  if(!accept.trim())return 'rss';
  const values=accept.split(',').map((token,i)=>{
    const [type,...parameters]=token.trim().split(';').map(x=>x.trim().toLowerCase());
    const qParam=parameters.find(param=>param.startsWith('q='));
    const quality=qParam?Number(qParam.slice(2)):1;
    return {type,quality:Number.isFinite(quality)&&quality>=0&&quality<=1?quality:0,i};
  });
  const formats:[FeedFormat,string][]=[['rss','application/rss+xml'],['atom','application/atom+xml'],['json','application/feed+json']];
  const candidates=formats.map(([format,mime],index)=>{
    const applicable=values.map(v=>({...v,specificity:v.type===mime?2:v.type==='application/*'?1:v.type==='*/*'?0:-1})).filter(v=>v.specificity>=0);
    applicable.sort((a,b)=>b.specificity-a.specificity||a.i-b.i);
    return {format,quality:applicable[0]?.quality??0,index};
  }).filter(candidate=>candidate.quality>0).sort((a,b)=>b.quality-a.quality||a.index-b.index);
  return candidates[0]?.format;
}
/** Fetch-compatible RSS/Atom/JSON Feed endpoint with conditional GET and HEAD support. */
export function createFeedFetchHandler(options: FeedFetchOptions): (request: Request) => Promise<Response> {
  const cacheSeconds= options.cacheSeconds ?? 300;
  const maxItems=options.maxItems ?? 1000;
  if(!Number.isSafeInteger(cacheSeconds)||cacheSeconds<0||cacheSeconds>31536000) throw new RangeError('Invalid feed cache lifetime');
  if(!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>10000) throw new RangeError('Invalid maxItems');
  if(options.format && !['rss','atom','json','negotiate'].includes(options.format))throw new TypeError('Invalid feed format');
  return async (request) => {
    if(request.method!=='GET'&&request.method!=='HEAD') return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
    const negotiated=options.format==='negotiate'?preferredFormat(request.headers.get('accept')??''):undefined;
    if(options.format==='negotiate'&&!negotiated)return new Response(null,{status:406,headers:{vary:'Accept'}});
    const source=typeof options.feed==='function'?await options.feed():options.feed;
    if(!source || !Array.isArray(source.items)) throw new TypeError('Invalid feed');
    const feed={...source,items:source.items.slice(0,maxItems)};
    const format=negotiated??(options.format==='negotiate'?'rss':options.format??'rss');
    const result=createFeedResponse(format,feed,cacheSeconds);
    const etag=`"${createHash('sha256').update(result.body).digest('base64url')}"`;
    const headers=new Headers(result.headers);
    headers.set('etag',etag);
    if(options.format==='negotiate')headers.set('vary','Accept');
    const timestamp=source.updated ? new Date(source.updated).getTime() : Math.max(0,...feed.items.map(i=>i.updated??i.date).filter(Boolean).map(d=>new Date(d!).getTime()).filter(Number.isFinite));
    if(Number.isFinite(timestamp)&&timestamp>0)headers.set('last-modified',new Date(timestamp).toUTCString());
    if(request.headers.get('if-none-match')?.split(',').some(tag=>tag.trim()===etag||tag.trim()==='*')) return new Response(null,{status:304,headers});
    if(!request.headers.has('if-none-match')&&timestamp>0) {
      const since=request.headers.get('if-modified-since');
      if(since && Number.isFinite(Date.parse(since)) && timestamp < Date.parse(since)+1000) return new Response(null,{status:304,headers});
    }
    return new Response(request.method==='HEAD'?null:result.body,{status:200,headers});
  };
}
