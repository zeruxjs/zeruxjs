import { createHash } from 'node:crypto';
import { SearchIndex } from './search-index.js';
import type { SearchDocument, SearchOptions } from './types.js';

export interface SearchHttpOptions<T extends SearchDocument> {
  /** Borrowed index; the handler does not clear, persist, close or otherwise own it. */
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
/** Serialize fixed JSON responses with a content type and nosniff; payloads contain no mutable index references.
 * @param {unknown} data - Inert response payload selected by the handler.
 * @param {number} status - HTTP status; defaults to 200.
 * @param {HeadersInit} headers - Fixed host response headers; defaults to an empty object.
 * @returns {Response} New JSON representation with explicit encoding and nosniff headers.
 */
const json = (
  data: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
/** Parse a canonical nonnegative decimal parameter and cap it at the configured maximum.
 * @param {string | null} value - Query parameter text, or null to use the fallback.
 * @param {number} fallback - Existing default used only when the parameter is absent.
 * @param {number} maximum - Upper bound applied to a present valid decimal value.
 * @returns {number} Fallback or bounded parsed value; malformed text throws RangeError.
 */
function boundedInt(
  value: string | null,
  fallback: number,
  maximum: number
): number {
  if (value === null) {
    return fallback;
  }
  if (!/^(0|[1-9][0-9]{0,8})$/.test(value)) {
    throw new RangeError('Invalid integer parameter');
  }
  return Math.min(Number(value), maximum);
}
/** Apply representation ETag matching before removing a HEAD body. The caller supplies already-selected cache policy.
 * @param {Request} request - Borrowed incoming GET/HEAD request.
 * @param {Response} response - Prepared response with a representation-specific validator.
 * @returns {Response} 304 for a matching validator, bodyless HEAD, or the original response.
 */
function conditional(request: Request, response: Response): Response {
  /** Representation hash used for conditional responses; independent of document identity. */
  const etag = response.headers.get('etag');
  if (
    etag &&
    request.headers
      .get('if-none-match')
      ?.split(',')
      .some((v) => v.trim() === etag || v.trim() === '*')
  ) {
    return new Response(null, { status: 304, headers: response.headers });
  }
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}
/** Create an inert opt-in Fetch handler over a borrowed index. Hosts own routing and authorization; credentialed requests are no-store and filtered handlers cannot opt into public caching.
 * @param {SearchHttpOptions<T>} options - Host-owned index, fixed projection and bounded query/cache policy; no listener or server is started.
 * @returns {(request: Request) => Response} Synchronous GET/HEAD handler returning cloned bounded JSON. Invalid parameters have fixed public errors; unexpected failures propagate.
 */
export function createSearchHandler<T extends SearchDocument>(
  options: SearchHttpOptions<T>
): (request: Request) => Response {
  /** Validated per-page cap; defaults to 50. */
  const maxResults = options.maxResults ?? 50;
  /** Validated request query code-unit cap; defaults to 256. */
  const maxQueryLength = options.maxQueryLength ?? 256;
  /** Explicit public-cache opt-in; zero defaults to no-store and credentials suppress shared caching. */
  const cacheSeconds = options.cacheSeconds ?? 0;
  if (
    ![maxResults, maxQueryLength].every(
      (v) => Number.isSafeInteger(v) && v >= 1 && v <= 10000
    )
  ) {
    throw new RangeError('Invalid search limits');
  }
  if (
    !Number.isSafeInteger(cacheSeconds) ||
    cacheSeconds < 0 ||
    cacheSeconds > 86400
  ) {
    throw new RangeError('Invalid cache lifetime');
  }
  /** Borrowed fixed projection allowlist; hosts must not mutate configuration during requests. */
  const fields = options.fields;
  if (options.filter && cacheSeconds) {
    throw new TypeError('Filtered search responses cannot use public cache');
  }
  if (fields?.some((f) => f !== 'id' && !/^[a-zA-Z_][\w-]*$/.test(f))) {
    throw new TypeError('Invalid search projection field');
  }
  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method Not Allowed' }, 405, { allow: 'GET, HEAD' });
    }
    try {
      /** Parsed request URL; only documented query parameters influence search. */
      const u = new URL(request.url);
      /** Literal query text; it is never evaluated as code or a regular expression. */
      const q = u.searchParams.get('q') ?? '';
      if (q.length > maxQueryLength) {
        return json({ error: 'Search query too long' }, 414);
      }
      /** Validated page size clamped to the configured maximum. */
      const limit = boundedInt(u.searchParams.get('limit'), 20, maxResults);
      /** Validated offset capped at 100000. */
      const offset = boundedInt(u.searchParams.get('offset'), 0, 100000);
      /** Explicit any/all clause mode; unknown values return a fixed 400 response. */
      const mode = u.searchParams.get('mode') ?? 'any';
      if (mode !== 'all' && mode !== 'any') {
        return json({ error: 'Invalid search mode' }, 400);
      }
      /** Optional legacy prefix flag, restricted to 0 or 1. */
      const prefix = u.searchParams.get('prefix');
      if (prefix !== null && prefix !== '0' && prefix !== '1') {
        return json({ error: 'Invalid prefix option' }, 400);
      }
      /** Optional suggestion flag; filtered handlers deny vocabulary suggestions. */
      const suggest = u.searchParams.get('suggest');
      if (suggest !== null && suggest !== '0' && suggest !== '1') {
        return json({ error: 'Invalid suggest option' }, 400);
      }
      if (suggest === '1' && options.filter) {
        return json(
          { error: 'Suggestions unavailable for filtered searches' },
          403
        );
      }
      /** Independent index result clones, or an empty page for whitespace-only input. */
      const results = q.trim()
        ? options.index.search(q, {
            limit,
            offset,
            mode: mode as SearchOptions['mode'],
            prefix: prefix === '1',
            filter: options.filter
              ? (doc) => options.filter!(structuredClone(doc as T))
              : undefined,
          })
        : [];
      /** Fixed host-selected document fields; result rank and match metadata stay intact. */
      const projected = fields
        ? results.map((result) => ({
            ...result,
            document: Object.fromEntries(
              fields.map((field) => [field, result.document[field]])
            ),
          }))
        : results;
      /** One explicit JSON representation: results or suggestions. */
      const payload =
        suggest === '1'
          ? { query: q, suggestions: options.index.suggest(q, limit) }
          : { query: q, results: projected, limit, offset };
      /** Exact serialized response text whose bytes determine the strong validator. */
      const bytes = JSON.stringify(payload);
      /** Representation hash used for conditional responses; independent of document identity. */
      const etag = `"${createHash('sha256').update(bytes).digest('base64url')}"`;
      /** Owned response representation; conditional/HEAD handling removes its body when required. */
      const response = new Response(bytes, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'cache-control':
            cacheSeconds &&
            !request.headers.has('authorization') &&
            !request.headers.has('cookie')
              ? `public, max-age=${cacheSeconds}`
              : 'no-store',
          etag,
        },
      });
      return conditional(request, response);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return json({ error: 'Invalid search parameters' }, 400);
      }
      throw error;
    }
  };
}
