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

## Fetch crawler endpoints

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

The compatibility `/fetch` controller exposes `invalidate()` but no close/drain API. Its invalidation detaches the current pending slot without cancelling the supplier, so an earlier request can finish while a new generation builds. Use `/public` when cooperative cancellation, bounded source pages and actual-settlement shutdown are required; those stronger guarantees do not apply retroactively to the legacy helper.

`createSitemap()` validates `changefreq` against the sitemap vocabulary at runtime, including untyped/JSON-fed calls.

## Route/layout metadata composition

The opt-in **ESM-only** `@zeruxjs/seo/composition` entry adds `composeMetadata`,
`resolveMetadata`, `createMetadataHooks`, `metadataElements` and `renderMetadata`.
The existing CommonJS root/fetch exports and `createMetaTags(SeoConfig)` remain
compatible standalone serializers; they do not gain site/privacy policy implicitly.
See the runnable [public-import example](examples/metadata.mts).

Pass public site settings, layout-to-route `MetadataLayer[]`, and an explicit
host-owned `{url,visibility,locale?,page?}` context. No request headers, installed
plugins, network calls, filesystem scan or global renderer defaults are inferred.
Use authenticated routing/content data to set visibility; metadata is not access
control. Semantic headings, image alt text, link text and correct page content
remain component/content responsibilities.

### Deterministic merge and overrides

Layers run outer layout first, nested layouts next, route/manual overrides last.
Undefined inherits. Scalar values replace; null clears supported optional scalar
fields. The nearest title template applies once to the final title; templates
must contain exactly one literal `%s`. `{title:{text:'Exact',absolute:true}}`
skips the template; a later title text resets absolute mode. `template:null`
removes an inherited template. Titles remain required; none are manufactured from
paths. Replacement title text is literal, including `$&` and HTML-looking strings.

