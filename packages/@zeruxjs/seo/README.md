# @zeruxjs/seo

Modular page metadata and crawler files. Modules: `metadata`, `sitemap`, `robots`, `escape`, `http`, and `types`; the top-level `index.ts` is a public barrel.

```ts
import { createMetaTags, createSitemap, createRobotsTxt, sitemapResponse } from '@zeruxjs/seo';
const head = createMetaTags({ title: 'Home', canonical: 'https://example.com', description: 'Welcome!' });
const sitemap = createSitemap([{ loc: 'https://example.com/', priority: 1 }]);
const robots = createRobotsTxt({ disallow: ['/private'], sitemap: 'https://example.com/sitemap.xml' });
const response = sitemapResponse([{loc: 'https://example.com/'}]);
```

Supports Open Graph, Twitter cards, JSON-LD, sitemap indexes, image entries, alternate languages, robots groups, crawler delay validation, XML/HTML escaping, and response helpers. Applications remain responsible for their canonical domain and content policies.

## Fetch crawler endpoints (Section 39)

```ts
import { createCrawlerService } from '@zeruxjs/seo/fetch';
const crawler = createCrawlerService({
  origin: 'https://example.com',
  entries: () => getPublicSitemapEntries(),
  maxUrlsPerSitemap: 10000,
  maxXmlBytes: 45_000_000,
  cacheSeconds: 600,
  snapshotTtlMs: 30000
});
// crawler.routes: /robots.txt, /sitemap.xml, /sitemaps/:page
// After a content deployment:
crawler.invalidate();
```

Supports 50,000-entry-per-sitemap maximum, bounded XML byte sizes, size-based splitting, deterministic sitemap indexes, and conditional ETag responses. Optional in-memory snapshot caching coalesces concurrent rebuilds and can be explicitly invalidated. By default no server-side snapshot cache is kept; use a fresh supplier function for changing content. URLs must be public HTTPS/HTTP URLs. The `robots.txt` route only points crawlers at your sitemap; it does not implement authentication or robots enforcement.

Section 80: `createSitemap()` validates `changefreq` against the sitemap vocabulary at runtime, including untyped/JSON-fed calls.
