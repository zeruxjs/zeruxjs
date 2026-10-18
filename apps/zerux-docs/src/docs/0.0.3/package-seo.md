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

## Install and select the integration

```sh
npm install @zeruxjs/seo@0.0.3
```

There is no automatic `seo` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Define a canonical public origin and supply only public pages to sitemap and robots helpers. Generate titles/descriptions, structured metadata and alternate-language URLs from validated application content. Crawler endpoints need stable routing and correct caching; metadata helpers do not publish the site or configure a domain.

## TypeScript: inputs, results and ownership

```ts
import { createMetaTags } from '@zeruxjs/seo';

type Inputs = Parameters<typeof createMetaTags>;
type Result = Awaited<ReturnType<typeof createMetaTags>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createMetaTags>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Do not list private/signed/customer URLs in a public sitemap. Bound sitemap page count/XML size and invalidate cached snapshots when content changes. Robots directives request crawler behavior; they are not access control. Test XML escaping, conditional GET/HEAD and canonical URLs against the deployed base path.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### SitemapEntry

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `loc` | `string` | No |
| `lastmod` | `string \| Date` | Yes |
| `changefreq` | `'always'\|'hourly'\|'daily'\|'weekly'\|'monthly'\|'yearly'\|'never'` | Yes |
| `priority` | `number` | Yes |
| `alternates` | `Record<string,string>` | Yes |
| `images` | `string[]` | Yes |

### SeoConfig

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `title` | `string` | No |
| `description` | `string` | Yes |
| `canonical` | `string` | Yes |
| `image` | `string` | Yes |
| `robots` | `string` | Yes |
| `locale` | `string` | Yes |
| `type` | `string` | Yes |
| `siteName` | `string` | Yes |
| `keywords` | `string[]` | Yes |
| `twitterSite` | `string` | Yes |
| `alternates` | `Record<string,string>` | Yes |
| `jsonLd` | `unknown \| unknown[]` | Yes |
