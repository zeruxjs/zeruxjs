import type { SitemapEntry } from './types.js';
import { createSitemap } from './sitemap.js';
import { createRobotsTxt } from './robots.js';
/** Build the legacy transport-neutral XML response record. Does not bind a listener, enforce route authorization or handle Fetch conditionals.
 * @param {Iterable<SitemapEntry>} entries - Bounded source-owned sitemap iterable; dates and public selection remain host-owned.
 * @returns {{status: number, body: string, headers: Record<string, string>}} Status200 XML/body/header record ready for explicit host response integration.
 */
export function sitemapResponse(entries: Iterable<SitemapEntry>): {
  status: number;
  body: string;
  headers: Record<string, string>;
} {
  return {
    status: 200,
    body: createSitemap(entries),
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  };
}
/** Build the legacy transport-neutral robots response record; hints never replace application authorization.
 * @param {Parameters<typeof createRobotsTxt>[0]} options - Optional explicit legacy robots policy.
 * @returns {{status: number, body: string, headers: Record<string, string>}} Status200 plain-text record with nosniff; no server starts.
 */
export function robotsResponse(
  options?: Parameters<typeof createRobotsTxt>[0]
): { status: number; body: string; headers: Record<string, string> } {
  return {
    status: 200,
    body: createRobotsTxt(options),
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  };
}
