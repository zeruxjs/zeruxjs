import type { SitemapEntry } from './types.js';
import { createSitemap } from './sitemap.js';
import { createRobotsTxt } from './robots.js';
export function sitemapResponse(entries: Iterable<SitemapEntry>): {status:number;body:string;headers:Record<string,string>} {
 return {status:200,body:createSitemap(entries),headers:{'content-type':'application/xml; charset=utf-8','x-content-type-options':'nosniff'}};
}
export function robotsResponse(options?: Parameters<typeof createRobotsTxt>[0]): {status:number;body:string;headers:Record<string,string>} {
 return {status:200,body:createRobotsTxt(options),headers:{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'}};
}
