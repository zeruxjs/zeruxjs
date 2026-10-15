import { createHash } from 'node:crypto';
import { SearchIndex } from './search-index.js';
import type { SearchDocument, SearchOptions } from './types.js';

export interface SearchHttpOptions<T extends SearchDocument> {
  index: SearchIndex<T>;
  /** Absolute limit on a single search page. */
  maxResults?: number;
  /** Maximum request query length (Unicode code units). */
  maxQueryLength?: number;
  /** Optional application-owned document visibility policy. */
  filter?: (document: T) => boolean;
  /** Public cache lifetime; zero prevents shared caching. */
  cacheSeconds?: number;
  /** Fixed result fields to expose; default returns whole cloned documents. */
  fields?: (keyof T & string)[];
}
const json = (data: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers } });
function boundedInt(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  if (!/^(0|[1-9][0-9]{0,8})$/.test(value)) throw new RangeError('Invalid integer parameter');
  return Math.min(Number(value), maximum);
}
function conditional(request: Request, response: Response): Response {
  const etag = response.headers.get('etag');
  if (etag && request.headers.get('if-none-match')?.split(',').some(v => v.trim() === etag || v.trim() === '*'))
    return new Response(null, { status: 304, headers: response.headers });
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
/** A bounded, opt-in search API. Never exposes the index's mutable document references. */
export function createSearchHandler<T extends SearchDocument>(options: SearchHttpOptions<T>): (request: Request) => Response {
  const maxResults = options.maxResults ?? 50;
  const maxQueryLength = options.maxQueryLength ?? 256;
  const cacheSeconds = options.cacheSeconds ?? 0;
  if (![maxResults,maxQueryLength].every(v => Number.isSafeInteger(v) && v >= 1 && v <= 10000)) throw new RangeError('Invalid search limits');
  if (!Number.isSafeInteger(cacheSeconds) || cacheSeconds < 0 || cacheSeconds > 86400) throw new RangeError('Invalid cache lifetime');
  const fields = options.fields;
  if(options.filter && cacheSeconds) throw new TypeError('Filtered search responses cannot use public cache');
  if (fields?.some(f => f !== 'id' && !/^[a-zA-Z_][\w-]*$/.test(f))) throw new TypeError('Invalid search projection field');
  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method Not Allowed' }, 405, { allow: 'GET, HEAD' });
    try {
      const u = new URL(request.url);
      const q = u.searchParams.get('q') ?? '';
      if (q.length > maxQueryLength) return json({ error: 'Search query too long' }, 414);
      const limit = boundedInt(u.searchParams.get('limit'), 20, maxResults);
      const offset = boundedInt(u.searchParams.get('offset'), 0, 100000);
      const mode = u.searchParams.get('mode') ?? 'any';
      if (mode !== 'all' && mode !== 'any') return json({ error: 'Invalid search mode' }, 400);
      const prefix = u.searchParams.get('prefix');
      if (prefix !== null && prefix !== '0' && prefix !== '1') return json({ error: 'Invalid prefix option' }, 400);
      const suggest = u.searchParams.get('suggest');
      if (suggest !== null && suggest !== '0' && suggest !== '1') return json({ error: 'Invalid suggest option' }, 400);
      if(suggest === '1' && options.filter) return json({ error: 'Suggestions unavailable for filtered searches' }, 403);
      const results = q.trim() ? options.index.search(q, {
        limit, offset, mode: mode as SearchOptions['mode'], prefix: prefix === '1',
        filter: options.filter ? doc => options.filter!(structuredClone(doc as T)) : undefined
      }) : [];
      const projected = fields ? results.map(result => ({ ...result, document: Object.fromEntries(fields.map(field => [field, result.document[field]])) })) : results;
      const payload = suggest === '1'
        ? { query: q, suggestions: options.index.suggest(q, limit) }
        : { query: q, results: projected, limit, offset };
      const bytes = JSON.stringify(payload);
      const etag = `"${createHash('sha256').update(bytes).digest('base64url')}"`;
      const response = new Response(bytes, { headers: {
        'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff',
        'cache-control': cacheSeconds && !request.headers.has('authorization') && !request.headers.has('cookie') ? `public, max-age=${cacheSeconds}` : 'no-store',
        etag
      }});
      return conditional(request, response);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) return json({ error: 'Invalid search parameters' }, 400);
      throw error;
    }
  };
}
