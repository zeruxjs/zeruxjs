import { createHash } from 'node:crypto';
import type { FontRegistry } from './registry.js';
/** Borrowed public-registry HTTP policy with explicit cache and preload bounds. */
export interface FontStylesheetOptions {
  /** Borrowed mutable registry; current CSS is read for each request. */
  registry: FontRegistry;
  /** Public max-age seconds, default 300 and ceiling 31536000; no authenticated cache isolation. */
  cacheSeconds?: number;
  /** Explicit copied registry keys, at most 64; absent keys do not preload implicitly. */
  preloadKeys?: string[];
  /** Unique binary URL ceiling, default/hard maximum 16; overflow rejects. */
  maxPreloads?: number;
}
/** Create an inert public GET/HEAD CSS endpoint over a borrowed registry, without downloading binaries or owning a close handle.
 * @param {FontStylesheetOptions} options - Trusted registry, public cache lifetime and explicit bounded preload keys.
 * @returns {Function} Fetch handler with representation ETag/304; no principal authorization or private response cache is inferred.
 */
export function createFontStylesheetHandler(
  options: FontStylesheetOptions
): (request: Request) => Response {
  /** Validated public stylesheet cache lifetime in seconds, default 300. */
  const ttl = options.cacheSeconds ?? 300;
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 31536000) {
    throw new RangeError('Invalid stylesheet cache lifetime');
  }
  /** Validated unique preload URL ceiling, default/hard maximum 16. */
  const maxPreloads = options.maxPreloads ?? 16;
  if (
    !Number.isSafeInteger(maxPreloads) ||
    maxPreloads < 0 ||
    maxPreloads > 16 ||
    (options.preloadKeys !== undefined &&
      (!Array.isArray(options.preloadKeys) || options.preloadKeys.length > 64))
  ) {
    throw new RangeError('Invalid stylesheet preload budget');
  }
  /** Copied explicit key selection; no fonts are implicitly selected. */
  const preloadKeys = options.preloadKeys
    ? [...options.preloadKeys]
    : undefined;
  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    /** Current borrowed registry CSS; mutations produce a new representation identity. */
    const css = options.registry.css();
    /** Fresh public stylesheet headers; not an authenticated/private endpoint. */
    const headers = new Headers({
      'content-type': 'text/css; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': `public, max-age=${ttl}`,
    });
    /** Content hash of the exact CSS representation, independent of binary permission. */
    const etag = `"${createHash('sha256').update(css).digest('base64url')}"`;
    headers.set('etag', etag);
    if (preloadKeys?.length) {
      /** Explicit requested registry keys deduplicated before source lookup. */
      const selected = new Set(preloadKeys);
      /** Unique non-data binary preload hints; excess rejects rather than silently truncating. */
      const links = [
        ...new Set(
          options.registry
            .entries()
            .filter(([key]) => selected.has(key))
            .flatMap(([, font]) =>
              font.sources
                .filter((s) => !s.url.startsWith('data:'))
                .map((s) => `<${s.url}>; rel=preload; as=font; crossorigin`)
            )
        ),
      ];
      if (links.length > maxPreloads) {
        throw new RangeError('Font preload budget exceeded');
      }
      if (links.length) {
        headers.set('link', links.join(', '));
      }
    }
    if (
      request.headers
        .get('if-none-match')
        ?.split(',')
        .some((tag) => tag.trim() === etag || tag.trim() === '*')
    ) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : css, { headers });
  };
}
