import type {CacheOptions} from './types.js';
const seconds=(n:number):number=>{if(!Number.isFinite(n)||n<0)throw new RangeError('Cache duration must be non-negative and finite');return Math.floor(n)};
export function createCacheHeaders(options:CacheOptions={}):Record<string,string>{if(options.noStore)return{'Cache-Control':'no-store'};const directives=[options.private?'private':'public',`max-age=${seconds(options.maxAge??0)}`];if(options.sMaxAge!==undefined)directives.push(`s-maxage=${seconds(options.sMaxAge)}`);if(options.immutable)directives.push('immutable');if(options.mustRevalidate)directives.push('must-revalidate');if(options.staleWhileRevalidate!==undefined)directives.push(`stale-while-revalidate=${seconds(options.staleWhileRevalidate)}`);if(options.staleIfError!==undefined)directives.push(`stale-if-error=${seconds(options.staleIfError)}`);return{'Cache-Control':directives.join(', ')}}
export function createETag(content:string|Uint8Array):string{let hash=2166136261;const bytes=typeof content==='string'?new TextEncoder().encode(content):content;for(const byte of bytes){hash^=byte;hash=Math.imul(hash,16777619)}return `W/"${bytes.length.toString(16)}-${(hash>>>0).toString(16)}"`}
/** Weak comparison is allowed for If-None-Match; strong comparisons are needed for If-Match. */
export function matchesETag(header:string|null|undefined,etag:string):boolean{
 if(!header)return false;const normalize=(tag:string)=>tag.trim().replace(/^W\//,'');return header.trim()==='*'||header.split(',').some(tag=>normalize(tag)===normalize(etag));
}
export function matchesStrongETag(header:string|null|undefined,etag:string):boolean{
 if(!header||etag.startsWith('W/'))return false;return header.trim()==='*'||header.split(',').some(tag=>tag.trim()===etag);
}