Robots, Open Graph and social objects merge per property. Open Graph image arrays
replace rather than append; null/empty removes them and repeated URLs deduplicate.
Social has one optional image, otherwise inheriting the first Open Graph image;
`image:null` explicitly suppresses that fallback. A large-image card requires an
image. Titles/descriptions fall back to final page facts unless explicitly cleared
with null; no extra descriptions or facts are generated. Social account names use
`@name`. Open Graph type is explicitly website/article. Region-qualified declared
locales such as en-US yield en_US; a territory is never invented for language-only
locales. See the [Open Graph locale format](https://ogp.me/).

Alternates merge by normalized BCP 47 key; a null entry removes it and
`alternates:null` resets the map. Aliased duplicate keys within one layer reject.
JSON-LD arrays replace; null/empty clears them, and exact duplicate records
deduplicate. Only supplied bounded inert JSON objects are serialized: functions,
accessors, class instances, sparse/custom arrays, cycles, nonfinite numbers and
unsafe prototype keys reject. No authors, dates, reviews or ratings are inferred.
This is serialization/shape safety, not schema.org vocabulary validation or rich
result eligibility. See [schema.org structured-data guidance](https://schema.org/docs/gs.html).

### Public URL, locale and pagination policy

`publicBase` must be an absolute HTTP(S) URL ending in `/` with no credentials,
query or fragment. Context URL is an absolute, query-free factual route URL under
that base, or under the explicitly selected locale base. `locales` maps BCP 47
keys (plus alternate-only x-default) to explicit public URL prefixes, each ending
in `/`; cross-origin translated sites require explicit entries. Alternate URLs
must remain under their matching configured prefix. The host must ensure those
pages really exist, are public and equivalent; prefixes cannot prove that.

Canonical defaults to the validated route URL. Manual canonical URLs must stay
under its selected public prefix; null omits canonical/og:url. Credentials,
relative URLs, fragments, foreign origins and path-prefix escapes reject. Media
URLs must be absolute HTTP(S), credential/fragment-free and under `mediaOrigins`
(default the public base origin). This navigation policy is not an SSRF/network
fetch policy: no URLs are fetched.

Optional `pagination:{parameter,maxPage}` bounds context.page to 1–10000. Page one
omits that parameter; later pages add it to canonical and alternate URLs. A supplied
page parameter must exactly match context.page. Other query parameters, duplicate
parameters and out-of-range/mismatched pages reject. Pagination canonicals do not
collapse all pages to page one. No prev/next URLs or content counts are invented.

Private context always forces **noindex,nofollow** and omits canonical, alternates,
Open Graph, social and JSON-LD, even after a filter requests otherwise. Title and
description remain authored page content. Robots directives are crawler hints,
not authentication, deletion guarantees or cache controls. The host still owns
private/no-store headers and access checks.

### Scoped hooks, ownership and rendering

`createMetadataHooks()` reuses the hooks package's async server filter registry:
register `metadata:resolve` with `(hookContext,layer,routeContext) => layer`.
Handlers transform structured merged layers **before** template application and
serialization. Normal priority/insertion/once/removal rules apply. The frozen
route context cannot change; returned metadata is validated again and private
policy reapplied. Handler errors/cancellation propagate before a document exists;
there is no silent fallback that bypasses validation. Signals are cooperative;
noncooperative handler work delays settlement. Dispose then await whenIdle after
all borrowing requests drain. No process-global registry is created.

Returned MetadataDocument values and nested data are immutable/request-local.
`metadataElements(document)` returns fixed title/meta/link/script descriptors for
an authored renderer. Singleton tags appear once; multiple distinct Open Graph
images/locale alternates and JSON-LD objects are deliberate. Forged/spread document
objects are not serializer inputs: recompose with the site/context policy instead.

`renderMetadata(document,{nonce?})` is the optional HTML sink using security-owned
text/attribute encoders and independent script-safe JSON encoding. JSON-LD escapes
script terminators, angle brackets, ampersands and Unicode separators; it does not
reuse HTML escaping for script data. Script descriptors already contain script-safe
JSON text: native renderers should use the appropriate script text sink, not
HTML-encode it again. Host CSP remains authoritative; supplying a nonce does not
grant authorization or add a security policy. No raw head HTML/callback field is
accepted. Rendering is explicit through an authored layout; the framework does
not install SEO or alter an application's head automatically.

Bounds: 32 layers/locale entries/media origins, eight images/JSON-LD records,
16 JSON levels, 10000 visited values, 256 KiB metadata inputs and 64 KiB JSON-LD.
Titles, strings and title templates also have explicit character limits. Hooks
cap handlers/depth/pending work at 64/8/32. The package owns no I/O handles.

Qualification covers legacy crawler/metadata behavior plus nested overrides,
duplicate tags, URL/locale/page denial, script-breaking JSON-LD, private policy,
hook failures/cancellation/isolation and cleanup. An existing zeruxjs authored
layout consumes the structured output in a renderer fixture; no browser, crawler,
search ranking or rich-result acceptance is claimed. Those require separate
production content, CSP and real crawler/browser qualification.

## Public paged crawlers and fixed redirects

`@zeruxjs/seo/public` is an explicit stricter API alongside the existing low-level
serializers and legacy `/fetch` service. The [public-import example](examples/crawlers.ts)
opens no listener. `createPublicCrawlerService` returns Fetch handlers/routes,
`invalidate`, `status` and awaitable `close`; mount them explicitly in the host's
existing transport. Zhost's transport registry/authorization stays the listener
owner; no JSON-RPC/MCP gateway is treated as a crawler server automatically.

### Public source and origin policy

Supply `site:{origin,basePath?,locales?,mediaOrigins?,trustedProxy?}` and a paged
`source.load({cursor,limit,signal})` returning `{items,nextCursor?}`. Items are
SitemapEntry data plus mandatory `visibility:'public'`. The host must select only
authorized public content in a tenant-appropriate source; the flag cannot prove
that a private page was not mislabeled. Private flags, duplicate URLs, unknown
fields, out-of-prefix page URLs and **all query/fragment URLs** reject the entire
candidate. Signed media URLs with query credentials are therefore excluded. Secret
path names cannot be detected automatically: never put them in a public source.
Media origins and translated locale prefixes are explicit. No request header
chooses those origins, and no URL is fetched.

`origin` is an absolute HTTP(S) origin; basePath is an explicit slash-terminated
public prefix. Locale bases are declared absolute public prefixes; language keys
normalize as BCP 47 plus x-default. Only matching alternate URLs emit. XML content
is escaped, and lastmod is emitted only when the source provides a valid content
modification date. Neither page nor sitemap-index dates are stamped at build time.

Request URL origin and an explicit Host header must match configured public
settings. Host, Forwarded and X-Forwarded-* **never derive output URLs**. If a
reverse proxy supplies internal Request URLs, explicitly configure
`trustedProxy:{peers:['127.0.0.1'],internalOrigins:['http://internal.example']}` and
pass `{peerAddress}` from the trusted host's **direct socket**, not a request header.
Only both an exact peer match and configured internal origin admit that request;
forwarded values remain ignored even then. Missing/untrusted peer context fails
closed with 421. Configure normal edge Host validation too. Crawler visibility
and this origin check do not authenticate private application routes.

### Routes and limits

`/robots.txt` stays at the **host root** regardless of basePath, as required by the
[Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html). Sitemap
routes use `<basePath>sitemap.xml` and `<basePath>sitemaps/:page`. One XML page
returns a urlset directly; multiple pages return a sitemap index. HEAD returns no
body; GET/HEAD use deterministic strong ETags, accept weak If-None-Match matches,
and return 304 when unchanged. Other methods reject. Unknown pages return 404.

The [sitemap protocol](https://www.sitemaps.org/protocol.html) caps URL files/indexes
at 50000 entries and 52428800 uncompressed bytes. Direct createSitemap and
createSitemapIndex now bound iteration and bytes too, including iterator cleanup
on failure. They remain general serializers; their legacy query-URL support is
not the strict public-source privacy policy. New service settings are:

| Setting | Default | Maximum |
| --- | --- | --- |
| pageSize | 500 | 1000 records per source call |
| maxSourcePages | 1000 | 10000 |
| maxEntries | 100000 | 500000 |
| maxUrlsPerFile | 10000 | 50000 |
| maxXmlBytes | 45000000 | 52428800 per file/index |
| maxSnapshotBytes | 33554432 | 134217728 combined XML bytes |
| timeoutMs | 5000 | 60000 |
| maxWaiters | 32 | 256 |
| snapshotTtlMs | 0 (fresh per settled request) | 86400000 |
| cacheSeconds | 600 | 31536000 |

Repeated/oversized cursors, over-limit pages, single entries that cannot fit,
private data or dependency failures return a body-free no-store 503. Snapshot
preparation stages a complete candidate and publishes only on success; prior
cached data is retained but an expired/invalidated snapshot is not silently served
on failure. Splitting reserves conservative header space and can produce files
smaller than the configured maximum. Snapshot bytes describe XML, not total JS
heap overhead. URLs cap at 8192 characters, source entries at 32 images/alternates;
locale/media/proxy lists are bounded. Robots/custom-file bodies cap at 64 KiB.

Concurrent requests coalesce one native build; an abort affects only its waiter.
Deadline/overload responses never release ownership of still-running source work.
Invalidate aborts the candidate and expires cache; it does not spawn an overlapping
source job before settlement. Await close to stop admission, abort cooperative
loading and drain actual settlement. Sources/DB clients remain borrowed. A source
that ignores AbortSignal can delay close; cancellation cannot force JavaScript.

### HTML sitemap and redirects are separate

`renderHtmlSitemap(site,items,{label,maxEntries,maxBytes})` renders a bounded escaped
navigation list, not XML or a SPA fallback. Every item has an explicit public flag,
URL and authored title; no meaningful link text is guessed from slugs. Defaults
are 1000 entries/1 MiB, maxima 5000/2 MiB. The host owns the page/layout and access.

`createPublicRedirects({site,rules,externalOrigins?})` compiles at most 1000 exact
from/to rules and returns a Fetch handler. Sources are public mounted paths;
destinations are fixed configured URLs, same-site by default. External redirects
require exact allowed origins. Relative protocol URLs, traversal/encoded path
ambiguity, queries/fragments, duplicate sources, self/cyclic rules and chains over
32 reject before serving. No request `next`, forwarded header, query or capture is
copied to Location. Only GET/HEAD are admitted; use the existing framework's
mutation/form redirect API with its own authorization for write flows.

Supported statuses are 301/308 permanent, 302/307 temporary, and 303 see-other;
307/308 preserve methods, whereas 301/302 permit historical POST-to-GET behavior
under [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html). This helper
serves GET/HEAD and deliberately emits no-store redirects, so choosing a permanent
status does not implicitly choose a long cache lifetime. Cycle checks cover this
configured graph, not unknown redirects on external hosts.

### Robots, previews, custom trust.txt and measurements

Supported generated directives are User-agent groups, Allow, Disallow, Sitemap and
optional nonstandard Crawl-delay. Crawl-delay is only a numeric nonnegative hint
and may be ignored by a crawler. The default permits `/` and points at the explicit
public sitemap. No Host, noindex robots.txt directive, arbitrary line injection,
robots authorization or crawler compliance is promised. Disallow can reveal a path
and does not prevent access; it can also stop a crawler from seeing page noindex.
Use authentication for private content and the metadata composition private policy
(noindex/nofollow plus host no-store) for previews; neither guarantees removal from
an existing search index.

`trustTxt` is **only** an explicitly supplied, host-reviewed public string. When
configured it adds `/trust.txt`; otherwise there is no route. It is not a universal
SEO/security standard, and no trust claims, URLs, credentials or remote content are
discovered automatically. The host must review its literal text for secrets.
Performance/mobile audit results remain measurements with their actual source,
time, sample/coverage and limits. This package neither runs a synthetic mobile
audit nor turns those observations into a guaranteed ranking or compliance score.

Checks cover paging/limits/escaping, conditionals/HEAD, private/signed URL rejection,
Host/forwarded spoofing, verified proxy context, redirect cycles, source outage,
deadline/drain and HTML escaping. These are local fixtures, not live search-engine,
reverse-proxy deployment or mobile/browser qualification.
