import {
  createPublicCrawlerService,
  createPublicRedirects,
  renderHtmlSitemap,
} from '@zeruxjs/seo/public';

/** Explicit synthetic public origin/prefix/locale policy; no request header supplies it. */
const site = { origin: 'https://example.com', basePath: '/docs/' };
// The host authoritatively selects PUBLIC content; visibility is not inferred from a URL.
/** Owned explicit paged crawler scope exported for host mounting/teardown; no listener binds. */
const crawler = createPublicCrawlerService({
  site,
  source: {
    async load({ cursor, signal }) {
      signal.throwIfAborted();
      if (cursor !== undefined) {
        throw new Error('Unexpected cursor');
      }
      return {
        items: [
          {
            visibility: 'public' as const,
            loc: 'https://example.com/docs/guide',
            lastmod: '2025-01-02',
          },
        ],
      };
    },
  },
  maxUrlsPerFile: 10000,
  snapshotTtlMs: 30000,
});
/** Inert fixed redirect graph; request query/forwarded data never choose Location. */
const redirects = createPublicRedirects({
  site,
  rules: [{ from: '/docs/old', to: '/docs/guide', status: 308 }],
});
export { crawler, redirects }; // Host mounts Fetch handlers explicitly; imports do not bind sockets.
/** Explicit authored HTML navigation callback, separate from XML and access control.
 * @returns {string} Bounded escaped authored navigation list.
 */
export const htmlSitemap = () =>
  renderHtmlSitemap(site, [
    {
      visibility: 'public',
      loc: 'https://example.com/docs/guide',
      title: 'Guide',
    },
  ]);
// await crawler.close() on host teardown; the source/database remain host-owned.
