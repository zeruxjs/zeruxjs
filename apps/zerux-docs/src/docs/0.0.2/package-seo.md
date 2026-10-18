---
{
  "title": "Metadata and crawlers",
  "description": "Generate escaped page metadata, robots rules and bounded sitemaps.",
  "section": "Packages",
  "order": 15,
  "sources": [
    "packages/@zeruxjs/seo/README.md",
    "packages/@zeruxjs/seo/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/seo"
}
---

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
