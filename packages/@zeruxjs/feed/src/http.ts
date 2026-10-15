import type { FeedOptions } from './types.js';
import { createJsonFeed } from './json.js';
import { createRssFeed } from './rss.js';
import { createAtomFeed } from './atom.js';
import { getFeedContentType } from './content-type.js';
export function createFeedResponse(format:'rss'|'atom'|'json', options:FeedOptions, cacheSeconds=300): {body:string;headers:Record<string,string>;status:number} {
 if (!Number.isSafeInteger(cacheSeconds)||cacheSeconds<0||cacheSeconds>31536000) throw new RangeError('Invalid cacheSeconds');
 const body= format==='rss'?createRssFeed(options):format==='atom'?createAtomFeed(options):createJsonFeed(options);
 return {body,status:200,headers:{'content-type':getFeedContentType(format),'cache-control':`public, max-age=${cacheSeconds}`,'x-content-type-options':'nosniff'}};
}
