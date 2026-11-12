import type { FeedOptions } from './types.js';
import { createJsonFeed } from './json.js';
import { createRssFeed } from './rss.js';
import { createAtomFeed } from './atom.js';
import { getFeedContentType } from './content-type.js';
/**
 * Serialize public content and return a low-level body/status/header descriptor.
 *
 * This helper does not inspect a request or authenticate a reader. Its cache
 * header is always public; hosts must apply their own policy for private data.
 * The separate Fetch entry owns negotiation, validators and producer cleanup.
 *
 * @param {'rss' | 'atom' | 'json'} format - Explicit supported representation.
 * @param {FeedOptions} options - Content-owned public facts and finite generator budgets.
 * @param {number} cacheSeconds - Integer public freshness seconds, default 300, range 0–31536000.
 * @returns {{body: string, headers: Record<string, string>, status: number}} Validated public payload with status 200; no listener, subscription or network acquisition.
 * @throws {TypeError | RangeError} When format, cache policy or selected content fails validation.
 */
export function createFeedResponse(
  format: 'rss' | 'atom' | 'json',
  options: FeedOptions,
  cacheSeconds = 300
): { body: string; headers: Record<string, string>; status: number } {
  if (!['rss', 'atom', 'json'].includes(format)) {
    throw new TypeError('Invalid feed format');
  }
  if (
    !Number.isSafeInteger(cacheSeconds) ||
    cacheSeconds < 0 ||
    cacheSeconds > 31536000
  ) {
    throw new RangeError('Invalid cacheSeconds');
  }
  /** Fully serialized selected representation; generator byte bounds precede return. */
  const body = (() => {
    if (format === 'rss') {
      return createRssFeed(options);
    }
    if (format === 'atom') {
      return createAtomFeed(options);
    }
    return createJsonFeed(options);
  })();
  return {
    body,
    status: 200,
    headers: {
      'content-type': getFeedContentType(format),
      'cache-control': `public, max-age=${cacheSeconds}`,
      'x-content-type-options': 'nosniff',
    },
  };
}
