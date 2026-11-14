---
{
  "title": "Metadata and crawlers",
  "description": "Generate escaped page metadata, robots rules and bounded sitemaps.",
  "section": "Packages",
  "order": 15,
  "sources": [
    "packages/@zeruxjs/seo/README.md",
    "packages/@zeruxjs/seo/package.json",
    "packages/@zeruxjs/seo/src/composition.mts",
    "packages/@zeruxjs/seo/examples/metadata.mts"
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

Snapshot caching is opt-in and process-local. Call invalidate after a content deployment when using it. A fresh supplier is necessary for changing content; an old snapshot cannot discover database changes by itself. The compatibility `/fetch` controller has no close/drain operation, and invalidation does not cancel its older supplier. Use the explicit `/public` service for paged cooperative loading and actual-settlement teardown; await its close before disposing a borrowed database/source.

## Security boundary

Robots rules request crawler behavior; they do not protect a private page. Enforce authentication independently and exclude confidential routes from public sitemap suppliers. changefreq uses the standard sitemap vocabulary and is validated at runtime.

## Install and select the integration

```sh
npm install @zeruxjs/seo@0.0.4
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

| Field        | Accepted type/value                                                   | Optional |
| ------------ | --------------------------------------------------------------------- | -------- |
| `loc`        | `string`                                                              | No       |
| `lastmod`    | `string \| Date`                                                      | Yes      |
| `changefreq` | `'always'\|'hourly'\|'daily'\|'weekly'\|'monthly'\|'yearly'\|'never'` | Yes      |
| `priority`   | `number`                                                              | Yes      |
| `alternates` | `Record<string,string>`                                               | Yes      |
| `images`     | `string[]`                                                            | Yes      |

### SeoConfig

| Field         | Accepted type/value     | Optional |
| ------------- | ----------------------- | -------- |
| `title`       | `string`                | No       |
| `description` | `string`                | Yes      |
| `canonical`   | `string`                | Yes      |
| `image`       | `string`                | Yes      |
| `robots`      | `string`                | Yes      |
| `locale`      | `string`                | Yes      |
| `type`        | `string`                | Yes      |
| `siteName`    | `string`                | Yes      |
| `keywords`    | `string[]`              | Yes      |
| `twitterSite` | `string`                | Yes      |
| `alternates`  | `Record<string,string>` | Yes      |
| `jsonLd`      | `unknown \| unknown[]`  | Yes      |

## Compose route/layout metadata explicitly

Use the ESM-only `@zeruxjs/seo/composition` entry for structured composition;
existing root serializers remain compatible and do not implicitly acquire policy.

```ts
import {composeMetadata,metadataElements} from '@zeruxjs/seo/composition';
const metadata = composeMetadata({publicBase:'https://example.com/docs/'},[
  {title:{template:'%s | Docs'},description:'Layout summary'},
  {title:'Guide',description:'Content-owned guide summary'},
],{url:'https://example.com/docs/guide',visibility:'public'});
const elements = metadataElements(metadata);
```

An authored renderer consumes the fixed element descriptors; `renderMetadata`
is the optional security-encoded HTML sink. Register an explicit layout rather
than enabling a second renderer or concatenating arbitrary head HTML. The working
package example additionally demonstrates a scoped pre-serialization filter and
host disposal.

Layers run outer-to-inner, manual overrides last. Undefined inherits, supported
null fields clear, nested robots/Open Graph/social objects merge by property,
arrays replace and a nearest title template applies once. Absolute titles bypass
templates. Singleton tags emit once; distinct images/alternates/JSON-LD records
remain deliberate. Locale alternates require declared public locale prefixes,
media origins are allowlisted, and explicit pagination policy keeps page canonicals
within bounded validated public routes.

`resolveMetadata` uses an application/request-owned async filter registry before
final validation. Hook errors/cancellation fail before serialization; dispose then
await whenIdle after borrowing requests finish. There is no global tenant registry.
Private context forces noindex/nofollow and removes canonical, alternates, social
and JSON-LD even after a filter requests indexing. This is not authentication or
private-response cache control: the host still owns both.

JSON-LD contains supplied inert content facts only and is encoded independently
for its script context. No authors, reviews, dates, rich-result eligibility,
headings, alt text or meaningful link labels are manufactured. Host CSP/nonces
remain authoritative. The source tests cover nested overrides, script-breaking
strings, invalid URLs, private policy and an existing framework layout fixture;
real browser/crawler/rich-result qualification remains separate.

## Page public crawler sources explicitly

`@zeruxjs/seo/public` adds createPublicCrawlerService with a paged host source,
strict public origin/prefix/media/locale policy and complete-candidate snapshots.
Every source item explicitly declares visibility public; private entries or query
URLs (including signed media URLs) fail the candidate. The host still owns the
truth of that public classification and tenant-aware content selection.

Root robots.txt points at a mounted sitemap URL. XML files/indexes have URL/byte
limits, HEAD/conditional GET, bounded loading and actual-settlement cleanup. No
synthetic lastmod is generated. renderHtmlSitemap is a separate escaped authored
list renderer, not XML or an authorization layer.

Fixed createPublicRedirects rules reject open targets, cycles and long chains;
request query/Host/forwarded fields never choose Location. Proxy admission requires
both a configured internal origin and a trusted host-supplied direct socket peer.
Forwarded headers remain ignored. Transport registration and application write
redirects remain owned by zhost/zeruxjs respectively.

trustTxt adds a custom public file only when explicitly supplied and reviewed; no
universal SEO standard is claimed. Robots directives are crawler hints rather than
access control, and measured performance/mobile results are not ranking promises.
The package README and public-import crawler example describe source ownership,
limits, noindex previews and shutdown. No deployed proxy/crawler/browser checks
are inferred from the local fixtures.
