# Metadata and crawlers

Generate escaped page metadata, robots rules and bounded sitemaps.


## Page metadata

```ts
import { createMetaTags, createSitemap, createRobotsTxt } from '@zeruxjs/seo';
const tags = createMetaTags({ title: 'Documentation',
  canonical: 'https://example.com/docs/', description: 'Read the framework guide.' });
const sitemap = createSitemap([{ loc: 'https://example.com/docs/' }]);
```

Insert metadata into the server-rendered head through trusted application code. The package supports Open Graph, Twitter cards, JSON-LD, image entries and alternate languages. The application selects canonical domains and public URLs.

## Dynamic crawler routes

createCrawlerService from @zeruxjs/seo/fetch supplies robots, sitemap and paginated sitemap routes. Register them with the Fetch adapter. Its supplier must return public entries only. Byte/URL caps split large output and conditional ETags reduce repeat transfer.

## Freshness

Snapshot caching is opt-in and process-local. Call invalidate after a content deployment when using it. A fresh supplier is necessary for changing content; an old snapshot cannot discover database changes by itself.

## Security boundary

Robots rules request crawler behavior; they do not protect a private page. Enforce authentication independently and exclude confidential routes from public sitemap suppliers. changefreq uses the standard sitemap vocabulary and is validated at runtime.


## Public entry points

Manifest reference for `@zeruxjs/seo@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./fetch": "./dist/fetch.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

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

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/seo/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/seo/README.md)
- [packages/@zeruxjs/seo/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/seo/package.json)
