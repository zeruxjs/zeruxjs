import { createHash } from 'node:crypto';
import type { SitemapEntry } from './types.js';
import { createSitemap, createSitemapIndex } from './sitemap.js';
import { createRobotsTxt } from './robots.js';

export interface CrawlerRoutesOptions {
  origin: string;
  entries: Iterable<SitemapEntry> | (() => Iterable<SitemapEntry> | Promise<Iterable<SitemapEntry>>);
  robots?: Parameters<typeof createRobotsTxt>[0];
  maxUrlsPerSitemap?: number;
  maxXmlBytes?: number;
  cacheSeconds?: number;
  /** Optional server-side snapshot TTL; zero rebuilds on every request. */
  snapshotTtlMs?: number;
}
export interface CrawlerRoute { path: string; handler: (request: Request) => Promise<Response> }
function respond(request: Request, body: string, contentType: string, cacheSeconds: number): Response {
  const etag=`"${createHash('sha256').update(body).digest('base64url')}"`;
  const headers={ 'content-type':contentType,'x-content-type-options':'nosniff','cache-control':`public, max-age=${cacheSeconds}`,etag };
  if(request.method!=='GET'&&request.method!=='HEAD') return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
  if(request.headers.get('if-none-match')?.split(',').some(t=>t.trim()===etag||t.trim()==='*'))return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:body,{headers});
}
/** Generates a sitemap index for large sites, and size-bounded individual pages. */
export function createCrawlerService(options:CrawlerRoutesOptions): {routes:CrawlerRoute[];invalidate():void} {
  const origin=new URL(options.origin);
  if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new TypeError('Crawler origin must be an HTTP(S) origin');
  const maxUrls=options.maxUrlsPerSitemap??10000;
  const maxBytes=options.maxXmlBytes??45_000_000;
  const ttl=options.cacheSeconds??600;
  const snapshotTtlMs=options.snapshotTtlMs??0;
  if(!Number.isSafeInteger(maxUrls)||maxUrls<1||maxUrls>50000)throw new RangeError('Invalid sitemap URL limit');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<2048||maxBytes>52_428_800)throw new RangeError('Invalid sitemap size limit');
  if(!Number.isSafeInteger(ttl)||ttl<0||ttl>31536000)throw new RangeError('Invalid crawler cache lifetime');
  if(!Number.isSafeInteger(snapshotTtlMs)||snapshotTtlMs<0||snapshotTtlMs>86400000)throw new RangeError('Invalid sitemap snapshot TTL');
  type Snapshot={pages:string[];index:string};
  const build = async (): Promise<Snapshot> => {
    const source=typeof options.entries==='function'?await options.entries():options.entries;
    const entries:SitemapEntry[]=[];
    for(const entry of source){if(entries.length>=500000)throw new RangeError('Too many sitemap URLs');entries.push(entry);}
    const pages:string[]=[];
    const append=(group:SitemapEntry[]):void=>{
      const xml=createSitemap(group);
      if(Buffer.byteLength(xml)<=maxBytes){pages.push(xml);return;}
      if(group.length===1)throw new RangeError('Sitemap entry exceeds byte limit');
      const split=Math.floor(group.length/2);
      append(group.slice(0,split));append(group.slice(split));
    };
    for(let i=0;i<entries.length;i+=maxUrls)append(entries.slice(i,i+maxUrls));
    if(!pages.length)pages.push(createSitemap([]));
    const index=createSitemapIndex(pages.map((_,i)=>({loc:new URL(`/sitemaps/${i+1}`,origin).href})));
    if(Buffer.byteLength(index)>52_428_800)throw new RangeError('Sitemap index exceeds the 50 MiB maximum');
    return {pages,index};
  };
  let cached:Snapshot|undefined;
  let expires=0;
  let pending:Promise<Snapshot>|undefined;
  let generation=0;
  const read=async():Promise<Snapshot>=>{
    if(snapshotTtlMs && cached && Date.now()<expires)return cached;
    if(pending)return pending;
    const current=generation;
    const task=build();pending=task;
    try{const result=await task;if(snapshotTtlMs&&current===generation){cached=result;expires=Date.now()+snapshotTtlMs;}return result;}
    finally{if(pending===task)pending=undefined;}
  };
  const dispatch = async (request:Request) => {
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
    const path=new URL(request.url).pathname;
    if(path==='/robots.txt')return respond(request,createRobotsTxt(options.robots??{sitemap:new URL('/sitemap.xml',origin).href}),'text/plain; charset=utf-8',ttl);
    const snapshot=await read();
    if(path==='/sitemap.xml')return respond(request,snapshot.pages.length===1?snapshot.pages[0]:snapshot.index,'application/xml; charset=utf-8',ttl);
    const matched=/^\/sitemaps\/([1-9][0-9]*)$/.exec(path);
    if(!matched)return new Response(null,{status:404});
    const index=Number(matched[1])-1;
    if(!Number.isSafeInteger(index)||index>=snapshot.pages.length)return new Response(null,{status:404});
    return respond(request,snapshot.pages[index],'application/xml; charset=utf-8',ttl);
  };
  // Wildcard route is optional; frameworks supporting dynamic paths can use the dispatch handler.
  return {routes:[{path:'/robots.txt',handler:dispatch},{path:'/sitemap.xml',handler:dispatch},{path:'/sitemaps/:page',handler:dispatch}],
    invalidate(){generation++;cached=undefined;expires=0;pending=undefined;}};
}

/** Backwards-compatible route builder without exposing the cache controller. */
export function createCrawlerRoutes(options:CrawlerRoutesOptions):CrawlerRoute[]{return createCrawlerService(options).routes;}
